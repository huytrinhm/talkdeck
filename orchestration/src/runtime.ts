import { randomUUID } from "node:crypto";
import { toResponseInputItems } from "openai/lib/responses/ResponseInputItems";
import { setTimeout as delay } from "node:timers/promises";
import type OpenAI from "openai";
import { AssetStore } from "./assets.js";
import { History } from "./history.js";
import { SpeechGate } from "./gate.js";
import { Publisher, type Edit } from "./publisher.js";
import { definitions, parseTool } from "./tools.js";
import {
  blankSlide,
  diagnostic,
  errorMessage,
  silentLog,
  type Decider,
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
  renderer: Renderer;
  assets?: AssetStore;
  log?: Log;
  context?: string;
  initialSource?: string;
  client?: OpenAI;
  autoTick?: boolean;
  maxSteps?: number;
}
export class SlideRuntime {
  readonly publisher: Publisher;
  readonly gate: SpeechGate;
  readonly assets: AssetStore;
  readonly actors = new Map<string, Actor>();
  readonly events: Event[] = [];
  private listeners = new Set<(event: Event) => void>();
  private log: Log;
  private closed = false;
  private sequence = 0;
  private publicAssets = new Set<string>();
  private constructor(private options: RuntimeOptions) {
    this.assets = options.assets ?? new AssetStore();
    this.log = options.log ?? silentLog;
    this.publicAssets = new Set(this.assets.refs());
    this.publisher = new Publisher(options.renderer, this.log);
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
    this.gate = new SpeechGate(
      options.decider,
      (speech) => this.dispatch(speech),
      options.context,
      this.log,
    );
    this.publisher.onPublish = (o, role) => {
      for (const ref of this.assets.refs())
        if (o.source.includes(ref)) this.publicAssets.add(ref);
      this.emit("published", {
        observationId: o.id,
        role,
        fastWatermark: o.fastWatermark,
      });
      if (role === "fast") {
        const slow = this.actors.get("slow")!;
        if (slow.state === "idle") this.wake(slow);
      }
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
  receiveTranscript(text: string, revision: number) {
    this.gate.receive(text, revision);
    this.emit("transcript", { text, revision });
  }
  statuses() {
    return [...this.actors.values()].map((a) => ({
      id: a.id,
      role: a.role,
      state: a.state,
      error: a.error,
      failureObservedByParent:
        a.role === "specialist" ? a.failureObservedByParent : undefined,
    }));
  }
  private dispatch(speech: Speech) {
    const fast = this.actors.get("fast")!,
      slow = this.actors.get("slow")!;
    fast.pendingSpeech = structuredClone(speech);
    slow.passiveSpeech = structuredClone(speech);
    this.emit("speech_dispatched", { revision: speech.revision });
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
    if (this.closed || actor.state !== "idle") return;
    this.setState(actor, "running");
    actor.promise = this.run(actor)
      .catch((e) => {
        if (!this.closed) {
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
        if (actor.state !== "failed") this.setState(actor, "idle");
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
          (actor.requested ||
            (actor.role === "fast" && actor.pendingSpeech) ||
            (actor.role === "slow" &&
              this.publisher.current.fastWatermark > actor.observedFast))
        )
          this.wake(actor);
      });
  }
  private setState(actor: Actor, state: State) {
    actor.state = state;
    this.emit("agent_status", { agent: actor.id, state });
  }
  private observe(actor: Actor, o: Observation) {
    actor.history.observe(o);
    this.log.observation(o);
  }
  private async run(actor: Actor) {
    let steps = 0;
    while (!this.closed) {
      const freshSpeech =
        actor.role === "fast" &&
        actor.pendingSpeech &&
        actor.pendingSpeech.revision !== actor.lastSpeech?.revision;
      const freshPublication =
        actor.role === "slow" &&
        this.publisher.current.fastWatermark > actor.observedFast;
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
        actor.pendingSpeech = undefined;
      }
      if (actor.role === "slow" && actor.passiveSpeech)
        actor.lastSpeech = actor.passiveSpeech;
      const current = this.publisher.current;
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
      actor.history.add({
        role: "user",
        content: JSON.stringify({
          context: this.options.context ?? "",
          speech: actor.lastSpeech ?? null,
          speechLabel:
            actor.role === "slow"
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
      actor.observedFast = current.fastWatermark;
      const branch = this.publisher.branch(
        actor.id,
        actor.role,
        current,
        actor.lastSpeech,
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
      const result = await this.options.model.infer({
        agent: actor.id,
        role: actor.role,
        input,
        tools: definitions(actor.role),
        signal: actor.controller.signal,
      });
      if (this.closed) return;
      for (const item of toResponseInputItems(result.output))
        actor.history.add(item);
      const calls = result.output.filter(
        (item) => item.type === "function_call",
      );
      const observations: Observation[] = [];
      for (const call of calls) {
        let output: unknown;
        try {
          const args = parseTool(actor.role, call.name, call.arguments);
          if (call.name === "view_slide") {
            const o = this.publisher.current;
            observations.push(o);
            output = { observationId: o.id };
          } else if (call.name === "edit") {
            const r = await this.publisher.edit(
              branch,
              call.call_id,
              args as unknown as Edit,
            );
            observations.push(r.current);
            output = {
              outcome: r.outcome,
              observationId: r.current.id,
              diagnostics: r.diagnostics,
            };
          } else output = await this.workTool(actor, call.name, args);
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
          output,
        });
      }
      // Append observations after ALL sibling call results to preserve call/output pairing.
      for (const o of observations) this.observe(actor, o);
      if (calls.length) continue;
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
  ) {
    if (name === "delegate") {
      const active = [...this.actors.values()].filter(
        (a) =>
          a.role === "specialist" && ["running", "waiting"].includes(a.state),
      ).length;
      if (active >= 2)
        throw new Error(
          "Two specialists already active. Wait for one before delegating more.",
        );
      const id = `specialist-${randomUUID()}`;
      const child = this.createActor(id, "specialist", actor.id);
      actor.children.add(id);
      actor.requiredResults.add(id);
      child.tasks.push({ task: String(args.task), facts: String(args.facts) });
      child.lastSpeech = actor.lastSpeech;
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
          text: JSON.stringify({ ref, mediaType, content }),
          artifacts: [ref],
        });
      return { ref };
    }
    if (name === "image_generate") {
      if (!this.options.client) throw new Error("Image client not configured");
      const response = await this.options.client.images.generate(
        {
          model: process.env.IMAGE_MODEL ?? "gpt-image-1",
          prompt: String(args.prompt),
          size: "1024x1024",
        },
        { signal: actor.controller.signal },
      );
      const encoded = response.data?.[0]?.b64_json;
      if (!encoded) throw new Error("Image generation returned no image bytes");
      const ref = this.assets.put("image/png", Buffer.from(encoded, "base64"));
      actor.artifacts.push(ref);
      if (actor.parent)
        this.sendMessage({
          id: randomUUID(),
          from: actor.id,
          to: actor.parent,
          text: `Generated illustration: ${ref}`,
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
          if (done() || this.closed) {
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
          (a) => a.state === "running" || a.state === "waiting",
        ) &&
        this.gate.inFlight === 0
      )
        return;
      await delay(20);
    }
    throw new Error("Runtime did not settle before deadline");
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.gate.close();
    this.publisher.closed = true;
    for (const actor of this.actors.values()) {
      actor.controller.abort();
      for (const waiter of actor.wakeWaiters) waiter();
    }
    await Promise.allSettled([...this.actors.values()].map((a) => a.promise));
    await this.publisher.close();
  }
}
