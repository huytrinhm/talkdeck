import { SourceError, transactionSchema, type DeckDocument, type ValidationPipeline } from './contracts.js';
import { SnapshotStore } from './hashline.js';
import { nodeById, nodes, parseSource, textContent } from './parser.js';
import { introducedErrors, ready, UnavailableValidation } from './validation.js';

const protectedProps = ['version', 'born', 'layoutChanges', 'nextId', 'provenance'];
export class SlideEngine {
  readonly snapshots = new SnapshotStore();
  private document: DeckDocument;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(document: DeckDocument, private validation: ValidationPipeline = new UnavailableValidation()) {
    this.document = { ...document, source: document.source.replace(/\r\n?/g, '\n') };
    parseSource(this.document.source);
  }
  readDocument(): DeckDocument { return { ...this.document }; }
  readSource(nodeId: string) { return this.snapshots.read(this.document.source, nodeId); }
  readSpeakerNotes(slideId: string) {
    const slide = nodeById(parseSource(this.document.source), slideId);
    if (slide.tag !== 'Slide') throw new SourceError('not_slide', 'Expected a slide ID', slideId);
    const children = slide.children.filter(child => typeof child !== 'string');
    const notes = children.find(child => child.tag === 'SpeakerNotes');
    const transcript = children.find(child => child.tag === 'Transcript');
    return {
      slideId, version: slide.props.version,
      notes: notes ? textContent(notes) : '',
      transcript: transcript ? this.document.source.slice(transcript.start, transcript.end) : '',
    };
  }
  async readiness() { const report = await this.validation.check(this.document.source); return { ready: ready(report), ...report }; }
  edit(input: unknown) {
    // Serializes reads of the current committed state, validation, and publication.
    const run = this.tail.then(() => this.transact(input));
    this.tail = run.catch(() => undefined);
    return run;
  }
  private async transact(input: unknown) {
    const transaction = transactionSchema.parse(input);
    const current = this.document.source;
    const candidate = this.snapshots.stage(current, transaction.edits);
    const oldNodes = new Map([...nodes(parseSource(current))].filter(node => node.id).map(node => [node.id!, node]));
    const newNodes = [...nodes(parseSource(candidate))];
    for (const node of newNodes) {
      const previous = node.id ? oldNodes.get(node.id) : undefined;
      if (node.id && !previous) throw new SourceError('system_field', 'New nodes must omit system-assigned IDs', node.id);
      if (previous && previous.tag !== node.tag) throw new SourceError('system_field', 'Cannot reuse an existing ID for a different tag', node.id);
      for (const key of protectedProps) if (JSON.stringify(previous?.props[key]) !== JSON.stringify(node.props[key])) throw new SourceError('system_field', `Cannot edit system-managed ${key}`, node.id);
    }
    // Archive migration and ID allocation are deliberately not approximated. Until
    // implemented, refuse operations needing them even with an injected validator.
    if (newNodes.some(node => !node.id)) throw new SourceError('not_implemented', 'New-node ID allocation is not wired yet');
    for (const previous of oldNodes.values()) {
      if (['Transcript', 'Archive'].includes(previous.tag)) {
        const node = newNodes.find(node => node.id === previous.id);
        if (!node || candidate.slice(node.start, node.end) !== current.slice(previous.start, previous.end)) throw new SourceError('system_field', 'Raw transcripts and archives are system-owned', previous.id);
      }
      if (previous.tag === 'Slide' && !newNodes.some(node => node.id === previous.id)) throw new SourceError('not_implemented', 'Slide deletion requires the archival adapter', previous.id);
    }
    const baseline = await this.validation.check(current);
    const report = await this.validation.check(candidate);
    if (!baseline.complete || !report.complete) throw new SourceError('validation_unavailable', 'All required validation stages must complete before an edit can commit');
    const errors = introducedErrors(baseline.findings, report.findings);
    if (errors.length) return { accepted: false as const, findings: errors };
    // This initial scaffold intentionally stops before normalization/versioned commit.
    // Tests exercise the transaction's refusal boundary; no production success path
    // is claimed until normalization, archival, versioning and persistence are wired.
    throw new SourceError('not_implemented', 'Validated candidate; normalized versioned commit is not wired yet');
  }
}
