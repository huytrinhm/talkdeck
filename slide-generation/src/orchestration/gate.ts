import { abortable } from "./abortable.js";
import type { Decider, Speech, Log, DecisionInput } from "./types.js";
import { errorMessage, silentLog } from "./types.js";
export class SpeechGate {
  latest: Speech | null = null;
  lastDispatched: Speech | null = null;
  lastEvaluatedRevision = 0;
  private timer?: ReturnType<typeof setInterval>;
  private controllers = new Set<AbortController>();
  private firstUndispatchedAt = 0;
  private backoffUntil = 0;
  private failures = 0;
  private closed = false;
  private paused = false;
  constructor(
    private decider: Decider,
    private dispatch: (speech: Speech) => void,
    private context = "",
    private log: Log = silentLog,
    readonly maxInFlight = 8,
    readonly deadlineMs = 30000,
    readonly slideId?: string,
    private snapshot?: (signal: AbortSignal) => Promise<{
      input: Pick<DecisionInput, "current" | "deck" | "statuses" | "spokenEdits">;
      isCurrent: () => boolean;
    }>,
  ) {}
  get inFlight() {
    return this.controllers.size;
  }
  start() {
    if (!this.timer && !this.closed)
      this.timer = setInterval(() => void this.tick(), 200);
  }
  receive(text: string, revision: number, now = performance.now()) {
    if (this.closed) throw new Error("Speech gate is closed");
    if (revision <= (this.latest?.revision ?? 0))
      throw new Error("Transcript revisions must increase");
    const corrections = [...(this.latest?.corrections ?? [])];
    if (this.latest && !text.startsWith(this.latest.text))
      corrections.push({ revision, before: this.latest.text, after: text });
    if (
      !this.latest ||
      this.latest.revision === (this.lastDispatched?.revision ?? 0)
    )
      this.firstUndispatchedAt = now;
    this.latest = {
      revision,
      text,
      receivedAt: now,
      corrections,
      ...(this.slideId ? { slideId: this.slideId } : {}),
    };
    this.log.write("transcript", { speech: this.latest });
  }
  async tick(now = performance.now()) {
    if (
      this.closed ||
      this.paused ||
      !this.latest ||
      (!this.latest.text.trim() && !this.latest.corrections.length) ||
      this.latest.revision === (this.lastDispatched?.revision ?? 0) ||
      this.inFlight >= this.maxInFlight ||
      now < this.backoffUntil
    )
      return;
    const speech = structuredClone(this.latest),
      baseline = this.lastDispatched?.revision ?? 0;
    const controller = new AbortController();
    this.controllers.add(controller);
    const timeout = setTimeout(
      () => controller.abort(new Error("Decision deadline exceeded")),
      this.deadlineMs,
    );
    try {
      const snapshot = this.snapshot ? await abortable(this.snapshot(controller.signal), controller.signal) : undefined;
      if (snapshot && !snapshot.isCurrent()) return;
      const result = await abortable(
        this.decider.evaluate(
          {
            speech,
            lastDispatched: structuredClone(this.lastDispatched),
            undispatchedAgeMs: now - this.firstUndispatchedAt,
            context: this.context,
            ...snapshot?.input,
          },
          controller.signal,
        ),
        controller.signal,
      );
      if (this.closed || this.paused || controller.signal.aborted) return;
      if (snapshot && !snapshot.isCurrent()) {
        this.log.write("decision_stale", { revision: speech.revision, reason: "slide_changed" });
        return;
      }
      this.failures = 0;
      // New append-only words are still pending. Any correction invalidates the evaluated snapshot.
      if (
        (this.lastDispatched?.revision ?? 0) !== baseline ||
        this.latest.corrections.some((c) => c.revision > speech.revision)
      ) {
        this.log.write("decision_stale", { revision: speech.revision });
        return;
      }
      this.lastEvaluatedRevision = Math.max(
        this.lastEvaluatedRevision,
        speech.revision,
      );
      this.log.write("decision", { revision: speech.revision, result });
      if (result === "dispatch") {
        this.lastDispatched = speech;
        this.dispatch(speech);
      }
    } catch (e) {
      if (!this.closed && !this.paused && !controller.signal.aborted) {
        this.failures++;
        this.backoffUntil =
          performance.now() +
          Math.min(5000, 200 * 2 ** Math.min(this.failures - 1, 5));
        this.log.write("decision_error", { message: errorMessage(e) });
      }
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
    }
  }
  /** Preserve speech, but do not replay old narration after a user history action. */
  suppressCurrent() {
    for (const c of this.controllers) c.abort();
    this.lastDispatched = structuredClone(this.latest);
    this.lastEvaluatedRevision = this.latest?.revision ?? 0;
    this.backoffUntil = 0;
    this.failures = 0;
  }
  restoreNarration(speech: Speech) {
    this.latest = structuredClone(speech);
    this.suppressCurrent();
  }
  pause() {
    this.paused = true;
    for (const c of this.controllers) c.abort();
  }
  resume() {
    this.paused = false;
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    for (const c of this.controllers) c.abort();
  }
}
