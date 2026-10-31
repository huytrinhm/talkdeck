import { prepareCandidate } from './source/candidate.js';
import { parseAndValidate } from './schema.js';
import { randomUUID } from 'node:crypto';
import { Trace } from './telemetry/trace.js';
import { lineHash } from './hashline.js';
import { SourceError, transactionSchema, type DeckDocument, type ValidationPipeline } from './contracts.js';
import { SnapshotStore } from './hashline.js';
import { nodeById, nodes, parseSource, textContent } from './parser.js';
import { introducedErrors, ready, UnavailableValidation } from './validation.js';

export class SlideEngine {
  readonly snapshots = new SnapshotStore();
  private document: DeckDocument;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(document: DeckDocument, private validation: ValidationPipeline = new UnavailableValidation(), private trace = new Trace()) {
    this.document = { ...document, source: document.source.replace(/\r\n?/g, '\n') };
    parseSource(this.document.source);
  }
  readDocument(): DeckDocument { return { ...this.document }; }
  readSource(nodeId: string) {
    const read = this.snapshots.read(this.document.source, nodeId);
    this.trace.emit('source.read', { deckId: parseSource(this.document.source).id!, revision: lineHash(this.document.source), toolCallId: read.snapshotId });
    return read;
  }
  readSpeakerNotes(slideId: string) {
    const root = parseSource(this.document.source);
    const slide = [...nodes(root)].find(n => n.tag === 'ArchivedSlide' && n.props.slideId === slideId) ?? nodeById(root, slideId);
    if (!['Slide', 'ArchivedSlide'].includes(slide.tag)) throw new SourceError('not_slide', 'Expected a slide ID', slideId);
    const children = slide.children.filter(child => typeof child !== 'string');
    const notes = children.find(child => child.tag === 'SpeakerNotes');
    const transcript = children.find(child => child.tag === 'Transcript');
    return {
      slideId, version: slide.props.version, archived: slide.tag === 'ArchivedSlide',
      notes: notes ? textContent(notes) : '',
      transcript: transcript ? this.document.source.slice(transcript.start, transcript.end) : '',
    };
  }
  async readiness() { const report = await this.validation.check(this.document.source); return { ready: ready(report), ...report }; }
  edit(input: unknown) {
    // Serializes reads of the current committed state, validation, and publication.
    const transactionId = randomUUID();
    const run = this.tail.then(async () => {
      const cause = { deckId: parseSource(this.document.source).id!, revision: lineHash(this.document.source), transactionId };
      this.trace.emit('edit.started', cause);
      try {
        const result = await this.transact(input);
        this.trace.emit('edit.refused', cause, 'new_errors');
        return result;
      } catch (error) {
        this.trace.emit('edit.refused', cause, error instanceof SourceError ? error.code : 'internal');
        throw error;
      }
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
  private async transact(input: unknown) {
    const transaction = transactionSchema.parse(input);
    const current = this.document.source;
    const staged = this.snapshots.stage(current, transaction.edits);
    const candidate = prepareCandidate(current, staged).source;
    parseAndValidate(candidate);
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
