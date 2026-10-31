import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Publisher } from "../../src/orchestration/publisher.js";
import { SlideRuntime } from "../../src/orchestration/runtime.js";
import type {
  GenerationBackend,
  GenerationPolicy,
  GenerationInvocation,
} from "../../src/orchestration/backend.js";
import type { ModelInput, ModelResult } from "../../src/orchestration/types.js";

// Mechanism tests use an explicit synthetic backend. Real canonical/browser integration is separate.
const done: ModelResult = { output: [] };
const call = (name: string, id = name): ModelResult["output"][number] => ({
  type: "function_call",
  name,
  call_id: id,
  arguments: "{}",
});
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const options = {
  autoTick: false,
  decider: {
    async evaluate() {
      return "dispatch" as const;
    },
  },
  slowDecider: {
    async evaluate() {
      return "hold" as const;
    },
  },
};
function backend(overrides: Partial<GenerationPolicy> = {}): GenerationBackend {
  const p = new Publisher({
    async render() {
      return {
        screenshot: Buffer.from("SYNTHETIC_AUTO_IMAGE"),
        geometry: [],
        diagnostics: [],
      };
    },
    async close() {},
  }) as GenerationBackend;
  p.branch = () => {
    throw new Error("Legacy branch must not be used");
  };
  p.generation = {
    instructions: (role) => `Canonical instructions ${role}`,
    definitions: () =>
      ["read_source", "screenshot"].map((name) => ({
        type: "function",
        name,
        description: name,
        parameters: { type: "object", properties: {} },
        strict: false,
      })),
    context: () => ({ canonical: "immutable" }),
    invoke: async () => ({ output: { ok: true } }),
    deliverUtterance: async (input) => ({
      receipt: { utteranceId: input.id, retainedAtMs: performance.now() },
      speech: {
        text: input.text,
        revision: 1,
        slideId: input.slideId,
        receivedAt: input.deliveredAtMs,
        corrections: [],
      },
    }),
    ...overrides,
  };
  return p;
}

test("canonical actor boundary uses injected prompt/context/tools and only explicitly requested images", async () => {
  const context = { canonical: "immutable" },
    invocations: GenerationInvocation[] = [],
    inputs: ModelInput[] = [];
  const p = backend({
    context: () => context,
    invoke: async (input, name) => {
      invocations.push(input);
      return {
        output: { name },
        ...(name === "screenshot"
          ? {
              modelItems: [
                {
                  role: "user" as const,
                  content: [
                    {
                      type: "input_image" as const,
                      image_url: "data:image/jpeg;base64,ZXhwbGljaXQ=",
                      detail: "auto" as const,
                    },
                  ],
                },
              ],
            }
          : {}),
      };
    },
  });
  const rt = await SlideRuntime.create({
    ...options,
    backend: p,
    model: {
      async infer(input) {
        inputs.push(input);
        if (inputs.length === 1) {
          context.canonical = "later";
          return {
            output: [
              call("read_source"),
              call("screenshot"),
              call("edit", "forbidden"),
            ],
          };
        }
        return done;
      },
    },
  });
  try {
    await rt.deliverUtterance({
      id: "u1",
      slideId: p.selectedId,
      text: "Exact words",
      deliveredAtMs: 1,
    });
    await rt.gate.tick();
    await rt.settle(1000);
    assert.equal(inputs.length, 2);
    assert.equal(inputs[0].instructions, "Canonical instructions fast");
    assert.deepEqual(
      inputs[0].tools.map((t) => t.name),
      ["read_source", "screenshot", "finish"],
    );
    assert.ok(!JSON.stringify(inputs[0].input).includes("input_image"));
    assert.ok(
      !JSON.stringify(inputs[0].input).includes(
        "Listening for your first idea",
      ),
    );
    assert.deepEqual(invocations[0].context, { canonical: "immutable" });
    assert.equal(invocations[0], invocations[1]);
    const next = inputs[1].input;
    const images = next.filter(
      (i) =>
        "content" in i &&
        Array.isArray(i.content) &&
        i.content.some((c) => c.type === "input_image"),
    );
    assert.equal(images.length, 1);
    const lastOutput = next.findLastIndex(
      (i) => i.type === "function_call_output",
    );
    const imageIndex = next.findIndex(
      (i) =>
        "content" in i &&
        Array.isArray(i.content) &&
        i.content.some((c) => c.type === "input_image"),
    );
    assert.ok(imageIndex > lastOutput);
    assert.ok(
      JSON.stringify(next).includes(
        "not available in canonical generation mode",
      ),
    );
    assert.throws(
      () => rt.receiveTranscript("bypass", 2),
      /durable deliverUtterance/,
    );
  } finally {
    await rt.close();
  }
});

test("durable receipt precedes decisions, duplicate receipts do not dispatch twice, and pause holds accepted input", async () => {
  const retained = deferred<void>();
  let duplicate = false,
    calls = 0,
    decisions = 0;
  const p = backend({
    deliverUtterance: async (input) => {
      await retained.promise;
      return {
        receipt: { utteranceId: input.id, retainedAtMs: performance.now() },
        duplicate,
        speech: {
          slideId: input.slideId,
          revision: 1,
          text: input.text,
          receivedAt: 1,
          corrections: [],
        },
      };
    },
  });
  const rt = await SlideRuntime.create({
    ...options,
    backend: p,
    decider: {
      async evaluate() {
        decisions++;
        return "dispatch";
      },
    },
    model: {
      async infer() {
        calls++;
        return done;
      },
    },
  });
  try {
    const input = {
      id: "u1",
      slideId: p.selectedId,
      text: "all original words",
      deliveredAtMs: 1,
    };
    const receiving = rt.deliverUtterance(input);
    await rt.gate.tick();
    assert.equal(decisions, 0);
    assert.equal(calls, 0);
    rt.pause();
    retained.resolve();
    await receiving;
    await rt.gate.tick();
    assert.equal(calls, 0);
    assert.equal(rt.gate.latest?.text, input.text);
    rt.resume();
    await rt.gate.tick();
    await rt.settle(1000);
    assert.equal(calls, 1);
    duplicate = true;
    await rt.deliverUtterance(input);
    await rt.gate.tick();
    await delay(5);
    assert.equal(calls, 1);
    assert.equal(decisions, 1);
  } finally {
    await rt.close();
  }
});
