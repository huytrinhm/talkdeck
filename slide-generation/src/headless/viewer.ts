import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { join } from 'node:path';
import { createViewerDocument } from '../viewer/document.js';
import { acknowledgmentSchema, publicationSchema, type ViewerAcknowledgment, type PublicationMessage } from '../viewer/protocol.js';
import type { RunRecorder } from '../evaluation/recorder.js';
import type { VisibleFrame, VisibleContent } from '../evaluation/audit.js';

type PublicationIdentity = Pick<PublicationMessage, 'publicationId' | 'sequence' | 'revision' | 'slideId' | 'mode'>;
export interface ViewerClock { offsetMs: number; uncertaintyMs: number }
export interface CapturedFrame extends VisibleFrame {
  publicationId: string; surface: 'editor' | 'audience'; captureStartedAtMs: number; captureFinishedAtMs: number;
  trigger: 'painted' | 'settled'; coherent: boolean;
}
export interface HeadlessViewerOptions {
  recorder: RunRecorder; channel?: string; timeoutMs?: number;
  onAcknowledgment?: (acknowledgment: ViewerAcknowledgment, clock: ViewerClock) => void | Promise<void>;
}
/** A real opaque packaged iframe; evaluator frames never enter model context. */
export class HeadlessViewer {
  readonly channel: string;
  private tail: Promise<void> = Promise.resolve();
  private handler?: HeadlessViewerOptions['onAcknowledgment'];
  private errors: Error[] = [];
  private captured: CapturedFrame[] = [];
  private publications = new Map<string, PublicationIdentity>();
  private lastSequence?: number;
  private frameNumber = 0;
  private epochOffsetMs = 0;
  private uncertaintyMs = 0;
  private closed = false;
  private constructor(private options: HeadlessViewerOptions, private browser: Browser, private context: BrowserContext, private page: Page) {
    this.channel = options.channel ?? randomUUID().replaceAll('-', '_'); this.handler = options.onAcknowledgment;
  }
  static async create(options: HeadlessViewerOptions) {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block',
        recordVideo: { dir: join(options.recorder.directory, 'viewer'), size: { width: 1920, height: 1080 } } });
      await context.route('**/*', route => route.abort('blockedbyclient'));
      await context.routeWebSocket('**/*', socket => socket.close());
      const page = await context.newPage(), viewer = new HeadlessViewer(options, browser, context, page);
      page.setDefaultTimeout(options.timeoutMs ?? 15_000);
      page.on('pageerror', error => viewer.errors.push(error));
      let initialized!: () => void;
      const initialization = new Promise<void>(resolve => { initialized = resolve; });
      await page.exposeBinding('recordViewerAcknowledgment', ({ frame }, raw: unknown) => {
        if (frame !== page.mainFrame()) return;
        const receivedAtMs = performance.now();
        viewer.tail = viewer.tail.then(async () => { await initialization; await viewer.receive(raw, receivedAtMs); }).catch(error => { viewer.errors.push(error instanceof Error ? error : new Error(String(error))); });
      });
      await page.setContent('<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}</style><iframe sandbox="allow-scripts" referrerpolicy="no-referrer" title="Headless slide viewer"></iframe>');
      await page.evaluate(({ source, channel }) => {
        const state = window as any; state.viewerAcks = [];
        addEventListener('message', event => {
          if (event.source !== document.querySelector('iframe')!.contentWindow || event.origin !== 'null' || event.data?.channel !== channel) return;
          state.viewerAcks.push(event.data);
          void state.recordViewerAcknowledgment(event.data);
        });
        document.querySelector('iframe')!.srcdoc = source;
      }, { source: createViewerDocument(viewer.channel), channel: viewer.channel });
      await page.waitForFunction(() => (window as any).viewerAcks.some((a: any) => a.type === 'ready'));
      const before = performance.now();
      const browserEpoch = await page.evaluate(() => performance.timeOrigin + performance.now());
      const after = performance.now();
      viewer.epochOffsetMs = (before + after) / 2 - browserEpoch; viewer.uncertaintyMs = (after - before) / 2;
      initialized(); await viewer.tail; viewer.throwErrors(); return viewer;
    } catch (error) { await browser.close(); throw error; }
  }
  setAcknowledgmentHandler(handler: NonNullable<HeadlessViewerOptions['onAcknowledgment']>) { this.handler = handler; }
  private throwErrors() { if (this.errors.length) throw new AggregateError(this.errors, `Headless viewer or evidence recording failed: ${this.errors.map(error => error.message).join('; ')}`); }
  async send(input: PublicationMessage) {
    if (this.closed) throw new Error('Headless viewer is closed');
    this.throwErrors();
    const message = publicationSchema.parse(input);
    if (message.channel !== this.channel) throw new Error('Wrong headless viewer channel');
    if (this.lastSequence !== undefined && message.sequence <= this.lastSequence) throw new Error('Publication sequence must increase');
    this.lastSequence = message.sequence; this.publications.set(message.publicationId, { publicationId: message.publicationId, sequence: message.sequence, revision: message.revision, slideId: message.slideId, mode: message.mode });
    await this.options.recorder.publication(message, performance.now());
    await this.page.evaluate(message => document.querySelector('iframe')!.contentWindow!.postMessage(message, '*'), message);
  }
  private async receive(raw: unknown, receivedAtMs: number) {
    const ack = acknowledgmentSchema.parse(raw);
    if (ack.channel !== this.channel) throw new Error('Wrong acknowledgment channel');
    const publication = ack.publicationId ? this.publications.get(ack.publicationId) : undefined;
    if (ack.type !== 'ready' && (!publication || publication.sequence !== ack.sequence || publication.revision !== ack.revision || publication.slideId !== ack.slideId)) throw new Error('Unissued viewer acknowledgment');
    const clock = { offsetMs: this.epochOffsetMs + ack.timeOriginMs, uncertaintyMs: this.uncertaintyMs };
    await this.handler?.(ack, clock);
    await this.options.recorder.viewer({ acknowledgment: ack, receivedAtMs, clockOffsetMs: clock.offsetMs, clockUncertaintyMs: clock.uncertaintyMs,
      surface: publication?.mode === 'presentation' ? 'audience' : 'editor' });
    if (publication && (ack.type === 'painted' || ack.type === 'settled')) await this.capture(publication, ack.type);
    if (ack.type === 'refused') throw new Error(`Viewer refused ${ack.publicationId}: ${ack.code}`);
    if (ack.type === 'settled' && !ack.domEquivalent) throw new Error('Viewer did not settle to exact final DOM');
  }
  private async capture(triggerPublication: PublicationIdentity, trigger: 'painted' | 'settled') {
    const latest = () => this.page.evaluate(() => (window as any).viewerAcks.findLast((a: any) => a.type === 'applied') as ViewerAcknowledgment | undefined);
    const before = await latest();
    if (!before?.publicationId) return;
    const publication = this.publications.get(before.publicationId)!;
    const captureStartedAtMs = performance.now();
    const frame = this.page.frames().find(frame => frame.parentFrame() === this.page.mainFrame());
    if (!frame) throw new Error('Viewer iframe disappeared');
    const projection = await frame.evaluate(() => {
      const visible = [(element: Element) => {
        const box = element.getBoundingClientRect();
        if (!box.width || !box.height || box.right <= 0 || box.bottom <= 0 || box.left >= innerWidth || box.top >= innerHeight) return false;
        for (let node: Element | null = element; node; node = node.parentElement) {
          const style = getComputedStyle(node); if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) <= 0) return false;
        }
        return true;
      }][0];
      const content = [...document.querySelectorAll('#stage [data-node]')].filter(visible).flatMap<VisibleContent>(node => {
        const kind = node.getAttribute('data-primitive') ?? 'Text', nodeId = node.getAttribute('data-node')!;
        const owned = [...node.querySelectorAll('[data-content]')].filter(el => el.closest('[data-node]') === node && visible(el));
        if (node.matches('[data-content]')) owned.unshift(node);
        if (!owned.length) return [];
        if (kind === 'Stat') {
          const value = node.querySelector('[data-stat-value]'), label = node.querySelector('.td-secondary');
          return value && visible(value) ? [{ nodeId, kind, text: value.textContent ?? '', label: label && visible(label) ? label.textContent ?? '' : undefined }] : [];
        }
        if (kind === 'Quote') {
          const body = node.querySelector('.td-quote-body'), by = node.querySelector('cite');
          return body && visible(body) ? [{ nodeId, kind, text: body.textContent ?? '', by: by && visible(by) ? by.textContent ?? '' : undefined }] : [];
        }
        return owned.map(element => ({ nodeId, kind, text: element.textContent ?? '', role: element.getAttribute('data-role') ?? undefined }));
      });
      return { content, pending: [...document.querySelectorAll('[data-pending]')].some(visible), sampledEpochMs: performance.timeOrigin + performance.now() };
    });
    const name = `frame-${String(++this.frameNumber).padStart(6, '0')}.png`;
    await this.options.recorder.binary('viewer', name, await this.page.screenshot({ type: 'png' }));
    const after = await latest(), captureFinishedAtMs = performance.now();
    const coherent = before.sequence === after?.sequence && before.publicationId === triggerPublication.publicationId;
    const captured: CapturedFrame = { content: projection.content, pending: projection.pending, revision: publication.revision, slideId: publication.slideId, publicationId: publication.publicationId,
      atMs: projection.sampledEpochMs + this.epochOffsetMs, painted: coherent, coherent, trigger, surface: publication.mode === 'presentation' ? 'audience' : 'editor',
      captureStartedAtMs, captureFinishedAtMs, evidence: `viewer/${name}` };
    this.captured.push(captured); await this.options.recorder.visibleFrame(captured);
  }
  frames(): readonly CapturedFrame[] { return this.captured.map(frame => structuredClone(frame)); }
  async settled() {
    if (this.lastSequence !== undefined) await this.page.waitForFunction(sequence => (window as any).viewerAcks.some((a: any) => a.sequence === sequence && ['settled', 'refused'].includes(a.type)), this.lastSequence);
    // New acknowledgments can arrive while an earlier screenshot is being written.
    // Drain until the tail stops changing, rather than awaiting a stale promise.
    let pending: Promise<void>;
    do { pending = this.tail; await pending; } while (pending !== this.tail);
    this.throwErrors();
  }
  async screenshot(name = 'viewer.png') { await this.options.recorder.binary('final', name, await this.page.screenshot({ type: 'png' })); }
  async close() {
    if (this.closed) return;
    this.closed = true;
    try { await this.settled(); } finally { await this.context.close(); await this.browser.close(); }
    await this.options.recorder.flush(); this.throwErrors();
  }
}
