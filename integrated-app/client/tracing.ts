// Development-only diagnostics. No deck text, credentials, or audio are recorded.
export type TraceFields = Record<string, string | number | boolean | undefined>;
export interface TraceEvent extends TraceFields {
  traceId: string; action: string; phase: string; elapsedMs: number; at: string;
}
export class NavigationTrace {
  readonly id = crypto.randomUUID();
  readonly started = performance.now();
  target?: { slideId: string; build: number; revision: string };
  painted = false;
  commandDone = false;
  private paintExpected: boolean;
  private timer?: ReturnType<typeof setInterval>;
  constructor(readonly action: string, readonly originRevision: string | undefined,
    private emit: (event: TraceEvent) => void, readonly enabled: boolean, fields: TraceFields = {},
  ) {
    this.paintExpected = ['next', 'previous', 'select', 'add', 'delete', 'build'].includes(action);
    this.mark('action', fields);
    if (enabled) this.timer = setInterval(() => {
      this.mark('still-waiting', { commandPending: !this.commandDone, paintPending: this.paintExpected && !this.painted,
        hidden: document.hidden });
      if (performance.now() - this.started > 30000) this.stop('observation-timeout');
    }, 1000);
  }
  mark(phase: string, fields: TraceFields = {}) {
    if (!this.enabled) return;
    const event = { ...fields, traceId: this.id, action: this.action, phase,
      elapsedMs: Math.round((performance.now() - this.started) * 10) / 10, at: new Date().toISOString() };
    console.debug('[nav-trace]', event);
    this.emit(event);
  }
  paint(kind: string, fields: TraceFields = {}) {
    this.mark(`viewer-${kind}`, fields);
    if (kind === 'painted' && !this.painted) {
      this.painted = true;
      this.mark('visible', { ...fields, slow: performance.now() - this.started > (['add', 'delete'].includes(this.action) ? 1000 : 250), hidden: document.hidden });
    }
    if (kind === 'refused') this.stop('viewer-refused');
    this.cleanup();
  }
  complete() { this.commandDone = true; this.mark('complete'); this.cleanup(); }
  supersede() { if (!this.painted && this.paintExpected) this.mark('paint-superseded'); this.paintExpected = false; this.cleanup(); }
  skipPaint() { this.mark('paint-not-required'); this.paintExpected = false; this.cleanup(); }
  stop(reason: string) { this.mark(reason); clearInterval(this.timer); }
  private cleanup() { if (this.commandDone && (this.painted || !this.paintExpected)) clearInterval(this.timer); }
}
