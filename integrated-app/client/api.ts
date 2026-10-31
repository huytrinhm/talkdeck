import { navigationTarget, type NavigationTarget } from './navigation';
import { NavigationTrace, type TraceEvent, type TraceFields } from './tracing';
import type { Command, Material, NavigationDeck, Project, Receipt, Session, Snapshot, Utterance } from '../shared/protocol';
import type { IncomingMessage, PublicationMessage, ViewerAcknowledgment } from '../../slide-generation/src/viewer/protocol';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}
export async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.message ?? body.error ?? `Request failed (${response.status})`, response.status, body.code);
  return body as T;
}
export const projects = () => json<Project[]>('/api/projects');
export const deleteProject = (id: string) => json<{ deleted: boolean }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const createProject = (name: string, context: string) => json<Project>('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, context }) });
export function uploadMaterial(projectId: string, session: Session, file: File) {
  const form = new FormData(); form.set('file', file);
  return json<Material>(`/api/projects/${encodeURIComponent(projectId)}/materials`, {
    method: 'POST', headers: { 'X-Session-Id': session.id, 'X-Session-Token': session.token }, body: form,
  });
}

export class ProjectConnection {
  session!: Session;
  snapshot?: Snapshot;
  clock = { offsetMs: 0, uncertaintyMs: 0 };
  epochOffsetMs = 0;
  private events?: EventSource;
  private disposed = false;
  private eventSequence?: number;
  private recovering?: Promise<void>;
  navigation?: NavigationTarget;
  navigationDeck?: NavigationDeck;
  private navigationTail: Promise<unknown> = Promise.resolve();
  private navigationSerial = 0;
  private navigationBatch = 0;
  private preparedKey = '';
  private latestPublication?: PublicationMessage;
  private viewerSequence = -1;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private activeTrace?: NavigationTrace;
  private traceEvents: TraceEvent[] = [];
  private traceTimer?: ReturnType<typeof setTimeout>;
  startTrace(action: string, fields: TraceFields = {}) {
    const enabled = import.meta.env.VITE_TRACE_NAVIGATION === '1';
    if (['next', 'previous', 'select', 'add', 'delete', 'build'].includes(action)) this.activeTrace?.supersede();
    const trace = new NavigationTrace(action, this.snapshot?.revision, event => {
      this.traceEvents.push(event);
      if (!this.traceTimer) this.traceTimer = setTimeout(() => {
        this.traceTimer = undefined;
        const events = this.traceEvents.splice(0, 100);
        if (this.session) void this.post('/debug/navigation-traces', { events }).catch(() => {});
      }, 100);
    }, enabled, { mode: this.snapshot?.mode, fromSlideId: this.navigation?.slideId ?? this.snapshot?.selectedId, ...fields });
    if (['next', 'previous', 'select', 'add', 'delete', 'build'].includes(action)) this.activeTrace = trace;
    return trace;
  }
  traceViewer(message: IncomingMessage, trace?: NavigationTrace) {
    const candidate = trace ?? this.activeTrace;
    if (!candidate || message.type !== 'publish') return;
    const target = candidate.target;
    const matches = target ? target.slideId === message.slideId && target.build === message.build && target.revision === message.revision
      : ['add', 'delete'].includes(candidate.action) && message.revision !== candidate.originRevision;
    if (!matches) return;
    candidate.mark('viewer-send', { slideId: message.slideId, build: message.build, publicationId: message.publicationId });
    return candidate;
  }
  constructor(readonly projectId: string, private handlers: {
    snapshot: (snapshot: Snapshot) => void;
    viewer: (message: IncomingMessage) => void;
    blackout: (value: boolean) => void;
    connection: (value: 'connecting' | 'connected' | 'disconnected') => void;
    error: (message: string) => void;
    receipt?: (receipt: Receipt) => void;
    navigation?: (target: NavigationTarget | undefined) => void;
  }) {}
  get base() { return `/api/projects/${encodeURIComponent(this.projectId)}`; }
  headers(extra?: Record<string, string>) { return { 'X-Session-Id': this.session.id, 'X-Session-Token': this.session.token, ...extra }; }
  url(path: string) {
    const url = new URL(`${this.base}${path}`, location.origin);
    url.searchParams.set('session', this.session.id); url.searchParams.set('token', this.session.token);
    return url.toString();
  }
  async open(role: 'editor' | 'audience' = 'editor') {
    this.handlers.connection('connecting');
    const before = performance.now();
    const session = await json<Session>(`${this.base}/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) });
    const after = performance.now();
    if (this.disposed) return;
    this.session = session;
    this.viewerSequence = -1; this.latestPublication = undefined;
    this.preparedKey = ''; this.navigationDeck = undefined;
    this.clearNavigation();
    this.epochOffsetMs = session.serverTimeMs - (before + after) / 2;
    this.clock = { offsetMs: session.serverMonotonicMs - (before + after) / 2, uncertaintyMs: (after - before) / 2 };
    if (session.snapshot) this.applySnapshot(session.snapshot);
    this.connectEvents();
  }
  applySnapshot(snapshot: Snapshot) {
    if (this.snapshot && snapshot.serverTimeMs < this.snapshot.serverTimeMs) return;
    if (this.snapshot && (snapshot.epoch !== this.snapshot.epoch || snapshot.revision !== this.snapshot.revision)) this.clearNavigation();
    this.snapshot = snapshot; this.handlers.snapshot(snapshot);
    void this.prepareNavigation();
  }
  private clearNavigation() {
    this.navigationSerial++;
    this.navigation = undefined; this.handlers.navigation?.(undefined);
  }
  private async prepareNavigation() {
    if (!this.snapshot || this.session?.role !== 'editor' || this.disposed) return;
    const key = `${this.session.id}:${this.snapshot.epoch}:${this.snapshot.revision}`;
    if (this.preparedKey === key) return;
    this.preparedKey = key; this.navigationDeck = undefined;
    const trace = this.startTrace('prepare-navigation');
    try {
      const deck = await this.get<NavigationDeck>('/navigation');
      if (this.disposed || this.preparedKey !== key || deck.revision !== this.snapshot.revision || deck.epoch !== this.snapshot.epoch) { trace.stop('stale'); return; }
      this.navigationDeck = deck;
      trace.mark('prepared', { slides: deck.slides.length }); trace.complete();
    } catch {
      trace.stop('error');
      // Canonical publication remains available; a later snapshot retries preloading.
      if (this.preparedKey === key) this.preparedKey = '';
    }
  }
  private receiveViewer(message: IncomingMessage) {
    if (message.channel !== this.session?.channel || message.sequence <= this.viewerSequence) return;
    this.viewerSequence = message.sequence;
    if (message.type === 'publish') this.latestPublication = message;
    else if (this.latestPublication?.revision === message.revision)
      this.latestPublication = { ...this.latestPublication, sequence: message.sequence, build: message.build, holdIds: message.holdIds };
    else return;
    this.handlers.viewer(this.latestPublication!);
  }
  navigate(action: 'next' | 'previous' | 'select', slideId?: string, trace = this.startTrace(action, { requestedSlideId: slideId })) {
    if (!this.snapshot) return Promise.reject(new Error('Project handshake is not ready'));
    const target = navigationTarget(this.snapshot, this.navigationDeck, this.navigation, action, slideId);
    if (!target) {
      if (this.snapshot.mode === 'present' && !this.navigationDeck) { trace.mark('server-fallback'); return this.command({ type: action, slideId }, trace); }
      trace.stop('no-op');
      return Promise.resolve();
    }
    trace.target = target; target.trace = trace;
    if (target.slideId === (this.navigation?.slideId ?? this.snapshot.selectedId)
      && target.build === (this.navigation?.build ?? this.snapshot.build)) trace.skipPaint();
    trace.mark('target', { slideId: target.slideId, build: target.build, preparedPreview: !!target.preview });
    if (target.preview) target.preview.channel = this.session.channel;
    const previousId = this.navigation?.slideId ?? this.snapshot.selectedId;
    const epoch = this.snapshot.epoch;
    const batch = this.navigationBatch;
    const serial = ++this.navigationSerial;
    this.navigation = target; this.handlers.navigation?.(target);
    trace.mark('optimistic-state');
    const input = previousId === target.slideId && action !== 'select'
      ? { type: 'build' as const, value: target.build }
      : { type: 'select' as const, slideId: target.slideId };
    const pending = this.navigationTail.catch(() => {}).then(async () => {
      trace.mark('client-queue-released');
      if (this.disposed || this.snapshot?.epoch !== epoch || this.snapshot.revision !== target.revision || batch !== this.navigationBatch)
        throw new Error('Navigation cancelled because the deck, session, or a previous command changed');
      const result = await this.sendCommand(input, epoch, trace);
      if (serial === this.navigationSerial) this.clearNavigation();
      return result;
    }).catch(async error => {
      trace.stop('error');
      if (batch === this.navigationBatch) this.navigationBatch++;
      if (serial === this.navigationSerial) {
        this.clearNavigation();
        // Restore the authoritative viewer even if a stale SSE update had been suppressed.
        if (this.latestPublication) this.handlers.viewer({ ...this.latestPublication });
        void this.refresh().catch(() => {});
      }
      throw error;
    });
    this.navigationTail = pending;
    return pending;
  }
  async get<T>(path: string): Promise<T> { return json<T>(`${this.base}${path}`, { headers: this.headers() }); }
  async post<T>(path: string, body?: unknown): Promise<T> { return json<T>(`${this.base}${path}`, { method: 'POST', headers: this.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body ?? {}) }); }
  private async sendCommand(input: Omit<Command, 'id' | 'epoch'>, epoch: number, trace?: NavigationTrace) {
    trace?.mark('request-start', { command: input.type });
    const result = await this.post<{ snapshot: Snapshot; result?: unknown; viewer?: IncomingMessage }>('/commands', { ...input, id: trace?.id ?? crypto.randomUUID(), epoch });
    trace?.mark('response', { selectedId: result.snapshot.selectedId, revision: result.snapshot.revision });
    if (trace && !trace.target) trace.target = { slideId: result.snapshot.selectedId, build: result.snapshot.build, revision: result.snapshot.revision };
    if (result.viewer) this.receiveViewer(result.viewer);
    this.applySnapshot(result.snapshot); trace?.complete(); return result;
  }
  async waitForNavigation() { await this.navigationTail; }
  async command(input: Omit<Command, 'id' | 'epoch'>, trace = this.startTrace(input.type)) {
    try {
    await this.navigationTail.catch(() => {});
    trace.mark('client-queue-released');
    if (!this.snapshot) throw new Error('Project handshake is not ready');
    return await this.sendCommand(input, this.snapshot.epoch, trace);
    } catch (error) { trace.stop('error'); throw error; }
  }
  async input(input: Omit<Utterance, 'id' | 'epoch'>) {
    await this.navigationTail;
    if (!this.snapshot) throw new Error('Project handshake is not ready');
    return this.post<Receipt>('/input', { ...input, id: crypto.randomUUID(), epoch: this.snapshot.epoch });
  }
  async audio(chunk: AudioInput) {
    await this.navigationTail;
    return json<Receipt>(`${this.base}/audio`, { method: 'POST', headers: this.headers({
      'Content-Type': 'application/octet-stream', 'X-Input-Id': chunk.id, 'X-Epoch': String(chunk.epoch),
      'X-Slide-Id': chunk.slideId, 'X-Start-Ms': String(chunk.startMs), 'X-End-Ms': String(chunk.endMs), 'X-Audio-Sequence': String(chunk.sequence),
      ...(chunk.utteranceId ? { 'X-Utterance-Id': chunk.utteranceId, 'X-Audio-Final': String(chunk.final ?? true) } : {}),
    }), body: chunk.pcm as ArrayBuffer });
  }
  async acknowledge(acknowledgment: ViewerAcknowledgment) {
    return this.post('/viewer/ack', { acknowledgment, clock: { ...this.clock, offsetMs: this.clock.offsetMs + acknowledgment.timeOriginMs - performance.timeOrigin } });
  }
  async viewer() {
    const before = performance.now();
    const view = await this.get<{ channel: string; viewerDocument: string; message?: IncomingMessage; blackout: boolean; serverTimeMs: number; serverMonotonicMs: number }>('/viewer');
    const after = performance.now();
    this.epochOffsetMs = view.serverTimeMs - (before + after) / 2;
    this.clock = { offsetMs: view.serverMonotonicMs - (before + after) / 2, uncertaintyMs: (after - before) / 2 };
    return view;
  }
  async refresh() {
    if (this.session.role === 'editor') this.applySnapshot(await this.get<Snapshot>('/state'));
    const view = await this.viewer();
    if (view.message) this.receiveViewer(view.message);
    this.handlers.blackout(view.blackout);
  }
  private connectEvents() {
    this.events = new EventSource(this.url('/events'));
    this.events.onopen = () => {
      if (this.disposed) return;
      void this.recover();
    };
    this.events.onerror = () => {
      if (!this.disposed) { this.clearNavigation(); this.navigationDeck = undefined; this.preparedKey = ''; this.handlers.connection('disconnected'); void this.recover(); }
    };
    const listen = (type: string, fn: (data: any) => void) => this.events!.addEventListener(type, event => {
      if (this.disposed) return;
      const message = event as MessageEvent;
      if (typeof message.data !== 'string') return;
      const sequence = Number(message.lastEventId);
      if (sequence && this.eventSequence && sequence > this.eventSequence + 1) void this.recover();
      if (sequence) this.eventSequence = sequence;
      try { fn(JSON.parse(message.data)); } catch (error) { this.handlers.error(String(error)); }
    });
    listen('snapshot', data => this.applySnapshot(data));
    listen('viewer', data => this.receiveViewer(data));
    listen('blackout', data => this.handlers.blackout(typeof data === 'boolean' ? data : data.blackout));
    listen('receipt', data => this.handlers.receipt?.(data));
    listen('error', data => this.handlers.error(data.message ?? String(data)));
    listen('resync', () => { void this.recover(); });
  }
  private recover() {
    if (this.disposed) return;
    if (this.recovering) return this.recovering;
    this.handlers.connection('connecting');
    this.recovering = (async () => {
      try { await this.refresh(); }
      catch (error) {
        if (!(error instanceof ApiError && error.status === 401) || this.disposed) throw error;
        const role = this.session.role; this.events?.close(); this.eventSequence = undefined;
        await this.open(role);
        await this.refresh();
      }
      if (!this.disposed) this.handlers.connection('connected');
    })().catch(error => {
        if (this.disposed) return;
        this.handlers.connection('disconnected'); this.handlers.error(String(error));
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => { void this.recover(); }, 2000);
      })
      .finally(() => { this.recovering = undefined; });
    return this.recovering;
  }
  close() {
    this.activeTrace?.stop('connection-closed');
    clearTimeout(this.retryTimer);
    this.disposed = true; this.events?.close();
    if (this.session) void fetch(`${this.base}/sessions/${this.session.id}`, { method: 'DELETE', headers: this.headers(), keepalive: true }).catch(() => {});
  }
}
export interface AudioInput { id: string; epoch: number; slideId: string; startMs: number; endMs: number; sequence: number; utteranceId?: string; final?: boolean; pcm: ArrayBuffer; }
