import { randomUUID } from "node:crypto";
import { toResponseInputItems } from "openai/lib/responses/ResponseInputItems";
import { setTimeout as delay } from "node:timers/promises";
import type OpenAI from "openai";
import { abortable } from "./abortable.js";
import { AssetStore } from "./assets.js";
import { History } from "./history.js";
import { SpeechGate } from "./gate.js";
import {
  Publisher,
  type Branch,
  type Edit,
  type HistoryResult,
} from "./publisher.js";
import type { GenerationBackend, GenerationInvocation } from "./backend.js";
import type { InputUtterance } from "../source/ingestion.js";
import {
  definitions,
  lifecycleDefinitions,
  parseLifecycleTool,
  parseTool,
} from "./tools.js";
import {
  blankSlide,
  diagnostic,
  errorMessage,
  silentLog,
  type Decider,
  type SlowDecider,
  type Event,
  type Log,
  type Message,
  type Model,
  type Observation,
  type Renderer,
  type Role,
  type Speech,
  type State,
  type Task,
} from "./types.js";
interface Actor {
  id: string;
  role: Role;
  state: State;
  history: History;
  pendingSpeech?: Speech;
  pendingBySlide: Map<string, Speech>;
  targetSlide?: string;
  observedSlides: Map<string, Observation>;
  passiveSpeech?: Speech;
  lastSpeech?: Speech;
  messages: Message[];
  tasks: Task[];
  requested: boolean;
  observedFast: number;
  promise?: Promise<void>;
  controller: AbortController;
  children: Set<string>;
  requiredResults: Set<string>;
  failureObservedByParent: boolean;
  artifacts: string[];
  parent?: string;
  wakeWaiters: Set<() => void>;
  error?: string;
}
export interface RuntimeOptions {
  model: Model;
  decider: Decider;
  slowDecider: SlowDecider;
  renderer?: Renderer;
  backend?: GenerationBackend;
  assets?: AssetStore;
  log?: Log;
  context?: string;
  initialSource?: string;
  client?: OpenAI;
  autoTick?: boolean;
  maxSteps?: number;
}
export class SlideRuntime {
  readonly publisher: GenerationBackend;
  readonly gates = new Map<string, SpeechGate>();
  private archivedNarration = new Map<string, Speech>();
  get gate(): SpeechGate {
    return this.gateFor(this.publisher.selectedId);
  }
  paused = false;
  private restoringHistory = false;
  private historyChain: Promise<unknown> = Promise.resolve();
  private historyPending = 0;
  private resumeWaiters = new Set<() => void>();
  readonly assets: AssetStore;
  readonly actors = new Map<string, Actor>();
  readonly events: Event[] = [];
  private listeners = new Set<(event: Event) => void>();
  private log: Log;
  private closed = false;
  private sequence = 0;
  private publicAssets = new Set<string>();
  private slowDecision?: Promise<void>;
  private slowDecisionController?: AbortController;
  private slowEvaluatedFast = 0;
  private slowActivationEpoch = 0;
  private slowDecisionError?: string;
  private retainedUtterances = new Map<string, InputUtterance>();
  private retainedInputRevisions = new Map<string, number>();
  private deckRequests = new Map<
    string,
    { id: string; slideId: string; requested: true }
  >();
  private constructor(private options: RuntimeOptions) {
    this.assets = options.assets ?? new AssetStore();
    this.log = options.log ?? silentLog;
    this.publicAssets = new Set(this.assets.refs());
    if (!options.backend && !options.renderer)
      throw new Error("A generation backend or legacy renderer is required");
    this.publisher =
      options.backend ?? new Publisher(options.renderer!, this.log);
    this.publisher.validateAccess = (role, source) =>
      role === "fast"
        ? this.assets
            .refs()
            .filter(
              (ref) => source.includes(ref) && !this.publicAssets.has(ref),
            )
            .map((ref) =>
              diagnostic(
                "private_artifact",
                `Only Slow can introduce private specialist artifact ${ref}`,
              ),
            )
        : [];
    this.createActor("fast", "fast");
    this.createActor("slow", "slow");
    this.publisher.onPublish = (o, role) => {
      for (const ref of this.assets.refs())
        if (o.source.includes(ref)) this.publicAssets.add(ref);
      this.emit("published", {
        observationId: o.id,
        slideId: o.slideId,
        role,
        fastWatermark: o.fastWatermark,
        history: this.publisher.historyStatus(),
      });
      if (role === "fast") {
        this.considerSlow();
      }
    };
    this.publisher.onStructure = (result) => {
      for (const [id, gate] of this.gates) {
        if (!this.publisher.list().some((s) => s.id === id)) {
          if (gate.latest)
            this.archivedNarration.set(id, structuredClone(gate.latest));
          gate.close();
          this.gates.delete(id);
        }
      }
      for (const actor of this.actors.values()) {
        for (const id of actor.pendingBySlide.keys()) {
          if (!this.publisher.list().some((s) => s.id === id))
            actor.pendingBySlide.delete(id);
        }
        actor.pendingSpeech = actor.pendingBySlide.values().next().value;
      }
      for (const slide of this.publisher.list())
        for (const ref of this.assets.refs())
          if (slide.observation.source.includes(ref))
            this.publicAssets.add(ref);
      this.emit("deck_changed", {
        ...result,
        selectedId: this.publisher.selectedId,
        history: this.publisher.historyStatus(),
      });
    };
    this.publisher.onConflict = (intent) =>
      this.sendMessage({
        id: intent.id,
        from: "fast",
        to: "slow",
        text: `Rejected stale Fast intent; reconcile or discard once: ${JSON.stringify(intent)}`,
      });
  }
  static async create(options: RuntimeOptions) {
    const runtime = new SlideRuntime(options);
    try {
      await runtime.publisher.initialize(options.initialSource ?? blankSlide);
    } catch (e) {
      await runtime.close();
      throw e;
    }
    if (options.autoTick !== false) runtime.gate.start();
    return runtime;
  }
  private createActor(id: string, role: Role, parent?: string) {
    const actor: Actor = {
      id,
      role,
      parent,
      state: "idle",
      history: new History(),
      pendingBySlide: new Map(),
      observedSlides: new Map(),
      messages: [],
      tasks: [],
      requested: false,
      observedFast: 0,
      controller: new AbortController(),
      children: new Set(),
      requiredResults: new Set(),
      failureObservedByParent: false,
      artifacts: [],
      wakeWaiters: new Set(),
    };
    this.actors.set(id, actor);
    return actor;
  }
  private emit(type: string, data: Record<string, unknown>) {
    const event = { sequence: ++this.sequence, at: Date.now(), type, ...data };
    this.events.push(event);
    this.log.write(type, event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        this.log.write("subscriber_error", { message: errorMessage(e) });
      }
    }
  }
  subscribe(listener: (event: Event) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private gateFor(slideId: string): SpeechGate {
    this.publisher.get(slideId);
    let gate = this.gates.get(slideId);
    if (!gate) {
      gate = new SpeechGate(
        this.options.decider,
        (speech) => this.dispatch(speech),
        this.options.context,
        this.log,
        8,
        30000,
        slideId,
      );
      this.gates.set(slideId, gate);
      const archived = this.archivedNarration.get(slideId);
      if (archived) {
        gate.restoreNarration(archived);
        this.archivedNarration.delete(slideId);
      }
      if (this.paused || this.restoringHistory) gate.pause();
      if (this.options.autoTick !== false) gate.start();
    }
    return gate;
  }
  receiveTranscript(
    text: string,
    revision: number,
    slideId = this.publisher.selectedId,
  ) {
    if (this.closed) throw new Error("Runtime closed");
    if (this.publisher.generation)
      throw new Error(
        "Canonical generation requires durable deliverUtterance, not transcript snapshots",
      );
    this.gateFor(slideId).receive(text, revision);
    this.emit("transcript", { text, revision, slideId });
  }
  /** Durable evidence retention precedes eligibility; target is captured by the caller. */
  async deliverUtterance(input: InputUtterance) {
    if (this.closed) throw new Error("Runtime closed");
    const generation = this.publisher.generation;
    if (!generation)
      throw new Error(
        "Durable utterances require a canonical generation backend",
      );
    const delivery = await generation.deliverUtterance(input);
    if (!this.closed && !delivery.duplicate && !delivery.receipt.duplicate) {
      this.retainedUtterances.set(input.id, structuredClone(input));
      this.retainedInputRevisions.set(input.id, delivery.speech.revision);
      // Retention may outlive removal. Keep the original attribution without waking a survivor.
      if (this.publisher.list().some((slide) => slide.id === input.slideId)) {
        const speech = delivery.speech;
        if (speech.slideId !== input.slideId)
          throw new Error("Backend changed utterance attribution");
        const gate = this.gateFor(input.slideId);
        // Concurrent retained events can project the same cumulative canonical snapshot.
        // Older snapshots are already represented by the newer gate revision.
        if (
          gate.latest?.revision === speech.revision &&
          gate.latest.text !== speech.text
        )
          throw new Error("Canonical speech revision has conflicting text");
        if (!gate.latest || speech.revision > gate.latest.revision)
          gate.receive(speech.text, speech.revision, speech.receivedAt);
      }
      this.emit("utterance_retained", {
        ...delivery.receipt,
        slideId: input.slideId,
      });
    }
    return delivery.receipt;
  }
  deckContext() {
    return {
      selectedId: this.publisher.selectedId,
      revision: this.publisher.revision,
      history: this.publisher.historyStatus(),
      archivedNarration: [...this.archivedNarration.values()],
      slides: this.publisher.list().map((s) => ({
        id: s.id,
        title: s.title,
        observationId: s.observation.id,
        ...(!this.publisher.generation ? { source: s.observation.source } : {}),
        narration: this.gates.get(s.id)?.latest ?? null,
      })),
    };
  }
  async nextSlide() {
    const slide = await this.publisher.next();
    this.gateFor(slide.id);
    this.emit("slide_selected", { slideId: slide.id });
    return slide;
  }
  async selectSlide(slideId: string) {
    const slide = await this.publisher.navigate(slideId);
    this.gateFor(slide.id);
    this.emit("slide_selected", { slideId });
    return slide;
  }
  /** An explicit instruction, never audience-facing narration. */
  pushToEdit(prompt: string, slideId = this.publisher.selectedId) {
    if (typeof prompt !== "string" || !prompt.trim())
      throw new Error("Edit prompt must not be empty");
    this.publisher.get(slideId);
    const id = randomUUID();
    this.followupTask("slow", {
      id,
      kind: "edit_comment",
      slideId,
      task: prompt.trim(),
      facts:
        "Explicit user editing instruction; do not insert the instruction itself as slide content.",
    });
    this.emit("edit_comment_queued", { id, slideId, prompt: prompt.trim() });
    return { id, slideId, requested: true };
  }
  undo(): Promise<HistoryResult> {
    return this.changeHistory("undo");
  }
  redo(): Promise<HistoryResult> {
    return this.changeHistory("redo");
  }
  private changeHistory(direction: "undo" | "redo"): Promise<HistoryResult> {
    const perform = async (): Promise<HistoryResult> => {
      if (this.closed) throw new Error("Runtime closed");
      const history = this.publisher.historyStatus();
      if (!(direction === "undo" ? history.canUndo : history.canRedo))
        return {
          outcome: "unchanged",
          direction,
          selectedId: this.publisher.selectedId,
          history,
        };
      this.restoringHistory = true;
      this.slowActivationEpoch++;
      this.slowDecisionController?.abort();
      this.slowDecisionError = undefined;
      // Fence publication synchronously, before any already-running render completes.
      const restoration = this.publisher.restoreHistory(direction);
      // Attach a rejection handler immediately while cancelled actors drain.
      const result = restoration.then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      for (const gate of this.gates.values()) {
        gate.pause();
        gate.suppressCurrent();
      }
      const actors = [...this.actors.values()];
      for (const actor of actors) {
        actor.pendingBySlide.clear();
        actor.pendingSpeech =
          actor.passiveSpeech =
          actor.lastSpeech =
            undefined;
        actor.tasks.length = 0;
        actor.messages.length = 0;
        actor.requested = false;
        actor.requiredResults.clear();
        actor.error = undefined;
        if (actor.state === "failed") this.setState(actor, "idle");
        actor.controller.abort(
          new Error(`Work cancelled by user ${direction}`),
        );
      }
      try {
        await Promise.allSettled(actors.map((a) => a.promise));
        const restored = await result;
        if ("error" in restored) throw restored.error;
        // Resurrect narration for stable IDs restored by undo, without dispatching it.
        for (const slide of this.publisher.list()) this.gateFor(slide.id);
        this.emit("history_changed", {
          ...restored.value,
          revision: this.publisher.revision,
        });
        return restored.value;
      } finally {
        this.slowEvaluatedFast = this.publisher.fastWatermark;
        for (const actor of actors) {
          actor.controller = new AbortController();
          actor.observedFast = this.publisher.fastWatermark;
          actor.observedSlides.clear();
          actor.history.add({
            role: "user",
            content: JSON.stringify({
              control: direction,
              deck: this.deckContext(),
              instruction:
                "The user invoked undo/redo. Current deck state is authoritative. Earlier tasks and narration are historical, not pending work. Do not recreate undone changes unless fresh user input requests them.",
            }),
          });
        }
        this.restoringHistory = false;
        if (!this.closed) {
          if (!this.paused)
            for (const gate of this.gates.values()) gate.resume();
          for (const actor of actors)
            if (actor.requested || actor.pendingSpeech || actor.tasks.length)
              this.wake(actor);
        }
      }
    };
    // The first control starts synchronously so a comment submitted immediately
    // after undo() belongs to the new work generation, not the cancelled one.
    const operation =
      this.historyPending++ === 0 ? perform() : this.historyChain.then(perform);
    this.historyChain = operation
      .catch(() => {})
      .finally(() => {
        this.historyPending--;
      });
    return operation;
  }
  pause() {
    if (this.closed) throw new Error("Runtime closed");
    if (this.paused) return;
    this.paused = true;
    this.publisher.setPaused(true);
    this.slowActivationEpoch++;
    this.slowDecisionController?.abort();
    for (const gate of this.gates.values()) gate.pause();
    this.emit("work_paused", {});
  }
  resume() {
    if (this.closed) throw new Error("Runtime closed");
    if (!this.paused) return;
    this.paused = false;
    this.publisher.setPaused(false);
    for (const gate of this.gates.values())
      if (!this.restoringHistory) gate.resume();
    for (const resolve of this.resumeWaiters) resolve();
    this.resumeWaiters.clear();
    for (const actor of this.actors.values())
      if (actor.requested || actor.pendingSpeech || actor.tasks.length)
        this.wake(actor);
    this.considerSlow();
    this.emit("work_resumed", {});
  }
  private async pauseBoundary(signal?: AbortSignal) {
    if (this.paused && !this.closed) {
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
        this.resumeWaiters.add(resolve);
      });
      try {
        await (signal ? abortable(waiting, signal) : waiting);
      } finally {
        this.resumeWaiters.delete(release);
      }
    }
  }
  statuses() {
    return [...this.actors.values()].map((a) => ({
      id: a.id,
      role: a.role,
      state: a.state,
      paused: this.paused,
      targetSlide: a.targetSlide,
      error: a.error,
      failureObservedByParent:
        a.role === "specialist" ? a.failureObservedByParent : undefined,
    }));
  }
  private dispatch(speech: Speech) {
    const fast = this.actors.get("fast")!,
      slow = this.actors.get("slow")!;
    const slideId = speech.slideId ?? this.publisher.selectedId;
    if (!this.publisher.list().some((s) => s.id === slideId)) return;
    fast.pendingBySlide.set(slideId, structuredClone(speech));
    fast.pendingSpeech = fast.pendingBySlide.values().next().value;
    slow.passiveSpeech = structuredClone(speech);
    this.emit("speech_dispatched", { revision: speech.revision, slideId });
    this.wake(fast);
  }
  sendMessage(message: Message) {
    const recipient = this.actors.get(message.to);
    if (!recipient) throw new Error(`Unknown recipient ${message.to}`);
    if (!recipient.messages.some((m) => m.id === message.id))
      recipient.messages.push(structuredClone(message));
    this.emit("message_queued", { message }); // No wake, including child completion.
  }
  followupTask(recipient: string, task: Task) {
    const actor = this.actors.get(recipient);
    if (!actor) throw new Error(`Unknown recipient ${recipient}`);
    if (this.closed) throw new Error("Runtime closed");
    if (
      actor.role === "specialist" &&
      ["idle", "failed"].includes(actor.state) &&
      [...this.actors.values()].filter(
        (a) =>
          a.role === "specialist" && ["running", "waiting"].includes(a.state),
      ).length >= 2
    ) {
      throw new Error(
        "Two specialists already active. Wait before requesting another specialist turn.",
      );
    }
    actor.tasks.push(structuredClone(task));
    actor.failureObservedByParent = false;
    if (actor.parent) {
      const parent = this.actors.get(actor.parent)!;
      if (["running", "waiting"].includes(parent.state))
        parent.requiredResults.add(actor.id);
    }
    actor.requested = true;
    if (actor.state === "failed") {
      actor.error = undefined;
      actor.state = "idle";
    }
    this.wake(actor);
  }
  private wake(actor: Actor) {
    if (
      this.closed ||
      this.paused ||
      this.restoringHistory ||
      actor.state !== "idle"
    )
      return;
    if (actor.role === "slow") {
      this.slowActivationEpoch++;
      this.slowDecisionError = undefined;
    }
    this.setState(actor, "running");
    const signal = actor.controller.signal;
    actor.promise = this.run(actor, signal)
      .catch((e) => {
        if (!this.closed && !signal.aborted) {
          actor.error = errorMessage(e);
          this.setState(actor, "failed");
          this.emit("agent_error", { agent: actor.id, message: actor.error });
        }
      })
      .finally(() => {
        if (this.closed) {
          this.setState(actor, "closed");
          return;
        }
        if (actor.state !== "failed" || signal.aborted)
          this.setState(actor, "idle");
        if (signal.aborted) return;
        if (actor.parent) {
          const parent = this.actors.get(actor.parent)!;
          this.sendMessage({
            id: randomUUID(),
            kind: "specialist_completion",
            from: actor.id,
            to: actor.parent,
            text: actor.error
              ? `Specialist failed: ${actor.error}`
              : `Specialist completed. Immutable artifacts: ${actor.artifacts.join(", ") || "(none)"}`,
            artifacts: [...actor.artifacts],
          });
          for (const waiter of parent.wakeWaiters) waiter();
        }
        if (
          actor.state === "idle" &&
          (actor.requested || (actor.role === "fast" && actor.pendingSpeech))
        )
          this.wake(actor);
        if (actor.role === "slow") this.considerSlow();
      });
  }
  /** One immutable eligibility request; intervening publications coalesce. */
  private considerSlow() {
    const slow = this.actors.get("slow")!;
    if (
      this.closed ||
      this.paused ||
      this.restoringHistory ||
      slow.state !== "idle" ||
      this.slowDecision
    )
      return;
    const current =
      this.publisher
        .list()
        .find((s) => s.id === this.publisher.latestFastSlideId)?.observation ??
      this.publisher.current;
    const watermark = this.publisher.fastWatermark,
      deckRevision = this.publisher.revision;
    if (watermark <= Math.max(this.slowEvaluatedFast, slow.observedFast))
      return;
    const epoch = this.slowActivationEpoch;
    const controller = new AbortController();
    this.slowDecisionController = controller;
    this.slowDecisionError = undefined;
    const timer = setTimeout(
      () => controller.abort(new Error("Slow decision deadline exceeded")),
      30000,
    );
    // Clone context so a pending call cannot observe later speech or mutations.
    const input = {
      current: {
        ...current,
        screenshot: Buffer.from(current.screenshot),
        geometry: structuredClone(current.geometry),
        diagnostics: structuredClone(current.diagnostics),
      },
      lastObservedFastWatermark: slow.observedFast,
      speech: structuredClone(slow.passiveSpeech ?? null),
      messages: structuredClone(slow.messages),
      context: this.options.context ?? "",
      ...(this.publisher.generation ? { spokenEdits: true } : {}),
      deck: this.publisher.generation
        ? structuredClone(
            this.publisher.generation.context({
              agent: "slow-decider",
              role: "slow",
              slideId: current.slideId,
              inferenceId: randomUUID(),
              signal: controller.signal,
            }),
          )
        : this.deckContext(),
    };
    this.emit("slow_decision_started", {
      observationId: current.id,
      fastWatermark: current.fastWatermark,
    });
    // Defer invocation until the in-flight guard is installed (also catches synchronous throws).
    this.slowDecision = Promise.resolve().then(async () => {
      try {
        if (this.closed || this.paused || epoch !== this.slowActivationEpoch)
          return;
        const result = await abortable(
          this.options.slowDecider.evaluate(input, controller.signal),
          controller.signal,
        );
        if (this.closed || this.paused) return;
        if (controller.signal.aborted) throw controller.signal.reason;
        if (
          slow.state !== "idle" ||
          epoch !== this.slowActivationEpoch ||
          deckRevision !== this.publisher.revision
        ) {
          this.emit("slow_decision_stale", { observationId: current.id });
          return;
        }
        this.slowEvaluatedFast = watermark;
        this.emit("slow_decision", {
          observationId: current.id,
          fastWatermark: current.fastWatermark,
          result,
        });
        if (result === "wake") {
          slow.targetSlide = current.slideId;
          this.wake(slow);
        }
      } catch (e) {
        if (
          !this.closed &&
          !this.paused &&
          epoch === this.slowActivationEpoch
        ) {
          // No automatic wake or unbounded retry on API failure. A newer Fast
          // publication can trigger another evaluation; explicit work still runs.
          this.slowEvaluatedFast = watermark;
          this.slowDecisionError = errorMessage(e);
          this.emit("slow_decision_error", {
            observationId: current.id,
            message: this.slowDecisionError,
          });
        }
      } finally {
        clearTimeout(timer);
        this.slowDecision = undefined;
        this.slowDecisionController = undefined;
        this.considerSlow();
      }
    });
  }
  private setState(actor: Actor, state: State) {
    actor.state = state;
    this.emit("agent_status", { agent: actor.id, state });
  }
  private observe(actor: Actor, o: Observation) {
    if (this.publisher.generation) return; // Canonical tools supply explicit observations/images.
    actor.history.observe(o);
    if (o.slideId) {
      actor.observedSlides.delete(o.slideId);
      actor.observedSlides.set(o.slideId, o);
      // Match the two retained observation bodies in projected model input.
      while (actor.observedSlides.size > 2)
        actor.observedSlides.delete(actor.observedSlides.keys().next().value!);
    }
    this.log.observation(o);
  }
  private async run(actor: Actor, signal: AbortSignal) {
    let steps = 0;
    while (!this.closed && !signal.aborted) {
      while (this.paused && !this.closed && !signal.aborted)
        await this.pauseBoundary(signal);
      if (this.closed || signal.aborted) return;
      const freshSpeech =
        actor.role === "fast" &&
        actor.pendingSpeech &&
        (actor.pendingSpeech.revision !== actor.lastSpeech?.revision ||
          actor.pendingSpeech.slideId !== actor.lastSpeech?.slideId);
      const freshPublication =
        actor.role === "slow" &&
        this.publisher.fastWatermark > actor.observedFast;
      const requiredCompletion = actor.messages.some(
        (message) =>
          message.kind === "specialist_completion" &&
          actor.requiredResults.has(message.from),
      );
      // A long live narration is not a runaway tool loop. Bound only work with
      // no fresh request, dispatched speech, Fast publication or required result.
      if (
        freshSpeech ||
        freshPublication ||
        actor.tasks.length ||
        requiredCompletion
      )
        steps = 0;
      if (++steps > (this.options.maxSteps ?? 64))
        throw new Error(
          "Work exceeded step limit without fresh input; explicit followup required",
        );
      actor.requested = false;
      if (actor.role === "fast" && actor.pendingSpeech) {
        actor.lastSpeech = actor.pendingSpeech;
        actor.targetSlide = actor.pendingSpeech.slideId;
        actor.pendingBySlide.delete(actor.targetSlide!);
        actor.pendingSpeech = actor.pendingBySlide.values().next().value;
      }
      if (actor.role === "slow" && actor.passiveSpeech)
        actor.lastSpeech = actor.passiveSpeech;
      const hadTasks = actor.tasks.length > 0;
      actor.tasks = actor.tasks.filter((task) => {
        if (
          task.kind !== "edit_comment" ||
          this.publisher.list().some((s) => s.id === task.slideId)
        )
          return true;
        this.emit("edit_comment_obsolete", {
          id: task.id,
          slideId: task.slideId,
        });
        return false;
      });
      if (hadTasks && !actor.tasks.length && !actor.pendingSpeech) return;
      const targetedTask = actor.tasks.findLast((t) => t.slideId);
      if (targetedTask) actor.targetSlide = targetedTask.slideId;
      const target = this.publisher
        .list()
        .find((s) => s.id === actor.targetSlide);
      if (actor.role === "fast" && actor.targetSlide && !target) {
        this.emit("work_obsolete", {
          agent: actor.id,
          slideId: actor.targetSlide,
          reason: "Narration target was removed; work is not retargeted",
        });
        if (actor.pendingSpeech) continue;
        return;
      }
      const current = target?.observation ?? this.publisher.current;
      // Specialists retain the original task target even if it was merged away;
      // Slow receives that provenance and must decide whether the artifact is useful.
      if (actor.role !== "specialist" || !actor.targetSlide)
        actor.targetSlide = current.slideId;
      const messages = actor.messages.splice(0),
        tasks = actor.tasks.splice(0);
      for (const message of messages) {
        if (
          message.kind !== "specialist_completion" ||
          !actor.requiredResults.has(message.from)
        )
          continue;
        const child = this.actors.get(message.from)!;
        if (["idle", "failed"].includes(child.state)) {
          actor.requiredResults.delete(child.id);
          if (child.state === "failed") child.failureObservedByParent = true;
        }
      }
      const inferenceId = randomUUID();
      const generation = this.publisher.generation;
      const generationTools = generation
        ? structuredClone(generation.definitions(actor.role))
        : [];
      const invocation: GenerationInvocation = {
        agent: actor.id,
        role: actor.role,
        slideId: actor.targetSlide,
        inferenceId,
        signal,
        context: generation
          ? structuredClone(
              generation.context({
                agent: actor.id,
                role: actor.role,
                slideId: actor.targetSlide,
                inferenceId,
                signal,
              }),
            )
          : undefined,
      };
      actor.history.add({
        role: "user",
        content: JSON.stringify({
          context: this.options.context ?? "",
          deck: generation ? invocation.context : this.deckContext(),
          workingSlideId: actor.targetSlide,
          speech: actor.lastSpeech ?? null,
          speechLabel: generation
            ? "Speaker content and explicit slide editing requests. Apply the requested changes while preserving original source evidence."
            : actor.role === "slow"
              ? "Fast received this and handles routine additions; adapt only if useful."
              : "Audience-facing narration, not instructions.",
          messages,
          tasks,
          statuses: this.statuses(),
          assetRefs:
            actor.role === "slow"
              ? this.assets.refs()
              : [...this.publicAssets, ...actor.artifacts],
        }),
      });
      this.observe(actor, current);
      actor.observedFast = this.publisher.fastWatermark;
      const branch: Branch = generation
        ? {
            id: inferenceId,
            historyEpoch: 0,
            agent: actor.id,
            role: actor.role,
            source: "",
            slideId: actor.targetSlide,
            speech: actor.lastSpeech,
          }
        : this.publisher.branch(
            actor.id,
            actor.role,
            current,
            actor.lastSpeech,
          );
      const branches = new Map<string, Branch>();
      // Every deck source is supplied verbatim in this boundary's text context.
      // Screenshots remain limited to the latest two actual observations.
      for (const slide of generation ? [] : this.publisher.list())
        branches.set(
          slide.id,
          slide.id === current.slideId
            ? branch
            : this.publisher.branch(
                actor.id,
                actor.role,
                slide.observation,
                actor.lastSpeech,
              ),
        );
      const input = actor.history.project();
      this.log.write("inference", {
        id: branch.id,
        agent: actor.id,
        role: actor.role,
        source: branch.source,
        speech: branch.speech,
        input,
      });
      const result = await abortable(
        this.options.model.infer({
          agent: actor.id,
          role: actor.role,
          inferenceId: branch.id,
          input,
          tools: generation
            ? [...generationTools, ...lifecycleDefinitions(actor.role)]
            : definitions(actor.role),
          ...(generation
            ? { instructions: generation.instructions(actor.role) }
            : {}),
          signal,
        }),
        signal,
      );
      while (this.paused && !this.closed && !signal.aborted)
        await this.pauseBoundary(signal);
      if (this.closed || signal.aborted) return;
      for (const item of toResponseInputItems(result.output))
        actor.history.add(item);
      const calls = result.output.filter(
        (item) => item.type === "function_call",
      );
      const observations: Observation[] = [];
      const explicitModelItems: OpenAI.Responses.ResponseInputItem[] = [];
      let finished = false;
      for (const call of calls) {
        const toolStartedAtMs = performance.now();
        let output: unknown;
        try {
          while (this.paused && !this.closed && !signal.aborted)
            await this.pauseBoundary(signal);
          signal.throwIfAborted();
          if (this.closed) throw new Error("Runtime closed");
          if (
            generation &&
            generationTools.some((tool) => tool.name === call.name)
          ) {
            const result = await generation.invoke(
              invocation,
              call.name,
              JSON.parse(call.arguments),
            );
            output = result.output;
            explicitModelItems.push(...(result.modelItems ?? []));
          } else {
            if (
              generation &&
              !lifecycleDefinitions(actor.role).some(
                (tool) => tool.name === call.name,
              )
            )
              throw new Error(
                `Tool ${call.name} is not available in canonical generation mode`,
              );
            const args = generation
              ? parseLifecycleTool(actor.role, call.name, call.arguments)
              : parseTool(actor.role, call.name, call.arguments);
            if (call.name === "finish") {
              finished = true;
              output = { finished: true };
            } else if (call.name === "view_slide") {
              const id = String(args.slideId ?? actor.targetSlide);
              const o = this.publisher.get(id).observation;
              observations.push(o);
              output = { observationId: o.id };
            } else if (call.name === "edit") {
              const id = String(args.slideId ?? actor.targetSlide);
              if (actor.role === "fast" && id !== branch.slideId)
                throw new Error(
                  "Fast edits only its narration target; broader work belongs to Slow",
                );
              const targetBranch = branches.get(id);
              if (!targetBranch)
                throw new Error(
                  "Inspect this slide with view_slide before editing it in a later inference",
                );
              const r = await this.publisher.edit(
                targetBranch,
                call.call_id,
                args as unknown as Edit,
              );
              observations.push(r.current);
              output = {
                outcome: r.outcome,
                observationId: r.current.id,
                diagnostics: r.diagnostics,
              };
            } else if (
              call.name === "edit_slides" ||
              call.name === "split_slide" ||
              call.name === "merge_slides"
            ) {
              const getBranch = (id: string) => {
                const b = branches.get(id);
                if (!b)
                  throw new Error(
                    `Inspect slide ${id} before restructuring or editing it`,
                  );
                return b;
              };
              if (call.name === "edit_slides")
                output = await this.publisher.editMany(
                  (
                    args.edits as {
                      slideId: string;
                      old: string;
                      new: string;
                    }[]
                  ).map((e) => ({ branch: getBranch(e.slideId), edit: e })),
                  call.call_id,
                );
              else if (call.name === "split_slide")
                output = await this.publisher.split(
                  getBranch(String(args.slideId)),
                  args.parts as { title: string; source: string }[],
                );
              else
                output = await this.publisher.mergeSlides(
                  (args.slideIds as string[]).map(getBranch),
                  { title: String(args.title), source: String(args.source) },
                );
              actor.observedSlides.clear();
              observations.push(
                this.publisher.list().find((s) => s.id === actor.targetSlide)
                  ?.observation ?? this.publisher.current,
              );
            } else output = await this.workTool(actor, call.name, args, signal);
          }
        } catch (e) {
          output = { error: errorMessage(e) };
        }
        actor.history.add({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(output),
        });
        this.log.write("tool_result", {
          agent: actor.id,
          inference: branch.id,
          callId: call.call_id,
          name: call.name,
          argumentsJson: call.arguments,
          resultJson: JSON.stringify(output),
          startedAtMs: toolStartedAtMs,
          finishedAtMs: performance.now(),
          output,
        });
      }
      if (signal.aborted || this.closed) return;
      // Append observations after ALL sibling call results to preserve call/output pairing.
      for (const o of observations) this.observe(actor, o);
      for (const item of explicitModelItems) actor.history.add(item);
      if (calls.length && !finished) continue;
      if (actor.role === "slow") {
        // A finished child still has a required result until a model boundary
        // actually supplies its completion, even if it finished mid-inference.
        const outstanding = [...actor.requiredResults];
        if (outstanding.length) {
          await this.waitFor(actor, outstanding);
          continue;
        }
      }
      if (actor.role === "fast" && actor.pendingSpeech) continue;
      if (actor.requested) continue;
      return; // Passive speech and queue-only messages cannot force continuation.
    }
  }
  private async workTool(
    actor: Actor,
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    if (name === "request_deck_edit") {
      if (!this.publisher.generation || actor.role !== "fast")
        throw new Error(
          "Deck edit requests are available only to canonical Fast",
        );
      const speech = actor.lastSpeech,
        utteranceId = String(args.utteranceId);
      const original = this.retainedUtterances.get(utteranceId);
      const retainedRevision = this.retainedInputRevisions.get(utteranceId);
      const corrected = [...this.retainedUtterances.values()].some(
        (input) =>
          input.correctionOf === utteranceId &&
          (this.retainedInputRevisions.get(input.id) ?? Infinity) <=
            (speech?.revision ?? -1),
      );
      if (
        !speech ||
        !speech.slideId ||
        speech.slideId !== actor.targetSlide ||
        !original ||
        original.slideId !== speech.slideId ||
        retainedRevision === undefined ||
        retainedRevision > speech.revision ||
        corrected ||
        !original.text.trim() ||
        !speech.text.includes(original.text)
      )
        throw new Error(
          "Deck edit request must identify a retained input on the working slide in this inference's current speech snapshot",
        );
      const quote = original.text;
      this.publisher.get(speech.slideId);
      const key = JSON.stringify([
        speech.slideId,
        speech.revision,
        utteranceId,
      ]);
      const prior = this.deckRequests.get(key);
      if (prior) return { ...prior, duplicate: true };
      const id = randomUUID(),
        receipt = { id, slideId: speech.slideId, requested: true as const };
      this.followupTask("slow", {
        id,
        kind: "edit_comment",
        slideId: speech.slideId,
        task: quote,
        facts: `Fast forwarded these exact user words for ${String(args.scope)} work from slide ${speech.slideId}, speech revision ${speech.revision}, utterance ${original.id}. Verify the quote is an explicit user request and perform only that requested scope; do not infer extra refinement. It is an edit instruction, not slide content.`,
      });
      this.deckRequests.set(key, receipt);
      this.emit("deck_edit_requested", {
        ...receipt,
        scope: args.scope,
        sourceQuote: quote,
        utteranceId: original.id,
        speechRevision: speech.revision,
      });
      return { ...receipt, duplicate: false };
    }
    if (name === "list_slides") return this.deckContext();
    if (name === "delegate") {
      const active = [...this.actors.values()].filter(
        (a) =>
          a.role === "specialist" && ["running", "waiting"].includes(a.state),
      ).length;
      if (active >= 2)
        throw new Error(
          "Two specialists already active. Wait for one before delegating more.",
        );
      const targetId = args.slideId ? String(args.slideId) : actor.targetSlide;
      if (targetId) this.publisher.get(targetId);
      const id = `specialist-${randomUUID()}`;
      const child = this.createActor(id, "specialist", actor.id);
      actor.children.add(id);
      actor.requiredResults.add(id);
      child.tasks.push({ task: String(args.task), facts: String(args.facts) });
      child.lastSpeech = actor.lastSpeech;
      child.targetSlide = targetId;
      if (child.targetSlide)
        this.observe(child, this.publisher.get(child.targetSlide).observation);
      this.wake(child);
      return { recipient: id };
    }
    if (name === "send_message") {
      if (actor.role === "specialist" && args.recipient !== actor.parent)
        throw new Error(
          "Specialists return private work only to their parent Slow session",
        );
      this.sendMessage({
        id: randomUUID(),
        from: actor.id,
        to: String(args.recipient),
        text: String(args.text),
      });
      return { queued: true };
    }
    if (name === "followup_task") {
      const recipient = this.actors.get(String(args.recipient));
      if (!recipient) throw new Error("Unknown recipient");
      if (recipient.id === actor.id)
        throw new Error("Cannot follow up yourself");
      if (actor.role === "specialist" && recipient.id !== actor.parent)
        throw new Error("Specialists may request work only from their parent");
      if (
        recipient.role === "specialist" &&
        recipient.state === "idle" &&
        [...this.actors.values()].filter(
          (a) =>
            a.role === "specialist" && ["running", "waiting"].includes(a.state),
        ).length >= 2
      )
        throw new Error("Two specialists already active");
      this.followupTask(recipient.id, {
        task: String(args.task),
        facts: String(args.facts),
        slideId: args.slideId ? String(args.slideId) : undefined,
      });
      return { requested: true };
    }
    if (name === "wait_for") {
      return this.waitFor(actor, args.recipients as string[]);
    }
    if (name === "save_artifact") {
      const content = String(args.content),
        mediaType = String(args.mediaType);
      const ref = this.assets.put(mediaType, Buffer.from(content));
      actor.artifacts.push(ref);
      if (actor.parent)
        this.sendMessage({
          id: randomUUID(),
          from: actor.id,
          to: actor.parent,
          text: JSON.stringify({
            ref,
            mediaType,
            content,
            slideId: actor.targetSlide,
          }),
          artifacts: [ref],
        });
      return { ref };
    }
    if (name === "image_generate") {
      if (!this.options.client) throw new Error("Image client not configured");
      const response = await abortable(
        this.options.client.images.generate(
          {
            model: "gpt-image-2.5-flare",
            prompt: String(args.prompt),
            size:
              (args.size as "1024x1024" | "1536x1024" | "1024x1536") ??
              "1536x1024",
            quality: (args.quality as "low" | "medium" | "high") ?? "medium",
            output_format: "png",
          },
          { signal },
        ),
        signal,
      );
      while (this.paused && !this.closed && !signal.aborted)
        await this.pauseBoundary(signal);
      signal.throwIfAborted();
      if (this.closed) throw new Error("Runtime closed");
      const encoded = response.data?.[0]?.b64_json;
      if (!encoded) throw new Error("Image generation returned no image bytes");
      const ref = this.assets.put("image/png", Buffer.from(encoded, "base64"));
      actor.artifacts.push(ref);
      if (actor.parent)
        this.sendMessage({
          id: randomUUID(),
          from: actor.id,
          to: actor.parent,
          text: `Generated illustration for slide ${actor.targetSlide}: ${ref}`,
          targetSlideId: actor.targetSlide,
          artifacts: [ref],
        });
      return { ref };
    }
    throw new Error(`Unknown work tool ${name}`);
  }
  private async waitFor(actor: Actor, ids: string[]) {
    for (const id of ids)
      if (!actor.children.has(id))
        throw new Error(`Can only wait for own children: ${id}`);
    const done = () =>
      ids.every(
        (id) => !["running", "waiting"].includes(this.actors.get(id)!.state),
      );
    if (!done()) {
      this.setState(actor, "waiting");
      await new Promise<void>((resolve) => {
        const check = () => {
          if (done() || this.closed || actor.controller.signal.aborted) {
            actor.wakeWaiters.delete(check);
            actor.controller.signal.removeEventListener("abort", check);
            resolve();
          }
        };
        actor.wakeWaiters.add(check);
        actor.controller.signal.addEventListener("abort", check, {
          once: true,
        });
        check();
      });
      if (!this.closed) this.setState(actor, "running");
    }
    return {
      completed: ids.map((id) => ({
        id,
        state: this.actors.get(id)!.state,
        error: this.actors.get(id)!.error,
        artifacts: this.actors.get(id)!.artifacts,
      })),
    };
  }
  /** Wait for current work, including coalesced activations; does not force held speech. */
  async settle(timeoutMs = 180000) {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      const failed = [...this.actors.values()]
        .filter((actor) => {
          if (actor.state !== "failed") return false;
          if (actor.role !== "specialist") return true;
          if (actor.failureObservedByParent) return false;
          const parent = actor.parent && this.actors.get(actor.parent);
          // Active Slow still has a chance to observe the required failure and
          // choose a fallback. A terminal parent with an unhandled failure is fatal.
          return !parent || !["running", "waiting"].includes(parent.state);
        })
        .map((actor) => ({
          id: actor.id,
          role: actor.role,
          state: actor.state,
          error: actor.error,
        }));
      if (failed.length) throw new Error(JSON.stringify(failed));
      if (
        ![...this.actors.values()].some(
          (a) =>
            a.state === "running" ||
            a.state === "waiting" ||
            a.requested ||
            a.tasks.length > 0 ||
            !!a.pendingSpeech,
        ) &&
        [...this.gates.values()].every(
          (g) =>
            g.inFlight === 0 &&
            !(
              this.paused &&
              g.latest &&
              g.latest.revision !== g.lastEvaluatedRevision
            ),
        ) &&
        !this.slowDecision &&
        this.historyPending === 0 &&
        !this.restoringHistory
      ) {
        if (this.slowDecisionError)
          throw new Error(
            `Slow activation decision failed: ${this.slowDecisionError}`,
          );
        return;
      }
      await delay(20);
    }
    throw new Error("Runtime did not settle before deadline");
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const gate of this.gates.values()) gate.close();
    for (const resolve of this.resumeWaiters) resolve();
    this.resumeWaiters.clear();
    this.slowDecisionController?.abort();
    this.publisher.closed = true;
    for (const actor of this.actors.values()) {
      actor.controller.abort();
      for (const waiter of actor.wakeWaiters) waiter();
    }
    await Promise.allSettled([...this.actors.values()].map((a) => a.promise));
    await this.slowDecision;
    await this.historyChain;
    await this.publisher.close();
  }
}
