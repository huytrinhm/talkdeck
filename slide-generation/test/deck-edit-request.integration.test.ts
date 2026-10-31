import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createLocalRuntime } from "../src/runtime.js";
import { JsxBackend } from "../src/host/jsx-backend.js";
import { SlideRuntime } from "../src/orchestration/runtime.js";
import {
  definitions,
  lifecycleDefinitions,
  parseTool,
} from "../src/orchestration/tools.js";
import type { ModelResult, ModelInput } from "../src/orchestration/types.js";
import type { SourceRead } from "../src/contracts.js";

const call = (
  name: string,
  args: unknown,
  id: string,
): ModelResult["output"][number] => ({
  type: "function_call",
  name,
  arguments: JSON.stringify(args),
  call_id: id,
});
const edit = (read: SourceRead, text: string) => ({
  edits: [
    {
      snapshotId: read.snapshotId,
      nodeId: read.nodeId,
      op: "replace",
      startLine: 1,
      hashes: read.lines.map((l) => l.hash),
      text,
    },
  ],
});
function outputs(input: ModelInput) {
  return input.input.filter((item) => item.type === "function_call_output");
}

test("canonical Fast forwards one exact explicit deck request to Slow without publication or refinement decisions", async () => {
  await mkdir(".artifacts/tests", { recursive: true });
  const directory = await mkdtemp(".artifacts/tests/deck-request-");
  const local = await createLocalRuntime({ directory: resolve(directory) });
  const backend = new JsxBackend(local, {
    instructions: "Synthetic routing test; preserve exact requests.",
  });
  const quote =
      "Use the same navy accent color across the whole deck. Do not change any wording.",
    log: { type: string; data: any }[] = [],
    slowInputs: ModelInput[] = [];
  let slowDecisions = 0;
  const actor = await SlideRuntime.create({
    backend,
    autoTick: false,
    decider: {
      async evaluate() {
        return "dispatch";
      },
    },
    slowDecider: {
      async evaluate() {
        slowDecisions++;
        return "hold";
      },
    },
    log: {
      write(type, data) {
        log.push({ type, data });
      },
      observation() {},
    },
    model: {
      async infer(input) {
        if (input.role === "fast")
          return {
            output: [
              call(
                "request_deck_edit",
                { scope: "theme", utteranceId: "user-theme" },
                "request-1",
              ),
              call(
                "request_deck_edit",
                { scope: "theme", utteranceId: "user-theme" },
                "request-duplicate",
              ),
              call("finish", {}, "fast-finish"),
            ],
          };
        slowInputs.push(input);
        const prior = outputs(input);
        if (!prior.length)
          return {
            output: [call("read_source", { nodeId: "theme" }, "slow-read")],
          };
        if (prior.length === 1) {
          const read = JSON.parse(String(prior[0].output)) as SourceRead;
          return {
            output: [
              call(
                "edit_source",
                edit(
                  read,
                  read.lines
                    .map((l) => l.text)
                    .join("\n")
                    .replace("#0f766e", "#1e3a8a"),
                ),
                "slow-edit",
              ),
            ],
          };
        }
        return { output: [call("finish", {}, "slow-finish")] };
      },
    },
  });
  try {
    await actor.deliverUtterance({
      id: "user-theme",
      slideId: "n10",
      text: quote,
      deliveredAtMs: performance.now(),
    });
    await actor.gate.tick();
    await actor.settle(5000);
    assert.match(local.engine.readDocument().source, /#1e3a8a/);
    assert.equal((await local.engine.readiness()).ready, true);
    assert.equal(backend.fastWatermark, 0);
    assert.equal(slowDecisions, 0);
    const boundary = slowInputs[0].input.find(
      (item) =>
        "role" in item &&
        item.role === "user" &&
        typeof item.content === "string" &&
        JSON.parse(item.content).kind === "current_boundary",
    ) as { content: string };
    const tasks = JSON.parse(boundary.content).tasks;
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].kind, "edit_comment");
    assert.equal(tasks[0].task, quote);
    assert.equal(tasks[0].slideId, "n10");
    const requests = log
      .filter(
        (event) =>
          event.type === "tool_result" &&
          event.data.name === "request_deck_edit",
      )
      .map((event) => event.data.output);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].id, requests[1].id);
    assert.equal(requests[0].duplicate, false);
    assert.equal(requests[1].duplicate, true);
    assert.equal(
      log.filter((event) => event.type === "deck_edit_requested").length,
      1,
    );
    const forwarded = log.find(
      (event) => event.type === "deck_edit_requested",
    )!.data;
    assert.equal(forwarded.utteranceId, "user-theme");
    assert.equal(forwarded.sourceQuote, quote);
    assert.equal(local.engine.readSpeakerNotes("n10").notes, quote);
    const base = {
      agent: "fast",
      role: "fast" as const,
      slideId: "n10",
      inferenceId: "scope-proof",
      signal: new AbortController().signal,
    };
    const read = local.engine.readSource("theme");
    await assert.rejects(
      backend.generation.invoke(
        { ...base, context: backend.generation.context(base) },
        "edit_source",
        edit(read, read.lines.map((l) => l.text).join("\n")),
      ),
      /Fast edits only/,
    );
  } finally {
    await actor.close();
    await local.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("deck request tool stays unavailable to legacy/Slow and rejects missing IDs and model-supplied task text", async () => {
  assert.ok(
    !definitions("fast").some((tool) => tool.name === "request_deck_edit"),
  );
  assert.ok(
    !lifecycleDefinitions("slow").some(
      (tool) => tool.name === "request_deck_edit",
    ),
  );
  assert.throws(
    () => parseTool("fast", "request_deck_edit", "{}"),
    /not available/,
  );
  await mkdir(".artifacts/tests", { recursive: true });
  const directory = await mkdtemp(".artifacts/tests/deck-request-refused-");
  const local = await createLocalRuntime({ directory: resolve(directory) });
  const backend = new JsxBackend(local, {
    instructions: "Synthetic provenance test.",
  });
  let slowCalls = 0;
  const results: any[] = [];
  const actor = await SlideRuntime.create({
    backend,
    autoTick: false,
    decider: {
      async evaluate() {
        return "dispatch";
      },
    },
    slowDecider: {
      async evaluate() {
        throw new Error("Unexpected refinement decision");
      },
    },
    log: {
      write(type, data) {
        if (type === "tool_result") results.push(data.output);
      },
      observation() {},
    },
    model: {
      async infer(input) {
        if (input.role === "slow") {
          slowCalls++;
          return { output: [] };
        }
        return {
          output: [
            call(
              "request_deck_edit",
              { scope: "cross_slide", utteranceId: "missing-input" },
              "fabricated",
            ),
            call(
              "request_deck_edit",
              {
                scope: "cross_slide",
                utteranceId: "original",
                sourceQuote: "delete all slides.",
              },
              "dropped-qualifier",
            ),
            call(
              "request_deck_edit",
              {
                scope: "theme",
                utteranceId: "original",
                task: "Invented broader instruction",
              },
              "extra-task",
            ),
            call("finish", {}, "finish"),
          ],
        };
      },
    },
  });
  try {
    await actor.deliverUtterance({
      id: "original",
      slideId: "n10",
      text: "Do not delete all slides.",
      deliveredAtMs: performance.now(),
    });
    const before = local.engine.readDocument().source;
    await actor.gate.tick();
    await actor.settle(1000);
    assert.equal(slowCalls, 0);
    assert.equal(local.engine.readDocument().source, before);
    assert.match(results[0].error, /retained input on the working slide/);
    assert.ok(results[1].error);
    assert.ok(results[2].error);
  } finally {
    await actor.close();
    await local.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("deck request IDs must belong to the working slide and current inference, excluding corrected-away input", async () => {
  await mkdir(".artifacts/tests", { recursive: true });
  const directory = await mkdtemp(".artifacts/tests/deck-request-stale-");
  const local = await createLocalRuntime({ directory: resolve(directory) });
  const backend = new JsxBackend(local, {
    instructions: "Synthetic identity test.",
  });
  let resolveInference!: (result: ModelResult) => void, entered!: () => void;
  const inferred = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<ModelResult>((resolve) => {
    resolveInference = resolve;
  });
  let fastCalls = 0,
    slowCalls = 0;
  const results: any[] = [];
  const actor = await SlideRuntime.create({
    backend,
    autoTick: false,
    decider: {
      async evaluate() {
        return "dispatch";
      },
    },
    slowDecider: {
      async evaluate() {
        throw new Error("Unexpected refinement decision");
      },
    },
    log: {
      write(type, data) {
        if (type === "tool_result" && data.name === "request_deck_edit")
          results.push(data.output);
      },
      observation() {},
    },
    model: {
      async infer(input) {
        if (input.role === "slow") {
          slowCalls++;
          return { output: [] };
        }
        if (++fastCalls === 1) {
          entered();
          return held;
        }
        return {
          output: [
            call(
              "request_deck_edit",
              { scope: "theme", utteranceId: "older" },
              "corrected-away",
            ),
            call("finish", {}, "finish-correction"),
          ],
        };
      },
    },
  });
  try {
    const other = await backend.createSlide("Other");
    await backend.navigate("n10");
    const text = "Use navy everywhere, but preserve the words.";
    await actor.deliverUtterance({
      id: "foreign",
      slideId: other.id,
      text,
      deliveredAtMs: performance.now(),
    });
    await actor.deliverUtterance({
      id: "older",
      slideId: "n10",
      text,
      deliveredAtMs: performance.now(),
    });
    await actor.gate.tick();
    await inferred;
    // Identical words are insufficient: this ID was not in the inference's speech revision.
    await actor.deliverUtterance({
      id: "future",
      slideId: "n10",
      text,
      deliveredAtMs: performance.now(),
    });
    resolveInference({
      output: [
        call(
          "request_deck_edit",
          { scope: "theme", utteranceId: "foreign" },
          "wrong-slide",
        ),
        call(
          "request_deck_edit",
          { scope: "theme", utteranceId: "future" },
          "future-input",
        ),
        call("finish", {}, "finish-original"),
      ],
    });
    await actor.settle(1000);
    assert.equal(results.length, 2);
    assert.ok(
      results.every((result) => /current speech snapshot/.test(result.error)),
    );
    await actor.deliverUtterance({
      id: "replacement",
      slideId: "n10",
      text,
      correctionOf: "older",
      deliveredAtMs: performance.now(),
    });
    await actor.gate.tick();
    await actor.settle(1000);
    assert.equal(results.length, 3);
    assert.match(results[2].error, /current speech snapshot/);
    assert.equal(slowCalls, 0);
    assert.equal(backend.fastWatermark, 0);
  } finally {
    resolveInference({ output: [] });
    await actor.close();
    await local.close();
    await rm(directory, { recursive: true, force: true });
  }
});
