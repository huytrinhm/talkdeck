import OpenAI from "openai";
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { SourceError } from "../contracts.js";
import { lineHash } from "../hashline.js";
import { nodes, parseSource } from "../parser.js";
import { RecordedTools } from "../evaluation/replay.js";
import {
  OpenAIModel,
  OpenAIDecider,
  OpenAISlowDecider,
} from "../orchestration/openai.js";
import { SlideRuntime } from "../orchestration/runtime.js";
import type {
  DecisionInput,
  Model,
  Role,
  Speech,
} from "../orchestration/types.js";
import type {
  GenerationInvocation,
  GenerationToolResult,
} from "../orchestration/backend.js";
import type { JsxBackend } from "../host/jsx-backend.js";
import type { ProviderCassette, ProviderRecord } from "./models.js";
import type { InputUtterance } from "../source/ingestion.js";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function refuse(message: string): never {
  throw new SourceError("actor_replay_mismatch", message);
}
const stable = (value: unknown) =>
  JSON.stringify(value, (_, child) =>
    child && typeof child === "object" && !Array.isArray(child)
      ? Object.fromEntries(
          Object.entries(child).sort(([a], [b]) => a.localeCompare(b)),
        )
      : child,
  );
function equal(actual: unknown, expected: unknown, label: string) {
  if (stable(actual) !== stable(expected))
    refuse(`${label} differs from recorded evidence`);
}
const json = (value: string) => JSON.parse(value);
export interface ActorReplayRecording {
  initialSource: string;
  finalSourceSha256: string;
  initialContext: string;
  models: Record<Role | "decision", string>;
  providers: ProviderCassette;
  commits: {
    sequence: number;
    atMs: number;
    beforeSourceSha: string;
    afterSourceSha: string;
    source: string;
    reason: "edit" | "input";
    transactionId?: string;
  }[];
  operations: any[];
  scheduler: any[];
}
interface ToolPending {
  input: GenerationInvocation;
  args: unknown;
  release: ReturnType<typeof deferred<void>>;
  executed: ReturnType<typeof deferred<GenerationToolResult>>;
  promise: Promise<GenerationToolResult>;
}
interface Event {
  atMs: number;
  priority: number;
  run(): Promise<void>;
}

