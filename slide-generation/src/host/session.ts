import { randomUUID } from 'node:crypto';
import { SourceError } from '../contracts.js';
import type { SlideEngine, CommittedRevision } from '../engine.js';
import type { HonoSlideRenderer } from '../render/renderer.js';
import type { BrowserValidationPipeline } from '../browser/pipeline.js';
import { ready } from '../validation.js';
import { acknowledgmentSchema, buildSchema, DEFAULT_MOTION, type BuildMessage, type ViewerAcknowledgment, type PublicationMessage } from '../viewer/protocol.js';
import { lineHash } from '../hashline.js';
import type { InputUtterance } from '../source/ingestion.js';
import type { ToolRegistry } from '../tools.js';
import { parseSource } from '../parser.js';
import { childNodes } from '../schema.js';

export type HostEvent =
  | { type: 'publication'; atMs: number; message: PublicationMessage }
  | { type: 'build'; atMs: number; message: BuildMessage; publicationId: string; slideId: string }
  | { type: 'viewer'; atMs: number; acknowledgment: ViewerAcknowledgment; clockOffsetMs: number; clockUncertaintyMs: number }
  | { type: 'publication-refused'; atMs: number; revision: string; code: string }
  | { type: 'committed'; atMs: number; revision: string; reason: 'edit' | 'input' };
