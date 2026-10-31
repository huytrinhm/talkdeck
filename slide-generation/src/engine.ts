import { randomUUID } from 'node:crypto';
import { expandSource } from './expansion.js';
import { advanceVersions, prepareCandidate } from './source/candidate.js';
import { ingestCandidate, type InputUtterance } from './source/ingestion.js';
import { parseAndValidate, childNodes, type SchemaOptions } from './schema.js';
import { Trace } from './telemetry/trace.js';
import { lineHash, SnapshotStore } from './hashline.js';
import { SourceError, transactionSchema, type DeckDocument, type ValidationPipeline, type ValidationReport } from './contracts.js';
import { nodeById, nodes, parseSource, textContent } from './parser.js';
import { introducedErrors, ready, UnavailableValidation } from './validation.js';
import type { DeckRepository } from './storage/repository.js';
import type { EvidenceInbox } from './storage/inbox.js';
import { DurabilityError } from './storage/files.js';
import { restoreContentCandidate } from './source/history.js';

export interface CommitServices {
  repository: DeckRepository;
  normalize(source: string): Promise<string>;
  schema?: SchemaOptions;
  inbox?: EvidenceInbox;
}
export interface CommittedRevision { revision: string; document: DeckDocument; reason: 'edit' | 'input'; transactionId?: string }
export class SlideEngine {
  readonly snapshots = new SnapshotStore();
  private document: DeckDocument;
  private editTail: Promise<unknown> = Promise.resolve();
  private writeTail: Promise<unknown> = Promise.resolve();
  private drainTail: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(event: CommittedRevision) => void>();
  private readonly retries = new Map<string, { digest: string; promise: ReturnType<SlideEngine['runEdit']> }>();
  private lastCheckComplete = false;
  private lastInputError?: string;
  private notificationFailures = 0;
  private blockedInputIds: string[] = [];
  constructor(document: DeckDocument, private validation: ValidationPipeline = new UnavailableValidation(), private trace = new Trace(), private services?: CommitServices) {
    this.document = { ...document, source: document.source.replace(/\r\n?/g, '\n') };
    parseSource(this.document.source);
  }
  readDocument(): DeckDocument { return { ...this.document }; }
  state() { return { revision: lineHash(this.document.source), commitConfigured: !!this.services,
    mutationsReady: !!this.services && this.lastCheckComplete, lastInputError: this.lastInputError, blockedInputIds: [...this.blockedInputIds], notificationFailures: this.notificationFailures }; }
  readSource(nodeId: string) {
    const root = parseSource(this.document.source);
    if (![...nodes(root)].some(n => n.id === nodeId)) {
      const tag = ({ deck: 'Deck', theme: 'Theme', library: 'Library' } as Record<string, string>)[nodeId];
      if (tag) nodeId = [...nodes(root)].find(n => n.tag === tag)!.id!;
    }
    const read = this.snapshots.read(this.document.source, nodeId);
    this.trace.emit('source.read', { deckId: root.id!, revision: read.revision, toolCallId: read.snapshotId });
    return read;
  }
  readSpeakerNotes(slideId: string) {
    const root = parseSource(this.document.source);
    const slide = [...nodes(root)].find(n => n.tag === 'ArchivedSlide' && n.props.slideId === slideId) ?? nodeById(root, slideId);
    if (!['Slide', 'ArchivedSlide'].includes(slide.tag)) throw new SourceError('not_slide', 'Expected a slide ID', slideId);
    const children = childNodes(slide), notes = children.find(n => n.tag === 'SpeakerNotes'), transcript = children.find(n => n.tag === 'Transcript');
    return { slideId, version: slide.props.version, archived: slide.tag === 'ArchivedSlide',
      notes: notes ? textContent(notes) : '', transcript: transcript ? this.document.source.slice(transcript.start, transcript.end) : '' };
  }
  listLibrary() { return expandSource(this.document.source, this.services?.schema).library; }
  async readiness() {
    const source = this.document.source, report = await this.check(source);
    return { ...report, revision: lineHash(source), ready: source === this.document.source && ready(report) };
  }
  subscribe(listener: (event: CommittedRevision) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(reason: CommittedRevision['reason'], transactionId?: string) {
    const event = { revision: lineHash(this.document.source), document: this.readDocument(), reason, transactionId };
    for (const listener of this.listeners) {
      try { Promise.resolve(listener(event)).catch(() => { this.notificationFailures++; }); } catch { this.notificationFailures++; }
    }
  }
  /** Trusted host ingestion; the receipt means durable queue retention, not model completion. */
  async ingest(input: InputUtterance) {
    if (!this.services?.inbox) throw new SourceError('ingestion_unavailable', 'Durable input inbox is not configured');
    // The short write lock orders durable receipt against deletion/CAS. It never
    // covers inference or browser validation. Known duplicate conflicts refuse before
    // acknowledgement and cannot poison an otherwise healthy inbox.
    const receipt = await this.withWrite(async () => {
      const existing = [...nodes(parseSource(this.document.source))].some(n => n.tag === 'Prompt' && n.props.utteranceId === input.id);
      if (existing) {
        ingestCandidate(this.document.source, input); // exact payload/target/timestamp comparison
        return { utteranceId: input.id, duplicate: true, blocked: false, committed: true };
      }
      return { ...await this.services!.inbox!.retain(input), committed: false };
    });
    const retainedAtMs = performance.now();
    this.trace.emit('input.retained', { deckId: parseSource(this.document.source).id!, revision: lineHash(this.document.source), utteranceId: input.id });
    if (!receipt.committed) this.drainTail = this.drainTail.catch(() => {}).then(() => this.flushInput()).catch(error => {
      this.lastInputError = error instanceof SourceError ? error.code : 'input_storage';
    });
    return { ...receipt, revision: lineHash(this.document.source), retainedAtMs, pending: !receipt.committed };
  }
  async flushInput() {
    if (!this.services?.inbox) return;
    await this.withWrite(() => this.flushInputLocked());
  }
  private async flushInputLocked() {
    if (!this.services?.inbox) return;
    const services = this.services, inbox = services.inbox!;
    for (const event of await inbox.pending()) {
      let result: ReturnType<typeof ingestCandidate>;
      try { result = ingestCandidate(this.document.source, event); }
      catch (error) {
        if (!(error instanceof SourceError) || !['missing_node', 'not_slide', 'input_reference', 'input_conflict', 'evidence_missing', 'source_limit', 'id_limit'].includes(error.code)) throw error;
        // Stale/missing attribution is explicit blocked evidence, not a reason to
        // lose words, silently choose another target, or stall every later utterance.
        await inbox.block(event.id, { code: error.code, message: error.message });
        continue;
      }
      if (!result.duplicate) {
        parseAndValidate(result.source, services.schema);
        await this.persist(this.document.source, result.source);
        this.publish('input');
      }
      await inbox.complete(event.id, this.document.source);
    }
    const blocked = await inbox.blocked();
    this.blockedInputIds = blocked.map(record => record.event.id);
    this.lastInputError = blocked[0]?.failure.code;
  }
  async settledInput() { await this.drainTail; return { pendingError: this.lastInputError }; }
  edit(input: unknown, idempotencyKey?: string, commitGuard?: () => void) {
    if (idempotencyKey !== undefined) {
      if (!/^[\w.-]{1,128}$/.test(idempotencyKey)) throw new SourceError('idempotency_key', 'Invalid idempotency key');
      const digest = lineHash(JSON.stringify(transactionSchema.parse(input)));
      const existing = this.retries.get(idempotencyKey);
      if (existing) {
        if (existing.digest !== digest) throw new SourceError('idempotency_conflict', 'Idempotency key already used for different edits');
        return existing.promise;
      }
      const promise = this.runEdit(input, commitGuard);
      this.retries.set(idempotencyKey, { digest, promise });
      while (this.retries.size > 256) this.retries.delete(this.retries.keys().next().value!);
      return promise;
    }
    return this.runEdit(input, commitGuard);
  }
  private runEdit(input: unknown, commitGuard?: () => void) {
    const transactionId = randomUUID();
    const run = this.editTail.then(async () => {
      const cause = { deckId: parseSource(this.document.source).id!, revision: lineHash(this.document.source), transactionId };
      this.trace.emit('edit.started', cause);
      try {
        commitGuard?.();
        const result = await this.transact(input, transactionId, commitGuard);
        this.trace.emit(result.accepted ? 'edit.committed' : 'edit.refused', { ...cause, revision: result.revision }, result.accepted ? undefined : 'new_errors');
        return result;
      } catch (error) {
        this.trace.emit('edit.refused', cause, error instanceof SourceError ? error.code : 'internal');
        throw error;
      }
    });
    this.editTail = run.catch(() => {});
    return run;
  }
  private async check(source: string): Promise<ValidationReport> {
    try { const report = await this.validation.check(source); this.lastCheckComplete = report.complete; return report; }
    catch (error) { this.lastCheckComplete = false; throw error; }
  }
  private withWrite<T>(action: () => Promise<T>): Promise<T> {
    const run = this.writeTail.then(action); this.writeTail = run.catch(() => {}); return run;
  }
  private async persist(current: string, source: string) {
    if (!this.services) throw new SourceError('not_implemented', 'Normalized durable commit is not configured');
    try {
      const stored = await this.services.repository.compareAndSwap(lineHash(current), { schemaVersion: 1, source });
      this.document = stored.document;
    } catch (error) {
      if (error instanceof DurabilityError) {
        // Replacement is known to have occurred. Keep that candidate observable
        // even if the recovery read itself fails; never return the old source.
        this.document = { schemaVersion: 1, source };
        try { this.document = (await this.services.repository.load()).document; } catch { /* known replacement retained above */ }
        this.lastCheckComplete = false;
        throw new SourceError('durability_uncertain', 'Replacement occurred but durability confirmation failed; reload source before retry');
      }
      if (error instanceof SourceError && error.code === 'revision_conflict') {
        this.document = (await this.services.repository.load()).document;
        this.lastCheckComplete = false;
      }
      throw error;
    }
  }
  private async transact(input: unknown, transactionId: string, commitGuard?: () => void) {
    const transaction = transactionSchema.parse(input);
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = this.document.source, staged = this.snapshots.stage(current, transaction.edits);
      const prepared = prepareCandidate(current, staged);
      let candidate = expandSource(prepared.source, this.services?.schema).source;
      if (this.services) candidate = await this.services.normalize(candidate);
      const before = expandSource(current, this.services?.schema), after = expandSource(candidate, this.services?.schema);
      candidate = after.source;
      const oldRoot = parseSource(current), newRoot = parseSource(candidate);
      const oldNodes = new Map([...nodes(oldRoot)].map(n => [n.id!, n]));
      const newNodes = new Map([...nodes(newRoot)].map(n => [n.id!, n]));
      const changedNode = (id: string) => {
        const old = oldNodes.get(id), next = newNodes.get(id);
        return !old || !next || current.slice(old.start, old.end) !== candidate.slice(next.start, next.end);
      };
      const themeChanged = [...oldNodes.values()].some(n => n.tag === 'Theme' && changedNode(n.id!));
      const affectedSlides = new Set(after.slides.filter(slide => themeChanged || changedNode(slide.id)).map(n => n.id));
      const numbered = [...oldNodes.values(), ...newNodes.values()].some(n => n.tag === 'Frame' && n.props.page === true);
      if (numbered) {
        const priorPositions = new Map(before.slides.map((slide, index) => [slide.id, index]));
        for (const [index, slide] of after.slides.entries()) if (priorPositions.get(slide.id) !== index) affectedSlides.add(slide.id);
      }
      for (const entry of [...before.library, ...after.library]) if (changedNode(entry.id))
        for (const slideId of entry.dependentSlides) affectedSlides.add(slideId);
      const assignedIds = [...newNodes.keys()].filter(id => !oldNodes.has(id));
      // Versions are staged before validation and stored only after all checks complete.
      candidate = advanceVersions(current, candidate, affectedSlides);
      parseAndValidate(candidate, this.services?.schema);
      const baseline = await this.check(current), report = await this.check(candidate);
      if (!baseline.complete || !report.complete) throw new SourceError('validation_unavailable', 'All required validation stages must complete before an edit can commit');
      const errors = introducedErrors(baseline.findings, report.findings);
      if (errors.length) return { accepted: false as const, findings: errors, revision: lineHash(current) };
      if (!this.services) throw new SourceError('not_implemented', 'Validated candidate; normalized versioned commit is not wired yet');
      const committed = await this.withWrite(async () => {
        // Load current canonical state before the no-op branch too. Other engine
        // objects sharing this single-process repository cannot leave stale reads.
        const latest = await this.services!.repository.load();
        if (latest.document.source !== this.document.source) { this.document = latest.document; this.lastCheckComplete = false; }
        await this.flushInputLocked();
        if (current !== this.document.source) return undefined;
        commitGuard?.();
        if (candidate !== current) await this.persist(current, candidate);
        const noOp = candidate === current;
        const root = parseSource(this.document.source);
        const result = { accepted: true as const, transactionId, revision: lineHash(this.document.source), noOp,
          assignedIds, affectedIds: [...new Set([...transaction.edits.map(e => e.nodeId), ...affectedSlides])],
          versions: Object.fromEntries([...nodes(root)].filter(n => n.props.version !== undefined).map(n => [n.id!, n.props.version])),
          source: this.readSource(root.id!), findings: report.findings.filter(f => f.severity === 'warning'), pendingNodeIds: report.pendingNodeIds };
        if (!noOp) this.publish('edit', transactionId);
        return result;
      });
      if (committed) return committed;
      // Restage exact ranges against newly retained input/current dependencies.

    }
    throw new SourceError('revision_conflict', 'Source changed repeatedly during validation; reread and retry');
  }

