import test from "node:test";
import assert from "node:assert/strict";
import { SourceError } from "../../src/contracts.js";
import { History } from "../../src/orchestration/history.js";
import { Publisher } from "../../src/orchestration/publisher.js";
import { SlideRuntime } from "../../src/orchestration/runtime.js";
import type { GenerationBackend } from "../../src/orchestration/backend.js";
import type { ModelInput, Observation } from "../../src/orchestration/types.js";
const observation = (id: string): Observation => ({
  id,
  slideId: "slide",
  sourceRevision: id,
  source: `SOURCE_${id}`,
  screenshot: Buffer.from(id),
  screenshotMimeType: "image/jpeg",
  geometry: [],
  diagnostics: [],
  fastWatermark: 0,
});
const image = (revision: string) => ({
  role: "user" as const,
  content: [
    {
      type: "input_text" as const,
      text: JSON.stringify({ slideId: "slide", sourceDigest: revision }),
    },
    {
      type: "input_image" as const,
      detail: "auto" as const,
      image_url: `data:image/jpeg;base64,${Buffer.from(revision).toString("base64")}`,
    },
  ],
});

test("canonical history bounds distinct observations and explicit images without losing outcomes or reasoning", () => {
  const h = new History(true);
  for (const id of ["a", "b", "b", "c"]) {
    h.boundary({
      kind: "current_boundary",
      deck: { source: `DECK_${id}` },
      activation: { id },
      tasks: [{ task: `TASK_${id}` }],
      messages: [],
    });
    h.observe(observation(id));
    h.modelItem(image(id));
  }
  for (const id of ["a", "b", "c"]) {
    h.add({
      type: "function_call",
      call_id: id,
      name: "edit_source",
      arguments: JSON.stringify({ edits: [{ text: `EDIT_${id}` }] }),
    });
    h.add({
      type: "function_call_output",
      call_id: id,
      output: JSON.stringify({
        revision: id,
        outcome: "committed",
        source: `BODY_${id}`,
        diagnostics: [{ message: "preserved" }],
      }),
    });
  }
  h.add({
    type: "reasoning",
    id: "r",
    summary: [],
    encrypted_content: "opaque",
  });
  const output = h.project(),
    text = JSON.stringify(output);
  assert.equal((text.match(/input_image/g) ?? []).length, 2);
  assert.equal((text.match(/current_boundary/g) ?? []).length, 1);
  assert(!text.includes("SOURCE_a"));
  assert(!text.includes("DECK_a"));
  assert(!text.includes("BODY_a"));
  assert(!text.includes("EDIT_a"));
  assert(text.includes("TASK_a"));
  assert(text.includes("BODY_b") && text.includes("BODY_c"));
  assert(text.includes("opaque"));
  for (const id of ["a", "b", "c"])
    assert.equal(
      output.filter((item) => "call_id" in item && item.call_id === id).length,
      2,
    );
  assert.equal((text.match(/committed/g) ?? []).length, 3);
  assert.equal((text.match(/preserved/g) ?? []).length, 3);
  assert(
    JSON.stringify(h.entries).includes("BODY_a"),
    "projection must not rewrite logs/history",
  );
});