export interface SessionOptions {
  channel: string;
  slideId: string;
  mode?: 'editor' | 'presentation';
  /** Integrator transports the strict message to the mounted viewer bridge. */
  send(message: PublicationMessage): void | Promise<void>;
  /** Optional for existing publication-only consumers. Builds share the publication sequence. */
  sendBuild?(message: BuildMessage): void | Promise<void>;
  record(event: HostEvent): void | Promise<void>;
}
/** Publication/acknowledgment adapter, deliberately no inference or actor scheduling. */
export class GenerationSession {
  private sequence = 0;
  private selected: string;
  private slideOrder: string[];
  private mode: 'editor' | 'presentation';
  private tail: Promise<unknown> = Promise.resolve();
  private readonly sent = new Map<number, Pick<PublicationMessage, 'publicationId' | 'revision' | 'slideId' | 'sequence' | 'build'>>();
  private current?: PublicationMessage;
  private controlEpoch = 0;
  private build = 0;
  private readonly unsubscribe: () => void;
  private closed = false;
  constructor(readonly engine: SlideEngine, readonly tools: ToolRegistry, private renderer: HonoSlideRenderer,
    private browser: BrowserValidationPipeline, private options: SessionOptions) {
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(options.channel)) throw new Error('Invalid viewer channel');
    this.selected = options.slideId; this.mode = options.mode ?? 'editor';
    this.slideOrder = childNodes(parseSource(engine.readDocument().source)).filter(node => node.tag === 'Slide').map(node => node.id!);
    this.unsubscribe = engine.subscribe(event => this.enqueue(event, true));
  }
  private async record(event: HostEvent) { await this.options.record(event); }
  deliverUtterance(input: InputUtterance) { return this.engine.ingest(input); }
  readSource(nodeId: string) { return this.engine.readSource(nodeId); }
  editSource(input: unknown) { return this.engine.edit(input); }
  /** Target identity comes from real host selection, never fixture annotations. */
  async selectSlide(slideId: string, mode = this.mode, build = 0) {
    if (!Number.isSafeInteger(build) || build < 0) throw new SourceError('viewer_build', 'Build must be a nonnegative integer');
    this.selected = slideId; this.mode = mode; this.build = build; this.controlEpoch++;
    this.enqueue({ revision: lineHash(this.engine.readDocument().source), document: this.engine.readDocument(), reason: 'edit' });
    await this.settle();
  }
  /** Serialized after publication, with an independently acknowledged command sequence. */
  async setBuild(build: number, holdIds: string[] = []) {
    if (!this.options.sendBuild) throw new SourceError('viewer_build_transport', 'Build transport is not configured');
    const epoch = this.controlEpoch;
    const command = this.tail.catch(() => {}).then(async () => {
      if (this.closed || epoch !== this.controlEpoch) throw new SourceError('viewer_stale_control', 'Viewer selection changed');
      const publication = this.current;
      if (!publication || publication.slideId !== this.selected || publication.mode !== this.mode)
        throw new SourceError('viewer_publication', 'A valid publication is required before a build');
      const message = buildSchema.parse({ version: 1, channel: this.options.channel, type: 'build',
        sequence: this.sequence + 1, revision: publication.revision, build, holdIds });
      this.sequence = message.sequence;
      this.build = build;
      this.current = { ...publication, sequence: message.sequence, build, holdIds: [...holdIds] };
      this.remember(this.current);
      await this.record({ type: 'build', atMs: performance.now(), message, publicationId: publication.publicationId, slideId: publication.slideId });
      await this.options.sendBuild!(message);
      return message;
    });
    this.tail = command;
    return command;
  }
  private remember(message: PublicationMessage) {
    const { publicationId, revision, slideId, sequence, build } = message;
    this.sent.set(sequence, { publicationId, revision, slideId, sequence, build });
    while (this.sent.size > 256) this.sent.delete(this.sent.keys().next().value!);
  }
  private enqueue(event: CommittedRevision, committed = false) {
    if (committed) {
      const nextOrder = childNodes(parseSource(event.document.source)).filter(node => node.tag === 'Slide').map(node => node.id!);
      // A deletion is already canonical when observers run. Resolve selection against
      // this exact revision before capturing the publication, matching the host's
      // existing nearest-surviving-slide policy even when its observer runs later.
      if (nextOrder.length && !nextOrder.includes(this.selected))
        this.selected = nextOrder[Math.min(Math.max(0, this.slideOrder.indexOf(this.selected)), nextOrder.length - 1)];
      this.slideOrder = nextOrder;
    }
    const slideId = this.selected, mode = this.mode, epoch = this.controlEpoch, build = this.build;
    this.tail = this.tail.catch(() => {}).then(async () => {
      if (this.closed || epoch !== this.controlEpoch) return;
      if (committed) await this.record({ type: 'committed', atMs: performance.now(), revision: event.revision, reason: event.reason });
      // Input evidence stays private and does not publish a new audience surface.
      if (committed && event.reason === 'input') return;
      try {
        const artifact = await this.renderer.render(event.document.source, slideId);
        const report = await this.browser.check(event.document.source);
        if (!report.complete) throw new SourceError('validation_unavailable', 'Publication checks did not complete');
        const presentationReady = ready(report);
        if (mode === 'presentation' && !presentationReady) throw new SourceError('presentation_blocked', 'Complete deck is not ready for presentation');
        if (this.closed || epoch !== this.controlEpoch) return;
        const message: PublicationMessage = { version: 1, channel: this.options.channel, type: 'publish', sequence: ++this.sequence,
          publicationId: randomUUID(), revision: event.revision, slideId, html: artifact.html, css: artifact.css,
          mode, readiness: { revision: event.revision, ready: presentationReady }, motion: { ...DEFAULT_MOTION }, build, holdIds: [] };
        this.current = message;
        this.remember(message);
        await this.record({ type: 'publication', atMs: performance.now(), message });
        await this.options.send(message);
      } catch (error) {
        await this.record({ type: 'publication-refused', atMs: performance.now(), revision: event.revision,
          code: error instanceof SourceError ? error.code : 'publication_failed' });
      }
    });
  }
  async acknowledge(input: unknown, clock: { offsetMs: number; uncertaintyMs: number }) {
    const acknowledgment = acknowledgmentSchema.parse(input);
    if (acknowledgment.channel !== this.options.channel) throw new SourceError('viewer_channel', 'Wrong viewer channel');
    if (!Number.isFinite(clock.offsetMs) || !Number.isFinite(clock.uncertaintyMs) || clock.uncertaintyMs < 0)
      throw new SourceError('viewer_clock', 'A measured clock offset and nonnegative uncertainty are required');
    if (acknowledgment.type !== 'ready') {
      const publication = acknowledgment.sequence === undefined ? undefined : this.sent.get(acknowledgment.sequence);
      if (!publication || publication.publicationId !== acknowledgment.publicationId || publication.revision !== acknowledgment.revision || publication.slideId !== acknowledgment.slideId ||
        (acknowledgment.build !== undefined && publication.build !== acknowledgment.build))
        throw new SourceError('viewer_publication', 'Acknowledgment does not identify an issued publication');
    }
    await this.record({ type: 'viewer', atMs: performance.now(), acknowledgment, clockOffsetMs: clock.offsetMs, clockUncertaintyMs: clock.uncertaintyMs });
  }
  async settle() { await this.tail; }
  async close() { this.closed = true; this.unsubscribe(); await this.tail; }
}