/** Actual actor/gate execution with recorded external completion order. No replacement scheduler or provider fallback. */
export async function replayRecordedActors(
  recording: ActorReplayRecording,
  backend: JsxBackend,
) {
  if (backend.runtime.engine.readDocument().source !== recording.initialSource)
    refuse("Initial source");
  if (
    !["recorded-model", "synthetic-test"].includes(
      recording.providers.provenance,
    )
  )
    refuse("Cassette provenance");
  if (
    recording.providers.records.some((r) => r.role === "specialist") ||
    recording.scheduler.some(
      (e) =>
        e.type === "tool_result" &&
        [
          "delegate",
          "send_message",
          "followup_task",
          "wait_for",
          "save_artifact",
          "image_generate",
        ].includes(e.name),
    )
  )
    refuse("This replay does not yet support specialist/task identity clocks");
  if (
    recording.operations.some(
      (o) =>
        !["input", "tool", "create"].includes(o.kind) ||
        (o.kind === "tool" && o.name === "screenshot"),
    )
  )
    refuse(
      "This replay supports recorded input, explicit creation and non-image generation tools; unsupported control/image operation",
    );
  const fatal: unknown[] = [],
    pendingProviders = new Map<string, ReturnType<typeof deferred<Response>>>();
  const seenProviders = new Set<string>(),
    finishedProviders = new Set<string>(),
    providerOrder = [...recording.providers.records].sort(
      (a, b) => a.startedAtMs - b.startedAtMs,
    );
  const providerContext = new AsyncLocalStorage<{
    role: string;
    agent: string;
  }>();
  const watch = <T>(promise: Promise<T>) => {
    promise.catch((error) => fatal.push(error));
    return promise;
  };
  const checkFatal = () => {
    if (fatal.length) throw fatal[0];
  };
  const until = async (condition: () => boolean, label: string) => {
    const end = performance.now() + 10_000;
    while (!condition()) {
      checkFatal();
      if (performance.now() > end) refuse(`Timed out waiting for ${label}`);
      await delay(1);
    }
    checkFatal();
  };
  const transport: typeof fetch = async (url, init) => {
    try {
      const context = providerContext.getStore();
      if (!context || typeof init?.body !== "string")
        refuse("Unattributed provider request");
      const endpoint = new URL(String(url)).pathname;
      const entry = providerOrder.find(
        (record) =>
          !seenProviders.has(record.id) &&
          record.role === context.role &&
          record.agent === context.agent &&
          record.endpoint === endpoint,
      );
      if (!entry)
        refuse(
          `No recorded provider request for ${context.role}/${context.agent}`,
        );
      if (entry.requestBody !== init.body) {
        const actual = init.body;
        let offset = 0;
        while (
          offset < Math.min(actual.length, entry.requestBody.length) &&
          actual[offset] === entry.requestBody[offset]
        )
          offset++;
        refuse(
          `Provider ${entry.id} literal request differs at byte ${offset}; expected length ${entry.requestBody.length}, actual ${actual.length}`,
        );
      }
      seenProviders.add(entry.id);
      const pending = deferred<Response>();
      pendingProviders.set(entry.id, pending);
      const abort = () =>
        pending.reject(
          new SourceError(
            "actor_replay_abort",
            "Actual scheduler aborted a recorded provider request",
          ),
        );
      init.signal?.addEventListener("abort", abort, { once: true });
      try {
        return await pending.promise;
      } finally {
        init.signal?.removeEventListener("abort", abort);
      }
    } catch (error) {
      fatal.push(error);
      throw error;
    }
  };
  const caps = [
    ...new Set(
      providerOrder
        .filter((r) => r.endpoint === "/v1/responses")
        .map((r) => json(r.requestBody).max_output_tokens),
    ),
  ];
  if (caps.length !== 1 || !Number.isInteger(caps[0]))
    refuse("Inconsistent recorded model output caps");
  const client = new OpenAI({
    apiKey: "offline-actor-replay",
    maxRetries: 0,
    fetch: transport,
  });
  const delegate = new OpenAIModel(client, recording.models, undefined, {
    maxOutputTokens: caps[0],
  });
  const decision = new OpenAIDecider(client, recording.models.decision),
    slowDecision = new OpenAISlowDecider(client, recording.models.decision);
  const model: Model = {
    infer: (input) =>
      providerContext.run({ role: input.role, agent: input.agent }, () =>
        delegate.infer(input),
      ),
  };
  const canonical = recording.operations.filter((o) => o.kind === "tool");
  const actualInvoke = backend.generation.invoke.bind(backend.generation),
    actualDeliver = backend.generation.deliverUtterance.bind(
      backend.generation,
    );
  const pendingTools = new Map<any, ToolPending>(),
    startedTools = new Set<any>();
  const toolExecutionTime = (operation: any) =>
    operation.name === "edit_source" &&
    operation.result?.accepted &&
    !operation.result.noOp
      ? (recording.commits.find(
          (c) => c.transactionId === operation.result.transactionId,
        )?.atMs ?? refuse("Accepted tool lacks authoritative commit"))
      : operation.startedAtMs;
  const executionOrder = [...canonical].sort(
    (a, b) => toolExecutionTime(a) - toolExecutionTime(b),
  );
  let executing: ToolPending | undefined;
  const verifiedTools = new RecordedTools(
    executionOrder.map((o) => ({
      name: o.name,
      argumentsJson: JSON.stringify(o.arguments),
      ...(o.result === undefined
        ? {}
        : { resultJson: JSON.stringify(o.result) }),
      ...(o.error ? { errorCode: o.error.code } : {}),
    })),
    async (name, args) => {
      if (!executing) refuse("Tool execution without scheduler invocation");
      return (await actualInvoke(executing.input, name, args)).output;
    },
  );
  backend.generation.invoke = async (input, name, args) => {
    try {
      const operation = canonical.find(
        (o) => !startedTools.has(o) && o.agent === input.agent,
      );
      if (!operation || operation.name !== name)
        refuse(`Actual ${input.agent} tool sequence differs: ${name}`);
      equal(args, operation.arguments, `Tool ${name} arguments`);
      equal(input.context, operation.context, `Tool ${name} immutable context`);
      startedTools.add(operation);
      const release = deferred<void>(),
        executed = deferred<GenerationToolResult>();
      const pending: ToolPending = {
        input,
        args,
        release,
        executed,
        promise: Promise.resolve({ output: undefined }),
      };
      pending.promise = (async () => {
        const result = await executed.promise.then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
        await release.promise;
        if ("error" in result) throw result.error;
        return result.value;
      })();
      pendingTools.set(operation, pending);
      return await pending.promise;
    } catch (error) {
      // Recorded tool failures are expected actor input; only mismatches fail the replay.
      if (error instanceof SourceError && error.code.startsWith("actor_replay"))
        fatal.push(error);
      throw error;
    }
  };
  const transcripts = recording.scheduler
    .filter((e) => e.type === "transcript" && e.speech)
    .sort((a, b) => a.atMs - b.atMs);
  const inputOperations = recording.operations.filter(
    (o) => o.kind === "input",
  );
  const inputPending = new Map<
    string,
    {
      ready: ReturnType<typeof deferred<void>>;
      release: ReturnType<typeof deferred<void>>;
      speech: Speech;
      operation: any;
    }
  >();
  const readyInputs = new Set<string>();
  let actors!: SlideRuntime;
  backend.generation.deliverUtterance = async (input) => {
    const pending = inputPending.get(input.id);
    if (!pending) refuse(`Unrecorded input ${input.id}`);
    const delivered = await actualDeliver(input);
    const withoutTime = ({
      receivedAt: _time,
      corrections: _corrections,
      ...speech
    }: Speech) => speech;
    equal(
      withoutTime(delivered.speech),
      withoutTime(pending.speech),
      `Durable speech ${input.id}`,
    );
    readyInputs.add(input.id);
    pending.ready.resolve();
    await pending.release.promise;
    // A replay clock value, after verifying the exact retained semantic snapshot. Never changes live behavior.
    return {
      ...delivered,
      speech: { ...delivered.speech, receivedAt: pending.speech.receivedAt },
    };
  };
  const actualToolLogs: any[] = [],
    observedCommits: string[] = [];
  const unsubscribe = backend.runtime.engine.subscribe((event) =>
    observedCommits.push(event.revision),
  );
  actors = await SlideRuntime.create({
    backend,
    model,
    autoTick: false,
    context: recording.initialContext,
    decider: {
      evaluate: (input, signal) =>
        providerContext.run({ role: "decision", agent: "speech-gate" }, () =>
          decision.evaluate(input, signal),
        ),
    },
    slowDecider: {
      evaluate: (input, signal) =>
        providerContext.run({ role: "slow-decision", agent: "slow-gate" }, () =>
          slowDecision.evaluate(input, signal),
        ),
    },
    log: {
      write(type, value) {
        if (type === "tool_result") actualToolLogs.push(value);
        if (type === "agent_error")
          fatal.push(new Error(String(value.message)));
      },
      observation() {},
    },
  });
  const events: Event[] = [],
    firstUndispatched = new Map<string, number>();
  const add = (atMs: number, priority: number, run: () => Promise<void>) => {
    if (!Number.isFinite(atMs)) refuse("Missing event time");
    events.push({ atMs, priority, run });
  };
  const hasInput = (source: string, id: string) =>
    [...nodes(parseSource(source))].some(
      (node) => node.tag === "Prompt" && node.props.utteranceId === id,
    );
  const commitForInput = (input: InputUtterance) => {
    const matches = recording.commits.filter(
      (commit) =>
        commit.reason === "input" &&
        hasInput(commit.source, input.id) &&
        !recording.commits
          .slice(0, commit.sequence)
          .some((previous) => hasInput(previous.source, input.id)),
    );
    if (matches.length !== 1) refuse(`Input ${input.id} has no unique commit`);
    return matches[0];
  };
  try {
    for (const operation of inputOperations) {
      const input = operation.input as InputUtterance,
        commit = commitForInput(input);
      const transcript = transcripts.find(
        (e) =>
          e.atMs >= commit.atMs &&
          e.speech.slideId === input.slideId &&
          ![...inputPending.values()].some((p) => p.speech === e.speech),
      );
      if (!transcript)
        refuse(`Input ${input.id} lacks a recorded gate receipt`);
      const pending = {
        ready: deferred<void>(),
        release: deferred<void>(),
        speech: transcript.speech as Speech,
        operation,
      };
      inputPending.set(input.id, pending);
      add(commit.atMs, 0, async () => {
        equal(
          lineHash(backend.runtime.engine.readDocument().source),
          commit.beforeSourceSha,
          "Input pre-commit source",
        );
        // The sole initial blank slide receives the explicit opening title without a second creation.
        const opening = input.text.match(
          /^(?:new|create)\s+(?:(?:a|an|the)\s+)?(?:(?:opening|closing|section|temporary)\s+)?slide\s+titled\s+(.+?)(?:[.!?]|$)/i,
        );
        if (commit.sequence === 0 && opening)
          backend.requestedTitles.set(
            input.slideId,
            opening[1].trim().replace(/^["“]|["”]$/g, ""),
          );
        watch(actors.deliverUtterance(input));
        await until(
          () => readyInputs.has(input.id),
          `durable input ${input.id}`,
        );
        equal(
          lineHash(backend.runtime.engine.readDocument().source),
          commit.afterSourceSha,
          "Input committed source",
        );
      });
      add(transcript.atMs, 1, async () => {
        const gate = actors.gates.get(input.slideId);
        if (
          !gate?.latest ||
          gate.latest.revision === (gate.lastDispatched?.revision ?? 0)
        )
          firstUndispatched.set(input.slideId, pending.speech.receivedAt);
        pending.release.resolve();
        await until(
          () =>
            actors.gates.get(input.slideId)?.latest?.revision ===
            pending.speech.revision,
          "recorded gate receipt",
        );
        equal(
          actors.gates.get(input.slideId)!.latest,
          pending.speech,
          "Actual gate speech",
        );
      });
    }
    for (const operation of recording.operations.filter(
      (o) => o.kind === "create",
    )) {
      const commit = recording.commits.find(
        (c) => c.afterSourceSha === operation.sourceSha256,
      );
      if (!commit) refuse("Creation commit");
      add(commit.atMs, 0, async () => {
        equal(
          lineHash(backend.runtime.engine.readDocument().source),
          commit.beforeSourceSha,
          "Create pre-commit source",
        );
        const created = await backend.createSlide(operation.title);
        equal(created.id, operation.slideId, "Created identity");
        equal(
          lineHash(backend.runtime.engine.readDocument().source),
          commit.afterSourceSha,
          "Created source",
        );
      });
    }
    for (const operation of canonical) {
      add(toolExecutionTime(operation), 2, async () => {
        await until(
          () => pendingTools.has(operation),
          `actor tool ${operation.name}`,
        );
        const pending = pendingTools.get(operation)!;
        executing = pending;
        try {
          const output = await verifiedTools.invoke(
            operation.name,
            JSON.stringify(operation.arguments),
          );
          pending.executed.resolve({ output });
        } catch (error) {
          if (
            !(error instanceof SourceError) ||
            error.code !== operation.error?.code
          )
            throw error;
          pending.executed.reject(error);
        } finally {
          executing = undefined;
        }
      });
      add(operation.finishedAtMs, 3, async () => {
        await until(
          () => pendingTools.has(operation),
          `tool completion ${operation.name}`,
        );
        pendingTools.get(operation)!.release.resolve();
      });
    }
    for (const entry of providerOrder) {
      add(entry.startedAtMs, 4, async () => {
        if (entry.role === "decision") {
          const expected = json(json(entry.requestBody).input) as DecisionInput;
          const id = expected.speech.slideId;
          if (!id) refuse("Decision slide attribution");
          const gate = actors.gates.get(id),
            first = firstUndispatched.get(id);
          if (!gate || first === undefined)
            refuse("Decision arrived before its retained input");
          equal(gate.latest, expected.speech, "Decision speech");
          equal(
            gate.lastDispatched,
            expected.lastDispatched,
            "Decision baseline",
          );
          watch(gate.tick(first + expected.undispatchedAgeMs));
        }
        await until(
          () => seenProviders.has(entry.id),
          `provider request ${entry.id}`,
        );
      });
      add(entry.finishedAtMs, 5, async () => {
        await until(
          () => pendingProviders.has(entry.id),
          `provider completion ${entry.id}`,
        );
        if (!entry.responseBody || !entry.status || entry.errorCode)
          refuse(
            `Recorded transport error ${entry.id} is outside bounded actor replay coverage`,
          );
        finishedProviders.add(entry.id);
        pendingProviders.get(entry.id)!.resolve(
          new Response(entry.responseBody, {
            status: entry.status,
            headers: {
              "Content-Type": "application/json",
              ...(entry.providerRequestId
                ? { "x-request-id": entry.providerRequestId }
                : {}),
            },
          }),
        );
      });
    }
    events.sort((a, b) => a.atMs - b.atMs || a.priority - b.priority);
    for (const event of events) {
      checkFatal();
      await event.run();
    }
    await actors.settle(10_000);
    checkFatal();
    verifiedTools.assertConsumed();
    equal(
      observedCommits,
      recording.commits.map((c) => c.afterSourceSha),
      "Actual commit sequence",
    );
    equal(
      lineHash(backend.runtime.engine.readDocument().source),
      recording.finalSourceSha256,
      "Final canonical source",
    );
    const expectedTools = recording.scheduler.filter(
      (e) => e.type === "tool_result",
    );
    equal(
      actualToolLogs.map((e) => ({
        name: e.name,
        argumentsJson: e.argumentsJson,
        resultJson: e.resultJson,
      })),
      expectedTools.map((e) => ({
        name: e.name,
        argumentsJson: e.argumentsJson,
        resultJson: e.resultJson,
      })),
      "Actual lifecycle/generation tool sequence",
    );
    if (
      seenProviders.size !== providerOrder.length ||
      finishedProviders.size !== providerOrder.length
    )
      refuse("Unconsumed provider requests");
    return {
      mode: "recorded-event-actor-replay" as const,
      provenance: recording.providers.provenance,
      actorReplay: true,
      sourceSha256: recording.finalSourceSha256,
      exactProviderRequests: seenProviders.size,
      verifiedTools: actualToolLogs.length,
      verifiedCommits: observedCommits.length,
      snapshots: verifiedTools.snapshots.entries(),
      transactions: verifiedTools.transactions(),
      coverage: {
        actualActorScheduler: true,
        actualSpeechGate: true,
        recordedTickInputs: true,
        recordedCompletionOrder: true,
        recordedSemanticClocks: true,
        actualBrowserChecks: true,
        validationWorkSerializedAtRecordedCommits: true,
        virtualEventTiming: true,
        liveLatencyEvidence: false,
        specialists: false,
        userHistoryControls: false,
        explicitImages: false,
      },
    };
  } finally {
    for (const pending of pendingProviders.values())
      pending.reject(new Error("Replay closed"));
    for (const pending of pendingTools.values()) {
      pending.release.resolve();
      pending.executed.reject(new Error("Replay closed"));
    }
    for (const pending of inputPending.values()) pending.release.resolve();
    await actors.close();
    unsubscribe();
    backend.generation.invoke = actualInvoke;
    backend.generation.deliverUtterance = actualDeliver;
  }
}