test("canonical activation retains inspect-only tasks and supplies speech once across tool boundaries", async () => {
  const p = new Publisher({
    async render() {
      return {
        screenshot: Buffer.from("legacy"),
        geometry: [],
        diagnostics: [],
      };
    },
    async close() {},
  }) as GenerationBackend;
  let observations = 0,
    speechRevision = 0;
  p.generation = {
    instructions: () => "test",
    definitions: () => [
      {
        type: "function",
        name: "screenshot",
        description: "test",
        parameters: { type: "object" },
        strict: false,
      },
    ],
    context: () => ({ revision: "a" }),
    observe: async () => {
      observations++;
      return { ...observation("a"), screenshot: Buffer.alloc(0) };
    },
    invoke: async () => ({
      output: { sourceDigest: "a" },
      modelItems: [image("a")],
    }),
    deliverUtterance: async (u) => ({
      receipt: { utteranceId: u.id, retainedAtMs: 1 },
      speech: {
        slideId: u.slideId,
        revision: ++speechRevision,
        text: u.text,
        receivedAt: 1,
        corrections: [],
      },
    }),
  };
  const inputs: ModelInput[] = [];
  const rt = await SlideRuntime.create({
    backend: p,
    autoTick: false,
    decider: {
      async evaluate() {
        return "dispatch";
      },
    },
    slowDecider: {
      async evaluate() {
        return "hold";
      },
    },
    model: {
      async infer(input) {
        inputs.push(input);
        return {
          output: [
            {
              type: "function_call",
              name: inputs.length % 2 ? "screenshot" : "finish",
              arguments: "{}",
              call_id: `call_${inputs.length}`,
            },
          ],
        };
      },
    },
  });
  try {
    rt.followupTask("slow", {
      id: "inspect",
      slideId: p.selectedId,
      task: "Inspect without editing",
      facts: "user request",
    });
    await rt.settle(1000);
    assert.equal(inputs.length, 2);
    const boundaries = inputs.map((input) =>
      input.input
        .flatMap((item) =>
          "content" in item &&
          typeof item.content === "string" &&
          item.content.startsWith("{")
            ? [JSON.parse(item.content)]
            : [],
        )
        .find((item) => item.kind === "current_boundary"),
    );
    assert.equal(boundaries[0].activation, undefined);
    assert.deepEqual(boundaries[0].activeTasks, boundaries[1].activeTasks);
    assert.equal(boundaries[1].newTaskCount, undefined);
    assert.equal(boundaries[1].activeTasks[0].task, "Inspect without editing");
    assert.equal(boundaries[1].activeTasks[0].id, undefined);
    assert.equal(boundaries[1].speechDelivery.kind, "unchanged");
    assert.equal(observations, 2);
    p.generation!.invoke = async () => {
      throw new SourceError("HASH_CONFLICT", "stale", "node", {
        start: 1,
        end: 2,
      });
    };
    rt.followupTask("slow", {
      id: "again",
      slideId: p.selectedId,
      task: "Inspect again",
      facts: "user request",
    });
    await rt.settle(1000);
    const next = inputs[2].input
      .flatMap((item) =>
        "content" in item &&
        typeof item.content === "string" &&
        item.content.startsWith("{")
          ? [JSON.parse(item.content)]
          : [],
      )
      .find((item) => item.kind === "current_boundary");
    assert.equal(next.activation, undefined);
    assert.deepEqual(
      next.activeTasks.map((t: { task: string }) => t.task),
      ["Inspect again"],
    );
    const failure = inputs[3].input.find(
      (item) =>
        item.type === "function_call_output" && item.call_id === "call_3",
    );
    assert(
      failure?.type === "function_call_output" &&
        typeof failure.output === "string",
    );
    const error = JSON.parse(failure.output);
    assert.equal(error.code, "HASH_CONFLICT");
    assert.equal(error.nodeId, "node");
    assert.deepEqual(error.span, { start: 1, end: 2 });
    assert.equal(error.publication, undefined, "a failed screenshot cannot have published an edit");
    assert.equal(error.recovery, undefined, "recovery must not blindly instruct every caller to edit/reread source");
    p.generation!.invoke = async () => ({ output: { ok: true } });
    for (const [id, text] of [
      ["u1", "first"],
      ["u2", "first second"],
    ]) {
      await rt.deliverUtterance({
        id,
        text,
        slideId: p.selectedId,
        deliveredAtMs: 1,
      });
      await rt.gate.tick();
      await rt.settle(1000);
    }
    const current = (input: ModelInput) =>
      input.input
        .flatMap((item) =>
          "content" in item &&
          typeof item.content === "string" &&
          item.content.startsWith("{")
            ? [JSON.parse(item.content)]
            : [],
        )
        .find((item) => item.kind === "current_boundary");
    assert.equal(current(inputs[4]).speechDelivery.delta, "first");
    assert.equal(current(inputs[5]).speechDelivery.kind, "unchanged");
    assert.equal(current(inputs[6]).speechDelivery.kind, "append");
    assert.equal(current(inputs[6]).speechDelivery.delta, " second");
  } finally {
    await rt.close();
  }
});

test("same-revision node scopes retain all issued anchors and multi-slide screenshot messages retain only two frames", () => {
  const h = new History(true);
  for (const [revision, node] of [
    ["old", "a"],
    ["current", "a"],
    ["current", "b"],
    ["next", "c"],
  ]) {
    const call_id = `${revision}_${node}`;
    h.add({
      type: "function_call",
      name: "read_source",
      call_id,
      arguments: JSON.stringify({ nodeId: node }),
    });
    h.add({
      type: "function_call_output",
      call_id,
      output: JSON.stringify({
        revision,
        nodeId: node,
        lines: [{ number: 1, hash: call_id, text: `ANCHOR_${call_id}` }],
      }),
    });
  }
  h.modelItem({
    role: "user",
    content: [
      ...image("a").content,
      ...image("b").content,
      ...image("c").content,
    ],
  });
  const text = JSON.stringify(h.project());
  assert(!text.includes("ANCHOR_old_a"));
  assert(text.includes("ANCHOR_current_a"));
  assert(text.includes("ANCHOR_current_b"));
  assert(text.includes("ANCHOR_next_c"));
  assert.equal((text.match(/input_image/g) ?? []).length, 2);
  assert(!text.includes("base64,YQ=="));
});

