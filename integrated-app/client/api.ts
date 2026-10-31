import type { Command, Project, Receipt, Session, Snapshot, Utterance } from '../shared/protocol';
import type { IncomingMessage, ViewerAcknowledgment } from '../../slide-generation/src/viewer/protocol';

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
export const createProject = (name: string, context: string) => json<Project>('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, context }) });

export class ProjectConnection {
  session!: Session;
  snapshot?: Snapshot;
  clock = { offsetMs: 0, uncertaintyMs: 0 };
  epochOffsetMs = 0;
  private events?: EventSource;
  private disposed = false;
  private eventSequence?: number;
  private recovering?: Promise<void>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  constructor(readonly projectId: string, private handlers: {
    snapshot: (snapshot: Snapshot) => void;
    viewer: (message: IncomingMessage) => void;
    blackout: (value: boolean) => void;
    connection: (value: 'connecting' | 'connected' | 'disconnected') => void;
    error: (message: string) => void;
    receipt?: (receipt: Receipt) => void;
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
    this.epochOffsetMs = session.serverTimeMs - (before + after) / 2;
    this.clock = { offsetMs: session.serverMonotonicMs - (before + after) / 2, uncertaintyMs: (after - before) / 2 };
    if (session.snapshot) this.applySnapshot(session.snapshot);
    this.connectEvents();
  }
  applySnapshot(snapshot: Snapshot) { this.snapshot = snapshot; this.handlers.snapshot(snapshot); }
  async get<T>(path: string): Promise<T> { return json<T>(`${this.base}${path}`, { headers: this.headers() }); }
  async post<T>(path: string, body?: unknown): Promise<T> { return json<T>(`${this.base}${path}`, { method: 'POST', headers: this.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body ?? {}) }); }
  async command(input: Omit<Command, 'id' | 'epoch'>) {
    if (!this.snapshot) throw new Error('Project handshake is not ready');
    const result = await this.post<{ snapshot: Snapshot; result?: unknown }>('/commands', { ...input, id: crypto.randomUUID(), epoch: this.snapshot.epoch });
    this.applySnapshot(result.snapshot); return result;
  }
  async input(input: Omit<Utterance, 'id' | 'epoch'>) {
    if (!this.snapshot) throw new Error('Project handshake is not ready');
    return this.post<Receipt>('/input', { ...input, id: crypto.randomUUID(), epoch: this.snapshot.epoch });
  }
  async audio(chunk: AudioInput) {
    return json<Receipt>(`${this.base}/audio`, { method: 'POST', headers: this.headers({
      'Content-Type': 'application/octet-stream', 'X-Input-Id': chunk.id, 'X-Epoch': String(chunk.epoch),
      'X-Slide-Id': chunk.slideId, 'X-Start-Ms': String(chunk.startMs), 'X-End-Ms': String(chunk.endMs), 'X-Audio-Sequence': String(chunk.sequence),
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
    if (view.message) this.handlers.viewer(view.message);
    this.handlers.blackout(view.blackout);
  }
  private connectEvents() {
    this.events = new EventSource(this.url('/events'));
    this.events.onopen = () => {
      if (this.disposed) return;
      void this.recover();
    };
    this.events.onerror = () => {
      if (!this.disposed) { this.handlers.connection('disconnected'); void this.recover(); }
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
    listen('viewer', data => this.handlers.viewer(data));
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
    clearTimeout(this.retryTimer);
    this.disposed = true; this.events?.close();
    if (this.session) void fetch(`${this.base}/sessions/${this.session.id}`, { method: 'DELETE', headers: this.headers(), keepalive: true }).catch(() => {});
  }
}
export interface AudioInput { id: string; epoch: number; slideId: string; startMs: number; endMs: number; sequence: number; pcm: ArrayBuffer; }