  /** Trusted user history control. Restore visual source while retaining all current evidence. */
  restoreContent(snapshot: string, commitGuard?: () => void) {
    const run = this.editTail.then(async () => {
      if (!this.services) throw new SourceError('not_implemented', 'Durable history is not configured');
      for (let attempt = 0; attempt < 3; attempt++) {
        commitGuard?.();
        const current = this.document.source;
        let candidate = restoreContentCandidate(current, snapshot);
        candidate = await this.services.normalize(candidate);
        parseAndValidate(candidate, this.services.schema);
        const baseline = await this.check(current), report = await this.check(candidate);
        if (!baseline.complete || !report.complete) throw new SourceError('validation_unavailable', 'History restoration requires all browser checks');
        if (introducedErrors(baseline.findings, report.findings).length) throw new SourceError('history_validation', 'Restored content introduces validation errors');
        const result = await this.withWrite(async () => {
          await this.flushInputLocked();
          if (current !== this.document.source) return undefined;
          commitGuard?.();
          if (candidate !== current) { await this.persist(current, candidate); this.publish('edit'); }
          return { revision: lineHash(this.document.source), changed: candidate !== current };
        });
        if (result) return result;
      }
      throw new SourceError('revision_conflict', 'Input changed during history restoration');
    });
    this.editTail = run.catch(() => {});
    return run;
  }
}