function previewBackend(): GenerationBackend {
  const p = new Publisher({
    async render() {
      return { screenshot: Buffer.alloc(0), geometry: [], diagnostics: [] };
    },
    async close() {},
  }) as GenerationBackend;
  p.generation = {
    instructions: () => "test",
    definitions: () => [],
    context: () => ({ revision: "a" }),
    observe: async () => ({ ...observation("a"), screenshot: Buffer.alloc(0) }),
    invoke: async () => ({ output: {} }),
    deliverUtterance: async (u) => ({
      receipt: { utteranceId: u.id, retainedAtMs: 1 },
      speech: {
        slideId: u.slideId,
        text: u.text,
        revision: 1,
        receivedAt: 1,
        corrections: [],
      },
    }),
  };
  return p;
}
const lifecycleOptions = {
  autoTick: false,
  decider: {
    async evaluate() {
      return "hold" as const;
    },
  },
  slowDecider: {
    async evaluate() {
      return "hold" as const;
    },
  },
};
test("closing cancels a pending observation before any stale actor inference starts", async () => {
  const p = previewBackend();
  let observing!: () => void;
  const started = new Promise<void>((resolve) => (observing = resolve));
  p.generation!.observe = async () => {
    observing();
    return new Promise<Observation>(() => {});
  };
  let inferences = 0;
  const rt = await SlideRuntime.create({
    ...lifecycleOptions,
    backend: p,
    model: {
      async infer() {
        inferences++;
        return { output: [] };
      },
    },
  });
  rt.followupTask("slow", { task: "inspect", facts: "test" });
  await started;
  await rt.close();
  assert.equal(inferences, 0);
});

test("generated raster preview reaches specialist and parent as private image evidence", async () => {
  const p = previewBackend(),
    inputs: ModelInput[] = [];
  const counts = new Map<string, number>();
  const rt = await SlideRuntime.create({
    ...lifecycleOptions,
    backend: p,
    client: {
      images: {
        async generate() {
          return {
            data: [
              {
                b64_json: Buffer.from("synthetic mechanism-test PNG").toString(
                  "base64",
                ),
              },
            ],
          };
        },
      },
    } as unknown as import("openai").default,
    model: {
      async infer(input) {
        inputs.push(input);
        const count = (counts.get(input.role) ?? 0) + 1;
        counts.set(input.role, count);
        const name =
          input.role === "slow" && count === 1
            ? "delegate"
            : input.role === "specialist" && count === 1
              ? "image_generate"
              : "finish";
        const args =
          name === "delegate"
            ? {
                task: "Generate a private image",
                facts: "test",
                slideId: p.selectedId,
              }
            : name === "image_generate"
              ? { prompt: "test", quality: null, size: null }
              : {};
        return {
          output: [
            {
              type: "function_call",
              name,
              arguments: JSON.stringify(args),
              call_id: `${input.agent}_${count}`,
            },
          ],
        };
      },
    },
  });
  try {
    rt.followupTask("slow", { task: "Get a private image", facts: "test" });
    await rt.settle(1000);
    for (const role of ["slow", "specialist"]) {
      const input = inputs.find(
        (input) =>
          input.role === role &&
          JSON.stringify(input.input).includes("private_artifact_preview"),
      );
      assert(input, `${role} receives image evidence`);
      const serialized = JSON.stringify(input.input);
      assert(serialized.includes("input_image"));
      let preview: Record<string, unknown> | undefined;
      for (const item of input.input) {
        if (!("content" in item) || !Array.isArray(item.content)) continue;
        for (const part of item.content) {
          if (part.type !== "input_text" || !("text" in part)) continue;
          const value = JSON.parse(part.text);
          if (value.kind === "private_artifact_preview") preview = value;
        }
      }
      assert(preview);
      assert.deepEqual(Object.keys(preview).sort(), ["kind", "mediaType", "ref"]);
      assert.equal(preview.mediaType, "image/png");
      if (role === "specialist") {
        assert(serialized.includes('parentId\\\":\\\"slow'));
        const boundary = input.input.flatMap(item =>
          "content" in item && typeof item.content === "string" && item.content.startsWith("{")
            ? [JSON.parse(item.content)] : [],
        ).find(item => item.kind === "current_boundary");
        assert.equal(boundary.speech, undefined);
        assert.equal(boundary.deck, undefined);
        assert.equal(boundary.statuses, undefined);
        assert(boundary.activeTasks.length);
        assert(!serialized.includes("SOURCE_a"), "private specialist sees pixels, not editable source");
        const output = input.input.find(
          (item) =>
            item.type === "function_call_output" && item.call_id?.endsWith("_1"),
        );
        assert(
          output?.type === "function_call_output" &&
            typeof output.output === "string",
        );
        assert.deepEqual(Object.keys(JSON.parse(output.output)).sort(), [
          "canonicalAsset",
          "mediaType",
          "published",
          "queuedToParent",
          "ref",
        ]);
      }
    }
  } finally {
    await rt.close();
  }
});
