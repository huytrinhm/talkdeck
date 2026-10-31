import type { createLocalRuntime } from '../runtime.js';
import type { RunRecorder } from '../evaluation/recorder.js';
import { GenerationSession, type HostEvent } from '../host/session.js';
import { HeadlessViewer } from './viewer.js';
import { childNodes } from '../schema.js';
import { parseSource } from '../parser.js';
import { lineHash } from '../hashline.js';
import type { CommittedRevision } from '../engine.js';

export interface HeadlessSessionOptions { slideId: string; mode?: 'editor' | 'presentation'; onHostEvent?: (event: HostEvent) => void | Promise<void> }
/** Recorder and real browser transport around the canonical session; no model scheduler. */
export class HeadlessRecordingSession {
  private stateTail: Promise<void> = Promise.resolve();
  private failures: unknown[] = [];
  private recorded = new Set<string>();
  private previousSource = '';
  private unsubscribe: () => void;
  readonly session: GenerationSession;
  private constructor(readonly runtime: Awaited<ReturnType<typeof createLocalRuntime>>, readonly recorder: RunRecorder,
    readonly viewer: HeadlessViewer, options: HeadlessSessionOptions) {
    const record = async (event: HostEvent) => {
      if (event.type === 'publication-refused') this.failures.push(new Error(`Publication ${event.revision} refused: ${event.code}`));
      await options.onHostEvent?.(event);
    };
    this.session = new GenerationSession(runtime.engine, runtime.tools, runtime.renderer, runtime.browser,
      { ...options, channel: viewer.channel, record, send: message => viewer.send(message) });
    viewer.setAcknowledgmentHandler((ack, clock) => this.session.acknowledge(ack, clock));
    this.unsubscribe = runtime.engine.subscribe(event => this.recordState(event));
    const document = runtime.engine.readDocument();
    this.recordState({ document, revision: lineHash(document.source), reason: 'input' });
  }
  static async create(runtime: Awaited<ReturnType<typeof createLocalRuntime>>, recorder: RunRecorder, options: HeadlessSessionOptions) {
    const viewer = await HeadlessViewer.create({ recorder });
    return new HeadlessRecordingSession(runtime, recorder, viewer, options);
  }
  private recordState(event: CommittedRevision) {
    if (this.recorded.has(event.revision)) return;
    this.recorded.add(event.revision);
    const atMs = performance.now(), before = this.previousSource;
    this.previousSource = event.document.source;
    this.stateTail = this.stateTail.then(async () => {
      const source = event.document.source;
      // Trusted transcript/notes commits cannot change render artifacts. Preserve their
      // exact source without adding a second browser pass for each speech input.
      const sourceOnly = event.reason === 'input';
      const checks = sourceOnly ? { performed: false, reason: 'evidence-only commit' } : await this.runtime.browser.check(source);
      const renders = sourceOnly ? [] : await Promise.all(childNodes(parseSource(source)).filter(n => n.tag === 'Slide').map(async slide => {
        const artifact = await this.runtime.renderer.render(source, slide.id!);
        return { slideId: slide.id!, html: artifact.html, css: artifact.css, dependenciesJson: JSON.stringify(artifact.dependencies) };
      }));
      await this.recorder.state({ revision: event.revision, atMs, source, reason: event.reason,
        normalizedDiff: JSON.stringify({ beforeSha256: lineHash(before), afterSha256: event.revision, beforeSource: before, afterSource: source }), checksJson: JSON.stringify(checks), renders });
    }).catch(error => { this.failures.push(error); });
  }
  async settle() {
    await this.session.settle(); await this.stateTail; await this.viewer.settled(); await this.recorder.flush();
    if (this.failures.length) throw new AggregateError(this.failures, 'Headless publication or state recording failed');
  }
  async close() {
    this.unsubscribe();
    try { await this.session.close(); await this.settle(); } finally { await this.viewer.close(); }
  }
}
