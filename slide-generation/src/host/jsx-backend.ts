import { randomUUID } from 'node:crypto';
import type { FunctionTool, ResponseInputItem } from 'openai/resources/responses/responses';
import type { createLocalRuntime } from '../runtime.js';
import type { GenerationBackend, GenerationInvocation, GenerationPolicy } from '../orchestration/backend.js';
import type { Publisher, Branch, Edit, DeckSnapshot, HistoryResult, SlideRecord } from '../orchestration/publisher.js';
import type { Observation, Role, Speech } from '../orchestration/types.js';
import { SourceError, transactionSchema } from '../contracts.js';
import { childNodes } from '../schema.js';
import { nodes, parseSource, textContent } from '../parser.js';
import { lineHash } from '../hashline.js';
import { indexSource } from '../source/candidate.js';
import type { InputUtterance } from '../source/ingestion.js';
import type { ToolObservation } from '../tools.js';

import type { NoteRestoration } from '../source/history.js';
import { compileDesignContext, validateDesignSkillSnapshot, type DesignSkillSnapshot, type DesignContext, type DesignMode } from '../design/skills.js';
interface HistoryEntry {source: string; selectedId: string; notes?: NoteRestoration[]}
type Runtime = Awaited<ReturnType<typeof createLocalRuntime>>;
export interface JsxBackendOptions {
  instructions: string;
  /** Explicit snapshot: omitted for legacy runs/replays, loaded by live hosts. */
  designSkills?: DesignSkillSnapshot;
  onSelection?(slideId: string): void | Promise<void>;
  onTool?(event: ToolObservation & { inferenceId: string; agent: string; role: Role; slideId?: string; context: unknown }): void | Promise<void>;
}
/** Canonical JSX is the only deck authority; actor-facing observations are derived metadata. */
export class JsxBackend implements GenerationBackend {
  selectedId = '';
  revision = 0;
  fastWatermark = 0;
  latestFastSlideId = '';
  closed = false;
  paused = false;
  private pauseEpoch = 0;
  private historyEpoch = 0;
  private mutationTail: Promise<unknown> = Promise.resolve();
  private undoSources: HistoryEntry[] = [];
  private redoSources: HistoryEntry[] = [];
  readonly undo: Observation[] = [];
  readonly deckUndo: DeckSnapshot[] = [];
  readonly requestedTitles = new Map<string, string>();
  readonly recordingFailures: string[] = [];
  onPublish: Publisher['onPublish'];
  onStructure: Publisher['onStructure'];
  onConflict: Publisher['onConflict'];
  validateAccess: Publisher['validateAccess'];
  readonly generation: GenerationPolicy;
  private readonly designContexts = new Map<DesignMode, DesignContext>();
  constructor(readonly runtime: Runtime, private options: JsxBackendOptions) {
    if (options.designSkills) {
      const snapshot = validateDesignSkillSnapshot(options.designSkills);
      for (const mode of ['fast', 'slow', 'review', 'specialist'] as const)
        this.designContexts.set(mode, compileDesignContext(snapshot, mode));
    }
    this.generation = {
      instructions: role => `${options.instructions}\n\nYou are ${role}. This runtime uses canonical JSX and hashline edit_source, never HTML edits. Spoken input includes explicit editing instructions. Preserve its exact words and qualifiers in notes/raw evidence. ${role === 'fast' ? 'Handle routine content and explicit edits within workingSlideId. Use read_source for that slide, then one granular edit_source when possible. For a blank slide, insert_before its closing </Slide> line; the preceding blank line is a stable insertion boundary. Do not anchor visible insertions to Transcript or SpeakerNotes lines, which change as speech arrives. After a stale refusal, reread and apply the latest requested state instead of finishing with the slide blank. For an explicit request requiring theme, library, slide deletion/reordering or cross-slide work, call request_deck_edit with its scope and the exact Prompt utteranceId copied from notes.transcript (or read_speaker_notes); this wakes Slow with the complete original input. Supply the ID, not quoted or combined speech. Do not merely finish or try to edit outside workingSlideId.' : 'Use shared definitions for repeated shapes and refine the whole deck only when useful. Preserve factual content and source evidence.'} Finish this activation promptly once the requested change is represented. Do not repeatedly inspect readiness or reword correct content. The host handles explicit new-slide/return navigation; never create another slide for an already-created workingSlideId. Only explicit screenshot calls provide images.`,
      definitions: role => role === 'specialist' ? [] : runtime.tools.definitions()
        .map(d => ({ type: 'function', ...d, strict: false }) as FunctionTool),
      context: input => ({ epoch: this.historyEpoch, pauseEpoch: this.pauseEpoch, revision: runtime.engine.state().revision,
        selectedSlideId: this.selectedId, workingSlideId: input.slideId,
        slides: this.list().map(s => ({ id: s.id, title: s.title })),
        notes: input.slideId ? runtime.engine.readSpeakerNotes(input.slideId) : undefined }),
      invoke: (input, name, args) => this.invoke(input, name, args),
      deliverUtterance: input => this.deliverUtterance(input),
    };
    const baseInstructions = this.generation.instructions;
    this.generation.instructions = role => {
      const design = this.designContexts.get(role);
      return baseInstructions(role) + (design ? `\n\n${design.instructions}` : '');
    };
  }
  designContext(mode: DesignMode) { const context = this.designContexts.get(mode); return context ? structuredClone(context) : undefined; }
  async initialize(_source: string) { this.selectedId = this.list()[0]?.id ?? ''; if (!this.selectedId) throw new Error('Canonical deck requires an initial slide'); }
  list(): SlideRecord[] {
    const source = this.runtime.engine.readDocument().source;
    return childNodes(parseSource(source)).filter(n => n.tag === 'Slide').map(slide => {
      const title = [...nodes(slide)].find(n => n.tag === 'Text' && ['title', 'heading'].includes(String(n.props.role)));
      const literal = source.slice(slide.start, slide.end);
      return { id: slide.id!, title: title ? textContent(title) : this.requestedTitles.get(slide.id!) ?? `Slide ${slide.id}`,
        observation: { id: lineHash(literal), historyEpoch: this.historyEpoch, slideId: slide.id!, source: literal,
          screenshot: Buffer.alloc(0), geometry: [], diagnostics: [], fastWatermark: this.fastWatermark } };
    });
  }
  get(id: string) { const slide = this.list().find(s => s.id === id); if (!slide) throw new SourceError('missing_node', 'Unknown or removed slide', id); return slide; }
  get current() { return this.get(this.selectedId).observation; }
  private serialize<T>(operation: () => Promise<T>): Promise<T> { const run = this.mutationTail.then(operation); this.mutationTail = run.catch(() => {}); return run; }
  private guard(input: GenerationInvocation) {
    input.signal.throwIfAborted();
    const context = input.context as { epoch: number; pauseEpoch: number };
    if (this.closed || this.paused || context.epoch !== this.historyEpoch || context.pauseEpoch !== this.pauseEpoch)
      throw new SourceError('control_boundary', 'Edit crossed pause/undo/close; reread after the control completes');
    if (input.role === 'specialist') throw new SourceError('role', 'Specialists cannot edit canonical source');
  }
  private async invoke(input: GenerationInvocation, name: string, args: unknown) {
    const event: ToolObservation & { inferenceId: string; agent: string; role: Role; slideId?: string; context: unknown } = { id: randomUUID(), inferenceId: input.inferenceId,
      agent: input.agent, role: input.role, slideId: input.slideId, context: input.context, name, arguments: args, startedAtMs: performance.now(), finishedAtMs: 0 };
    try {
      this.guard(input);
      let result: any;
      if (name === 'edit_source') result = await this.serialize(async () => {
        this.guard(input);
        const transaction = transactionSchema.parse(args);
        if (input.role === 'fast') {
          const source = this.runtime.engine.readDocument().source, index = indexSource(source), target = index.byId.get(input.slideId ?? '');
          const permitted = new Set(target ? [...nodes(target)].map(n => n.id) : []);
          if (transaction.edits.some(edit => !permitted.has(edit.nodeId))) throw new SourceError('role', 'Fast edits only its working slide; send broader work to Slow');
        }
        const before = this.snapshot();
        const result = await this.runtime.engine.edit(transaction, undefined, () => this.guard(input));
        if (result.accepted && !result.noOp) this.committed(before, input.role, input.slideId);
        return result;
      });
      else result = await this.runtime.tools.invoke(name, args);
      event.result = result;
      if (name === 'screenshot') {
        const modelItems: ResponseInputItem[] = [{ role: 'user', content: result.flatMap((frame: any) => [
          { type: 'input_text', text: JSON.stringify({ slideId: frame.slideId, sourceDigest: frame.sourceDigest, artifactDigest: frame.artifactDigest }) },
          { type: 'input_image', image_url: `data:image/jpeg;base64,${frame.jpeg}`, detail: 'high' }]) }];
        return { output: result.map(({ jpeg: _jpeg, ...rest }: any) => rest), modelItems };
      }
      return { output: result };
    } catch (error) { event.error = { code: error instanceof SourceError ? error.code : 'internal', message: String(error) }; throw error; }
    finally { event.finishedAtMs = performance.now(); try { await this.options.onTool?.(event); } catch (error) { this.recordingFailures.push(String(error)); } }
  }
  private snapshot() { return { source: this.runtime.engine.readDocument().source, selectedId: this.selectedId }; }
  private committed(before: HistoryEntry, role: Role, target?: string, trackNotes = false) {
    if (trackNotes) before.notes = this.noteRestorations(this.runtime.engine.readDocument().source, before.source);
    this.undoSources.push(before); this.redoSources.length = 0;
    this.deckUndo.push({ selectedId: before.selectedId, slides: [] });
    this.revision++; if (role === 'fast') { this.fastWatermark++; this.latestFastSlideId = target ?? this.selectedId; }
    const previousIds = childNodes(parseSource(before.source)).filter(n => n.tag === 'Slide').map(n => n.id!);
    const slides = this.list(), nextIds = slides.map(s => s.id);
    if (!nextIds.includes(this.selectedId)) this.selectedId = nextIds[Math.min(Math.max(0, previousIds.indexOf(this.selectedId)), nextIds.length - 1)] ?? '';
    if (JSON.stringify(previousIds) !== JSON.stringify(nextIds)) this.onStructure?.({ outcome: 'published', slideIds: nextIds, diagnostics: [] });
    const observation = slides.find(s => s.id === target)?.observation ?? slides.find(s => s.id === this.selectedId)?.observation;
    if (observation) this.onPublish?.(observation, role);
  }
  private noteRestorations(base: string, target: string): NoteRestoration[] {
    const indexed = (source: string) => new Map(childNodes(parseSource(source)).filter(n => n.tag === 'Slide').map(slide => {
      const note = childNodes(slide).find(n => n.tag === 'SpeakerNotes')!;
      return [slide.id!, source.slice(note.start, note.end)];
    }));
    const before = indexed(base), after = indexed(target);
    return [...before].flatMap(([slideId, body]) => after.has(slideId) && after.get(slideId) !== body
      ? [{slideId, base: body, target: after.get(slideId)!}] : []);
  }
  async deliverUtterance(input: InputUtterance) {
    const receipt = await this.runtime.engine.ingest(input);
    await this.runtime.engine.settledInput();
    const root = parseSource(this.runtime.engine.readDocument().source), slide = [...nodes(root)].find(n => n.tag === 'Slide' && n.id === input.slideId);
    const prompts = slide ? [...nodes(slide)].filter(n => n.tag === 'Prompt') : [];
    const corrected = new Set(prompts.map(n => n.props.correctionOf).filter(Boolean));
    const speech: Speech = { slideId: input.slideId, revision: prompts.length, text: prompts.filter(n => !corrected.has(n.props.utteranceId)).map(textContent).join('\n'),
      receivedAt: performance.now(), corrections: [] };
    return { receipt, speech, duplicate: receipt.duplicate };
  }
  async navigate(id: string) {
    if (this.closed) throw new Error('Backend closed');
    const slide = this.get(id); this.selectedId = id; await this.options.onSelection?.(id); return slide;
  }
  async createSlide(title?: string) {
    return this.serialize(async () => {
      const before = this.snapshot(), ids = new Set(this.list().map(s => s.id)), read = this.runtime.engine.readSource('deck');
      const source = read.lines.map(l => l.text).join('\n');
      const text = source.replace('</Deck>', '<Slide freeForm={{reason:"Explicit user new-slide command"}}>\n  <Transcript/>\n  <SpeakerNotes/>\n\n</Slide>\n</Deck>');
      const result = await this.runtime.engine.edit({ edits: [{ snapshotId: read.snapshotId, nodeId: read.nodeId, op: 'replace', startLine: 1, hashes: read.lines.map(l => l.hash), text }] }, undefined, () => { if (this.closed) throw new Error('Backend closed'); });
      if (!result.accepted) throw new SourceError('creation_refused', JSON.stringify(result.findings));
      const created = this.list().find(s => !ids.has(s.id)); if (!created) throw new Error('Creation did not allocate a slide');
      if (title) this.requestedTitles.set(created.id, title);
      this.committed(before, 'slow', created.id);
      await this.navigate(created.id); return this.get(created.id);
    });
  }
  async next() { const slides = this.list(), index = slides.findIndex(s => s.id === this.selectedId); return index + 1 < slides.length ? this.navigate(slides[index + 1].id) : this.createSlide(); }
  setPaused(value: boolean) { if (value && !this.paused) this.pauseEpoch++; this.paused = value; }
  historyStatus() { return { undoDepth: this.undoSources.length, redoDepth: this.redoSources.length, canUndo: !!this.undoSources.length, canRedo: !!this.redoSources.length }; }
  async restoreHistory(direction: 'undo' | 'redo'): Promise<HistoryResult> {
    this.historyEpoch++;
    return this.serialize(async () => {
      const from = direction === 'undo' ? this.undoSources : this.redoSources, to = direction === 'undo' ? this.redoSources : this.undoSources;
      const saved = from.at(-1);
      if (!saved) return { outcome: 'unchanged', direction, selectedId: this.selectedId, history: this.historyStatus() };
      const before = this.snapshot();
      await this.runtime.engine.restoreContent(saved.source, () => { if (this.closed) throw new Error('Backend closed'); }, saved.notes);
      const restored = this.runtime.engine.readDocument().source;
      const reverseNotes = saved.notes?.length ? this.noteRestorations(restored, before.source) : undefined;
      from.pop(); to.push({...before, notes: reverseNotes}); this.deckUndo.length = this.undoSources.length;
      const slides = this.list();
      if (!slides.some(s => s.id === this.selectedId)) this.selectedId = slides.some(s => s.id === saved.selectedId) ? saved.selectedId : slides[0].id;
      this.revision++; this.onStructure?.({ outcome: 'published', slideIds: slides.map(s => s.id), diagnostics: [] });
      await this.options.onSelection?.(this.selectedId);
      return { outcome: 'restored', direction, selectedId: this.selectedId, history: this.historyStatus() };
    });
  }
  /** Explicit proposal acceptance, including when paused. One canonical commit/undo unit. */
  async acceptProposal(transaction: unknown, expectedRevision: string, expectedCandidate: string, signal: AbortSignal) {
    const epoch = this.historyEpoch, pauseEpoch = this.pauseEpoch;
    return this.serialize(async () => {
      const before = this.snapshot();
      const guard = (candidate?: string) => {
        signal.throwIfAborted();
        if (this.closed || epoch !== this.historyEpoch || pauseEpoch !== this.pauseEpoch)
          throw new SourceError('control_boundary', 'Proposal crossed a user control boundary');
        if (this.runtime.engine.state().revision !== expectedRevision || (candidate && lineHash(candidate) !== expectedCandidate))
          throw new SourceError('proposal_stale', 'Deck or prepared candidate changed; refresh the preview');
      };
      guard();
      const result = await this.runtime.engine.edit(transaction, undefined, guard);
      if (result.accepted && !result.noOp) this.committed(before, 'slow', undefined, true);
      return result;
    });
  }
  async close() { this.closed = true; await this.mutationTail; }
  branch(_agent: string, _role: Role, _observation: Observation, _speech?: Speech): Branch { throw new SourceError('legacy_disabled', 'JSX uses hashline snapshots'); }
  async edit(..._args: Parameters<Publisher['edit']>): ReturnType<Publisher['edit']> { throw new SourceError('legacy_disabled', 'Use edit_source'); }
  async editMany(..._args: Parameters<Publisher['editMany']>): ReturnType<Publisher['editMany']> { throw new SourceError('legacy_disabled', 'Use one edit_source transaction'); }
  async split(..._args: Parameters<Publisher['split']>): ReturnType<Publisher['split']> { throw new SourceError('legacy_disabled', 'Use edit_source'); }
  async mergeSlides(..._args: Parameters<Publisher['mergeSlides']>): ReturnType<Publisher['mergeSlides']> { throw new SourceError('legacy_disabled', 'Use edit_source'); }
}
