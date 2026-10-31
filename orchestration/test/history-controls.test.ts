import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { Publisher } from "../src/publisher.js";
import { SlideRuntime } from "../src/runtime.js";
import {
  blankSlide,
  type ModelInput,
  type ModelResult,
  type Renderer,
  type Rendered,
} from "../src/types.js";
import type OpenAI from "openai";

const frame = (source: string): Rendered => ({
  screenshot: Buffer.from(source),
  geometry: [],
  diagnostics: [],
});
const renderer: Renderer = {
  async render(source) {
    return frame(source);
  },
  async close() {},
};
const done: ModelResult = { output: [] };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const until = async (predicate: () => boolean) => {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await delay(5);
  }
  throw new Error("Condition not reached");
};
const call = (name: string, args: unknown, id = "call"): ModelResult => ({
  output: [
    {
      type: "function_call",
      name,
      arguments: JSON.stringify(args),
      call_id: id,
    },
  ],
});
const options = {
  renderer,
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
const context = (input: ModelInput): any => {
  const last = [...input.input]
    .reverse()
    .find(
      (i) =>
        "role" in i &&
        i.role === "user" &&
        typeof i.content === "string" &&
        i.content.startsWith('{"context"'),
    );
  return JSON.parse((last as { content: string }).content);
};
const editTitle = (
  p: Publisher,
  old: string,
  title: string,
  role: "fast" | "slow" = "slow",
) => p.edit(p.branch(role, role, p.current), "edit", { old, new: title });

test("content undo/redo restores exact source/frame, rejects ABA branches, and only real changes clear redo", async () => {
  const p = new Publisher(renderer);
  await p.initialize(blankSlide);
  const initial = p.current;
  const obsolete = p.branch("fast", "fast", initial);
  assert.equal(
    (await editTitle(p, "Your talk", "New title")).outcome,
    "published",
  );
  const edited = p.current;
  assert.equal(p.historyStatus().undoDepth, 1);
  await p.restoreHistory("undo");
  assert.equal(p.current.source, initial.source);
  assert.deepEqual(p.current.screenshot, initial.screenshot);
  assert.notEqual(p.current.id, initial.id);
  let conflicts = 0;
  p.onConflict = () => {
    conflicts++;
  };
  assert.equal(
    (await p.edit(obsolete, "stale", { old: "Your talk", new: "Resurrected" }))
      .outcome,
    "rejected",
  );
  assert.equal(conflicts, 0);
  // A caller retaining an old observation cannot create a fresh valid ABA branch.
  assert.equal(
    (
      await p.edit(p.branch("slow", "slow", initial), "old", {
        old: "Your talk",
        new: "Bad",
      })
    ).outcome,
    "rejected",
  );
  assert.equal(
    (await editTitle(p, "Your talk", "Your talk")).outcome,
    "unchanged",
  );
  assert.equal((await editTitle(p, "missing text", "Bad")).outcome, "rejected");
  assert.equal(p.historyStatus().redoDepth, 1);
  await p.restoreHistory("redo");
  assert.equal(p.current.source, edited.source);
  assert.deepEqual(p.current.screenshot, edited.screenshot);
  await p.restoreHistory("undo");
  await editTitle(p, "Your talk", "Different direction");
  assert.equal(p.historyStatus().canRedo, false);
  assert.equal((await p.restoreHistory("redo")).outcome, "unchanged");
  assert.equal(
    (await editTitle(p, "Different direction", "Still editable")).outcome,
    "published",
  );
  await p.close();
});

test("deck history restores create, atomic batch, split and merge with stable IDs and selection", async () => {
  const p = new Publisher(renderer);
  await p.initialize(blankSlide);
  const first = p.selectedId;
  const second = (await p.next()).id;
  await p.navigate(first);
  await p.restoreHistory("undo");
  assert.deepEqual(
    p.list().map((s) => s.id),
    [first],
  );
  await p.restoreHistory("redo");
  assert.deepEqual(
    p.list().map((s) => s.id),
    [first, second],
  );
  assert.equal(p.selectedId, first); // Navigation is not rewound.
  const depth = p.historyStatus().undoDepth;
  await p.editMany(
    p.list().map((s) => ({
      branch: p.branch("slow", "slow", s.observation),
      edit: { old: "Your talk", new: s.id },
    })),
    "batch",
  );
  assert.equal(p.historyStatus().undoDepth, depth + 1);
  await p.restoreHistory("undo");
  assert(p.list().every((s) => s.observation.source === blankSlide));
  await p.restoreHistory("redo");
  assert(p.list().every((s) => s.observation.source.includes(s.id)));
  const split = await p.split(p.branch("slow", "slow", p.current), [
    { title: "One", source: blankSlide },
    { title: "Two", source: blankSlide.replace("Your talk", "Two") },
  ]);
  const splitId = split.slideIds[1];
  await p.navigate(splitId);
  await p.restoreHistory("undo");
  assert.equal(p.selectedId, first);
  assert.equal(p.list().length, 2);
  await p.restoreHistory("redo");
  assert.deepEqual(
    p.list().map((s) => s.id),
    [first, splitId, second],
  );
  await p.navigate(splitId);
  await p.mergeSlides(
    [first, splitId].map((id) =>
      p.branch("slow", "slow", p.get(id).observation),
    ),
    { title: "Combined", source: blankSlide },
  );
  assert.equal(p.selectedId, first);
  await p.restoreHistory("undo");
  assert.equal(p.get(splitId).title, "Two");
  await p.restoreHistory("redo");
  assert.deepEqual(
    p.list().map((s) => s.id),
    [first, second],
  );
  assert.equal(p.get(first).title, "Combined");
  await p.close();
});

test("history logging failure is atomic and leaves fresh work editable", async () => {
  let fail = false;
  const p = new Publisher(renderer, {
    observation() {},
    write(type) {
      if (fail && type === "history_restored") throw new Error("Disk full");
    },
  });
  await p.initialize(blankSlide);
  await editTitle(p, "Your talk", "Changed");
  const before = p.current;
  fail = true;
  await assert.rejects(p.restoreHistory("undo"), /Disk full/);
  assert.equal(p.current.source, before.source);
  assert.equal(p.current.id, before.id);
  assert.equal(p.historyStatus().undoDepth, 1);
  assert.equal(p.historyStatus().redoDepth, 0);
  assert.equal((await editTitle(p, "Changed", "Fresh")).outcome, "published");
  await p.close();
});

test("push-to-edit is an explicit Slow task, stays targeted after navigation, and never changes narration", async () => {
  const inputs: ModelInput[] = [];
  let decisions = 0;
  const rt = await SlideRuntime.create({
    ...options,
    slowDecider: {
      async evaluate() {
        decisions++;
        return "hold";
      },
    },
    model: {
      async infer(input) {
        inputs.push(input);
        const tasks = context(input).tasks;
        if (tasks.length)
          return call("edit", {
            slideId: tasks[0].slideId,
            old: "Your talk",
            new: "Requested title",
          });
        return done;
      },
    },
  });
  try {
    const first = rt.publisher.selectedId;
    rt.pause();
    rt.receiveTranscript("Audience-facing content", 1);
    const receipt = rt.pushToEdit("  Change the title  ");
    assert.equal(receipt.slideId, first);
    const second = (await rt.nextSlide()).id;
    assert.equal(inputs.length, 0);
    rt.resume();
    await rt.settle();
    assert.equal(inputs[0].role, "slow");
    const c = context(inputs[0]);
    assert.deepEqual(c.tasks[0], {
      id: receipt.id,
      kind: "edit_comment",
      slideId: first,
      task: "Change the title",
      facts:
        "Explicit user editing instruction; do not insert the instruction itself as slide content.",
    });
    assert.equal(c.speech, null);
    assert.equal(decisions, 0);
    assert(
      rt.publisher.get(first).observation.source.includes("Requested title"),
    );
    assert.equal(rt.publisher.get(second).observation.source, blankSlide);
    assert.equal(rt.gates.get(first)!.latest!.text, "Audience-facing content");
    assert.throws(() => rt.pushToEdit("  "), /empty/);
    assert.throws(() => rt.pushToEdit("Edit", "removed"), /Unknown/);
    await rt.undo();
    assert.equal(rt.publisher.get(first).observation.source, blankSlide);
    await rt.redo();
    assert(
      rt.publisher.get(first).observation.source.includes("Requested title"),
    );
  } finally {
    await rt.close();
  }
});

test("undo cancels an uncooperative model, suppresses old speech, and allows fresh user work", async () => {
  const pending = deferred<ModelResult>();
  const inputs: ModelInput[] = [];
  const rt = await SlideRuntime.create({
    ...options,
    model: {
      async infer(input) {
        inputs.push(input);
        if (inputs.length === 1) return pending.promise;
        if (context(input).tasks.length)
          return call("edit", {
            slideId: null,
            old: "Your talk",
            new: "Fresh request",
          });
        return done;
      },
    },
  });
  try {
    await editTitle(rt.publisher, "Your talk", "Before undo");
    rt.receiveTranscript("Old narration", 1);
    await rt.gate.tick();
    await until(() => inputs.length === 1);
    await rt.undo();
    assert.equal(inputs[0].signal.aborted, true);
    assert.equal(rt.publisher.current.source, blankSlide);
    pending.resolve(
      call("edit", { slideId: null, old: "Before undo", new: "Obsolete" }),
    );
    await rt.gate.tick();
    await rt.settle(1000);
    assert.equal(inputs.length, 1);
    assert.equal(rt.gate.latest!.text, "Old narration");
    rt.pushToEdit("Use a fresh title");
    await rt.settle();
    assert(rt.publisher.current.source.includes("Fresh request"));
    assert.equal(rt.publisher.historyStatus().canRedo, false);
    assert(
      inputs[1].input.some(
        (i) =>
          "role" in i &&
          "content" in i &&
          typeof i.content === "string" &&
          i.content.includes('"control":"undo"'),
      ),
    );
    rt.receiveTranscript("Old narration. A genuinely new point", 2);
    await rt.gate.tick();
    await rt.settle();
    assert.equal(inputs.at(-1)!.role, "fast");
  } finally {
    pending.resolve(done);
    await rt.close();
  }
});

test("undo fences an in-flight render and completes cancelled sibling tool outputs; newer comments survive", async () => {
  const render = deferred<Rendered>();
  let blocked = false;
  const inputs: ModelInput[] = [];
  const rt = await SlideRuntime.create({
    ...options,
    renderer: {
      async render(source) {
        if (source.includes("Obsolete rendering")) {
          blocked = true;
          return render.promise;
        }
        return frame(source);
      },
      async close() {},
    },
    model: {
      async infer(input) {
        inputs.push(input);
        if (inputs.length === 1)
          return {
            output: [
              ...call(
                "edit",
                {
                  slideId: null,
                  old: "Before undo",
                  new: "Obsolete rendering",
                },
                "a",
              ).output,
              ...call(
                "edit",
                {
                  slideId: null,
                  old: "Obsolete rendering",
                  new: "Sibling stale",
                },
                "b",
              ).output,
            ],
          };
        return done;
      },
    },
  });
  try {
    await editTitle(rt.publisher, "Your talk", "Before undo");
    rt.pushToEdit("An old request");
    await until(() => blocked);
    const undo = rt.undo();
    rt.pushToEdit("A new request during restoration");
    rt.receiveTranscript("New speech during restoration", 1);
    await until(() => inputs[0].signal.aborted);
    render.resolve(
      frame(blankSlide.replace("Your talk", "Obsolete rendering")),
    );
    await undo;
    await rt.settle();
    assert.equal(rt.publisher.current.source, blankSlide);
    assert.equal(inputs.length, 2);
    assert.equal(
      context(inputs[1]).tasks[0].task,
      "A new request during restoration",
    );
    const outputs = inputs[1].input.filter(
      (i) => i.type === "function_call_output",
    );
    assert.deepEqual(
      outputs.map((i) => i.call_id),
      ["a", "b"],
    );
    assert(
      outputs.every(
        (i) =>
          typeof i.output === "string" && /rejected|cancelled/.test(i.output),
      ),
    );
    assert.equal(rt.events.filter((e) => e.type === "published").length, 1);
    await rt.gate.tick();
    await rt.settle();
    assert.equal(inputs.at(-1)!.role, "fast");
    assert.equal(
      context(inputs.at(-1)!).speech.text,
      "New speech during restoration",
    );
  } finally {
    render.resolve(frame(blankSlide));
    await rt.close();
  }
});

test("undo during pause aborts held inference without resuming; queued comment runs only after resume", async () => {
  const pending = deferred<ModelResult>();
  const inputs: ModelInput[] = [];
  const rt = await SlideRuntime.create({
    ...options,
    model: {
      async infer(i) {
        inputs.push(i);
        return inputs.length === 1 ? pending.promise : done;
      },
    },
  });
  try {
    await editTitle(rt.publisher, "Your talk", "Changed");
    rt.pushToEdit("Old command");
    await until(() => inputs.length === 1);
    rt.pause();
    pending.resolve(
      call("edit", { slideId: null, old: "Changed", new: "Held" }),
    );
    await delay(5);
    await rt.undo();
    assert.equal(rt.paused, true);
    assert.equal(rt.publisher.current.source, blankSlide);
    rt.pushToEdit("New command");
    await delay(5);
    assert.equal(inputs.length, 1);
    rt.resume();
    await rt.settle();
    assert.equal(context(inputs[1]).tasks[0].task, "New command");
  } finally {
    pending.resolve(done);
    await rt.close();
  }
});

test("undo/redo preserves narration across removed and restored slide identities", async () => {
  const rt = await SlideRuntime.create({
    ...options,
    model: {
      async infer() {
        return done;
      },
    },
  });
  try {
    const first = rt.publisher.selectedId;
    const second = (await rt.nextSlide()).id;
    rt.receiveTranscript("Second-slide narration", 1, second);
    rt.pause();
    await rt.undo();
    assert.equal(rt.publisher.selectedId, first);
    assert.equal(rt.gates.has(second), false);
    await rt.redo();
    assert.equal(rt.publisher.get(second).id, second);
    assert.equal(rt.gates.get(second)!.latest!.text, "Second-slide narration");
    rt.receiveTranscript("Corrected second-slide narration", 2, second);
    assert.throws(
      () => rt.receiveTranscript("Outdated", 1, second),
      /increase/,
    );
    rt.resume();
    await rt.gates.get(second)!.tick();
    await rt.settle();
    assert.equal(rt.gates.get(second)!.lastDispatched!.revision, 2);
  } finally {
    await rt.close();
  }
});

test("history invalidates pending speech and Slow decisions even when providers ignore cancellation", async () => {
  const speech = deferred<"dispatch" | "hold">(),
    slow = deferred<"wake" | "hold">();
  let slowStarted = false,
    inferences = 0;
  const rt = await SlideRuntime.create({
    ...options,
    decider: {
      async evaluate() {
        return speech.promise;
      },
    },
    slowDecider: {
      async evaluate() {
        slowStarted = true;
        return slow.promise;
      },
    },
    model: {
      async infer() {
        inferences++;
        return done;
      },
    },
  });
  try {
    await editTitle(rt.publisher, "Your talk", "Fast publication", "fast");
    await until(() => slowStarted);
    rt.receiveTranscript("Old speech", 1);
    const tick = rt.gate.tick();
    await rt.undo();
    speech.resolve("dispatch");
    slow.resolve("wake");
    await tick;
    await rt.settle(1000);
    assert.equal(inferences, 0);
    assert.equal(rt.publisher.current.source, blankSlide);
  } finally {
    speech.resolve("hold");
    slow.resolve("hold");
    await rt.close();
  }
});

test("undo cancels waiting Slow and private image work without late artifacts or completion messages", async () => {
  const image = deferred<any>();
  let imageStarted = false;
  const client = {
    images: {
      async generate() {
        imageStarted = true;
        return image.promise;
      },
    },
  } as unknown as OpenAI;
  const rt = await SlideRuntime.create({
    ...options,
    client,
    model: {
      async infer(input) {
        if (input.role === "slow") {
          if (
            context(input).statuses.some(
              (s: { role: string }) => s.role === "specialist",
            )
          )
            return done;
          return call("delegate", {
            task: "Make illustration",
            facts: "A tree",
            slideId: null,
          });
        }
        return call("image_generate", {
          prompt: "A tree",
          quality: "low",
          size: "1024x1024",
        });
      },
    },
  });
  try {
    await editTitle(rt.publisher, "Your talk", "Changed");
    rt.pushToEdit("Illustrate this");
    await until(
      () => imageStarted && rt.actors.get("slow")!.state === "waiting",
    );
    await rt.undo();
    const events = rt.events.length;
    image.resolve({
      data: [{ b64_json: Buffer.from("private image").toString("base64") }],
    });
    await rt.settle(1000);
    assert.equal(rt.assets.refs().length, 0);
    assert.equal(
      rt.events.slice(events).filter((e) => e.type === "message_queued").length,
      0,
    );
    assert.equal(rt.publisher.current.source, blankSlide);
  } finally {
    image.resolve({ data: [] });
    await rt.close();
  }
});

test("empty runtime history leaves active work intact; repeated undo/redo requests serialize", async () => {
  const pending = deferred<ModelResult>();
  let signal: AbortSignal | undefined;
  const rt = await SlideRuntime.create({
    ...options,
    model: {
      async infer(i) {
        signal = i.signal;
        return pending.promise;
      },
    },
  });
  try {
    rt.pushToEdit("First request");
    assert.equal((await rt.undo()).outcome, "unchanged");
    assert.equal(signal!.aborted, false);
    pending.resolve(done);
    await rt.settle();
    await editTitle(rt.publisher, "Your talk", "One");
    await editTitle(rt.publisher, "One", "Two");
    await Promise.all([rt.undo(), rt.undo(), rt.redo(), rt.redo()]);
    assert(rt.publisher.current.source.includes("Two"));
    assert.deepEqual(rt.publisher.historyStatus(), {
      canUndo: true,
      canRedo: false,
      undoDepth: 2,
      redoDepth: 0,
    });
    await rt.settle(1000);
  } finally {
    pending.resolve(done);
    await rt.close();
  }
});

test("a removed queued comment is reported obsolete, not applied to the selected slide", async () => {
  let calls = 0;
  const rt = await SlideRuntime.create({
    ...options,
    model: {
      async infer() {
        calls++;
        return done;
      },
    },
  });
  try {
    const first = rt.publisher.selectedId;
    const second = (await rt.nextSlide()).id;
    rt.pause();
    const receipt = rt.pushToEdit("Change this removed slide", second);
    await rt.publisher.mergeSlides(
      [first, second].map((id) =>
        rt.publisher.branch("user", "slow", rt.publisher.get(id).observation),
      ),
      { title: "Merged", source: blankSlide },
      true,
    );
    rt.resume();
    await rt.settle();
    assert.equal(calls, 0);
    assert(
      rt.events.some(
        (e) => e.type === "edit_comment_obsolete" && e.id === receipt.id,
      ),
    );
  } finally {
    await rt.close();
  }
});

test("failed rendering and no-op batches preserve redo; immutable asset frames restore exactly", async () => {
  const rt = await SlideRuntime.create({
    ...options,
    renderer: {
      async render(source) {
        if (source.includes("INVALID")) throw new Error("Invalid render");
        return frame(source);
      },
      async close() {},
    },
    model: {
      async infer() {
        return done;
      },
    },
  });
  try {
    const ref = rt.assets.put(
      "image/svg+xml",
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    );
    await editTitle(rt.publisher, "Your talk", `<img src="${ref}">`);
    const imageFrame = rt.publisher.current;
    await rt.undo();
    assert.equal(
      (await editTitle(rt.publisher, "Your talk", "INVALID")).outcome,
      "rejected",
    );
    await rt.publisher.editMany(
      [
        {
          branch: rt.publisher.branch("slow", "slow", rt.publisher.current),
          edit: { old: "Your talk", new: "Your talk" },
        },
      ],
      "noop",
    );
    assert.equal(rt.publisher.historyStatus().redoDepth, 1);
    await rt.redo();
    assert.equal(rt.publisher.current.source, imageFrame.source);
    assert.deepEqual(rt.publisher.current.screenshot, imageFrame.screenshot);
    assert(rt.assets.refs().includes(ref));
  } finally {
    await rt.close();
  }
});

test("undo invalidates manual split rendering as well as agent edits", async () => {
  const rendering = deferred<Rendered>();
  let started = false;
  const p = new Publisher({
    async render(source) {
      if (source.includes("Split candidate")) {
        started = true;
        return rendering.promise;
      }
      return frame(source);
    },
    async close() {},
  });
  try {
    await p.initialize(blankSlide);
    await editTitle(p, "Your talk", "Changed");
    p.setPaused(true);
    const split = p.split(
      p.branch("user", "slow", p.current),
      [
        {
          title: "First",
          source: blankSlide.replace("Your talk", "Split candidate"),
        },
        { title: "Second", source: blankSlide },
      ],
      true,
    );
    await until(() => started);
    const undo = p.restoreHistory("undo");
    rendering.resolve(frame(blankSlide));
    assert.equal((await split).outcome, "rejected");
    assert.equal((await undo).outcome, "restored");
    assert.equal(p.list().length, 1);
    assert.equal(p.current.source, blankSlide);
    assert.equal(p.paused, true);
    await p.restoreHistory("redo");
    assert(p.current.source.includes("Changed"));
  } finally {
    rendering.resolve(frame(blankSlide));
    await p.close();
  }
});
