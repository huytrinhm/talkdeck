import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import type OpenAI from "openai";
import { Publisher } from "../../src/orchestration/publisher.js";
import { SlideRuntime } from "../../src/orchestration/runtime.js";
import type { ModelInput, ModelResult, Renderer } from "../../src/orchestration/types.js";
const rendered = {
  screenshot: Buffer.from("png"),
  geometry: [],
  diagnostics: [],
};
const renderer: Renderer = {
  async render() {
    return rendered;
  },
  async close() {},
};
const done: ModelResult = { output: [] };
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { resolve, promise };
};
const until = async (f: () => boolean) => {
  for (let i = 0; i < 150; i++) {
    if (f()) return;
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

test("navigation preserves stable targets and persistent Fast history; pending speech is coalesced per slide", async () => {
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
    const first = rt.publisher.selectedId;
    rt.receiveTranscript("First topic", 1, first);
    await rt.gate.tick();
    await until(() => inputs.length === 1);
    const second = (await rt.nextSlide()).id;
    rt.receiveTranscript("Second topic", 1, second);
    await rt.gate.tick();
    rt.receiveTranscript("Second topic expanded", 2, second);
    await rt.gate.tick();
    await rt.selectSlide(first);
    rt.receiveTranscript("First topic clarified", 2, first);
    await rt.gate.tick();
    await rt.selectSlide(second);
    pending.resolve(call("edit", { old: "Your talk", new: "First topic" }));
    await rt.settle();
    assert(rt.publisher.get(first).observation.source.includes("First topic"));
    assert(rt.publisher.get(second).observation.source.includes("Your talk"));
    assert.equal(rt.publisher.selectedId, second);
    assert(
      inputs.some((i) => context(i).speech?.text === "Second topic expanded"),
    );
    assert(
      inputs.some((i) => context(i).speech?.text === "First topic clarified"),
    );
    assert(inputs[1].input.length > inputs[0].input.length);
    assert.equal(rt.actors.size, 2);
  } finally {
    pending.resolve(done);
    await rt.close();
  }
});

test("pause holds completed inference, permits navigation, then resumes original work exactly once", async () => {
  const pending = deferred<ModelResult>();
  let calls = 0;
  const rt = await SlideRuntime.create({
    ...options,
    model: {
      async infer() {
        return ++calls === 1 ? pending.promise : done;
      },
    },
  });
  try {
    const first = rt.publisher.selectedId;
    rt.followupTask("fast", { task: "Draft", facts: "", slideId: first });
    await until(() => calls === 1);
    rt.pause();
    const second = (await rt.nextSlide()).id;
    pending.resolve(call("edit", { old: "Your talk", new: "Paused result" }));
    await delay(20);
    assert.equal(calls, 1);
    assert(
      !rt.publisher.get(first).observation.source.includes("Paused result"),
    );
    rt.resume();
    rt.resume();
    await rt.settle();
    assert(
      rt.publisher.get(first).observation.source.includes("Paused result"),
    );
    assert.equal(rt.publisher.selectedId, second);
    assert.equal(calls, 2);
  } finally {
    pending.resolve(done);
    await rt.close();
  }
});

test("pause during render rejects candidate even if resumed before rendering returns", async () => {
  const pending = deferred<typeof rendered>();
  let renders = 0;
  const p = new Publisher({
    async render() {
      return ++renders === 2 ? pending.promise : rendered;
    },
    async close() {},
  });
  await p.initialize("before");
  const edit = p.edit(p.branch("fast", "fast", p.current), "e", {
    old: "before",
    new: "after",
  });
  await until(() => renders === 2);
  p.setPaused(true);
  p.setPaused(false);
  pending.resolve(rendered);
  assert.equal((await edit).outcome, "rejected");
  assert.equal(p.current.source, "before");
  assert.equal(p.undo.length, 0);
  await p.close();
});

test("paused speech gates retain latest narration and explicit tasks stay pending until resume", async () => {
  let calls = 0,
    decisions = 0;
  const rt = await SlideRuntime.create({
    ...options,
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
    rt.pause();
    rt.receiveTranscript("Held", 1);
    await rt.gate.tick();
    rt.receiveTranscript("Held with details", 2);
    await rt.gate.tick();
    rt.followupTask("slow", { task: "Refine", facts: "" });
    assert.equal(decisions, 0);
    assert.equal(calls, 0);
    rt.resume();
    await rt.gate.tick();
    await rt.settle();
    assert.equal(decisions, 1);
    assert.equal(calls, 2);
  } finally {
    await rt.close();
  }
});

test("Slow corrects a past slide using later slide context without navigating the user", async () => {
  let first = "",
    second = "",
    calls = 0;
  const rt = await SlideRuntime.create({
    ...options,
    model: {
      async infer(input) {
        const c = context(input);
        assert.equal(c.deck.slides.length, 2);
        if (++calls === 1) {
          assert(
            c.deck.slides
              .find((s: any) => s.id === second)
              .narration.text.includes("4.4"),
          );
          return call("edit", { slideId: first, old: "4.6", new: "4.4" });
        }
        return done;
      },
    },
  });
  try {
    first = rt.publisher.selectedId;
    await rt.publisher.edit(
      rt.publisher.branch("slow", "slow", rt.publisher.current),
      "seed",
      { old: "Your talk", new: "Satisfaction 4.6" },
    );
    second = (await rt.nextSlide()).id;
    rt.receiveTranscript(
      "Correction to the previous slide: satisfaction was 4.4",
      1,
      second,
    );
    rt.followupTask("slow", {
      task: "Reconcile the corrected number on the previous slide",
      facts: "",
      slideId: second,
    });
    await rt.settle();
    assert(rt.publisher.get(first).observation.source.includes("4.4"));
    assert.equal(rt.publisher.selectedId, second);
  } finally {
    await rt.close();
  }
});

test("atomic multi-slide edit publishes no intermediate deck and rolls back all candidates on validation failure", async () => {
  const p = new Publisher({
    async render(source) {
      if (source.includes("INVALID")) throw new Error("bad component");
      return rendered;
    },
    async close() {},
  });
  await p.initialize("one");
  const a = p.selectedId;
  const b = (await p.next()).id;
  const branches = () =>
    [a, b].map((id) => p.branch("slow", "slow", p.get(id).observation));
  const [aa, bb] = branches();
  let notices = 0;
  p.onPublish = () => {
    notices++;
    assert.equal(p.get(a).observation.source, "ONE");
    assert.equal(p.get(b).observation.source, "TWO");
  };
  const before = p.deckUndo.length;
  assert.equal(
    (
      await p.editMany(
        [
          { branch: aa, edit: { old: aa.source, new: "ONE" } },
          { branch: bb, edit: { old: bb.source, new: "TWO" } },
        ],
        "batch",
      )
    ).outcome,
    "published",
  );
  assert.equal(notices, 2);
  assert.equal(p.deckUndo.length, before + 1);
  const [a2, b2] = branches();
  assert.equal(
    (
      await p.editMany(
        [
          { branch: a2, edit: { old: "ONE", new: "valid" } },
          { branch: b2, edit: { old: "TWO", new: "INVALID" } },
        ],
        "bad",
      )
    ).outcome,
    "rejected",
  );
  assert.equal(p.get(a).observation.source, "ONE");
  assert.equal(p.get(b).observation.source, "TWO");
  await p.close();
});

test("split retains first ID; merge maps selection to survivor; deleted-slide edits never retarget", async () => {
  const p = new Publisher(renderer);
  await p.initialize("whole");
  const first = p.selectedId;
  const split = await p.split(p.branch("slow", "slow", p.current), [
    { title: "A", source: "part A" },
    { title: "B", source: "part B" },
  ]);
  assert.equal(split.outcome, "published");
  assert.equal(split.slideIds[0], first);
  assert.equal(p.selectedId, first);
  const second = split.slideIds[1];
  await p.navigate(second);
  const stale = p.branch("fast", "fast", p.current);
  const merged = await p.mergeSlides(
    [first, second].map((id) =>
      p.branch("slow", "slow", p.get(id).observation),
    ),
    { title: "Together", source: "merged" },
  );
  assert.equal(merged.outcome, "published");
  assert.equal(p.selectedId, first);
  assert.equal(p.list().length, 1);
  assert.equal(
    (await p.edit(stale, "late", { old: "part B", new: "WRONG" })).outcome,
    "rejected",
  );
  assert.equal(p.current.source, "merged");
  await p.close();
});

test("stale structural proposals reject the whole operation; manual structure remains available while paused", async () => {
  const p = new Publisher(renderer);
  await p.initialize("original");
  const stale = p.branch("slow", "slow", p.current);
  await p.edit(p.branch("fast", "fast", p.current), "f", {
    old: "original",
    new: "new facts",
  });
  assert.equal(
    (
      await p.split(stale, [
        { title: "A", source: "a" },
        { title: "B", source: "b" },
      ])
    ).outcome,
    "rejected",
  );
  assert.equal(p.list().length, 1);
  p.setPaused(true);
  const fresh = p.branch("slow", "slow", p.current);
  assert.equal(
    (
      await p.split(
        fresh,
        [
          { title: "A", source: "a" },
          { title: "B", source: "b" },
        ],
        true,
      )
    ).outcome,
    "published",
  );
  await p.close();
});

test("specialist Flare image and component remain private, survive navigation, and integrate only through Slow", async () => {
  const image = deferred<{ data: { b64_json: string }[] }>();
  const requests: any[] = [];
  let slowCalls = 0,
    childCalls = 0;
  let first = "";
  const client = {
    images: {
      async generate(args: any) {
        requests.push(args);
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
          slowCalls++;
          if (slowCalls === 1)
            return call("delegate", {
              task: "Generate a library illustration and a reusable component",
              facts: "No text in image",
              slideId: first,
            });
          const refs = rt.assets.refs();
          if (refs.length === 2 && slowCalls > 2)
            return slowCalls === 4
              ? call("edit", {
                  slideId: first,
                  old: "Your talk",
                  new: `Illustrated <img src="${refs[0]}">`,
                })
              : done;
          return done;
        }
        childCalls++;
        if (childCalls === 1) {
          assert(
            input.input.some(
              (i) =>
                "content" in i &&
                Array.isArray(i.content) &&
                i.content.some(
                  (p: { type: string }) => p.type === "input_image",
                ),
            ),
          );
          return call("image_generate", {
            prompt: "Library pickup lockers, no words",
            quality: "low",
            size: "1536x1024",
          });
        }
        if (childCalls === 2)
          return call("save_artifact", {
            mediaType: "text/html",
            content:
              "<library-metric>48</library-metric><script>customElements.define('library-metric',class extends HTMLElement {})</script>",
          });
        return done;
      },
    },
  });
  try {
    first = rt.publisher.selectedId;
    rt.followupTask("slow", {
      task: "Prepare illustration and component",
      facts: "",
      slideId: first,
    });
    await until(() => requests.length === 1);
    const second = (await rt.nextSlide()).id;
    rt.pause();
    image.resolve({
      data: [{ b64_json: Buffer.from("image").toString("base64") }],
    });
    await delay(20);
    assert.equal(rt.assets.refs().length, 0);
    rt.resume();
    await rt.settle();
    assert.equal(requests[0].model, "gpt-image-2.5-flare");
    assert.equal(requests[0].quality, "low");
    assert.equal(rt.assets.refs().length, 2);
    assert.equal(rt.publisher.selectedId, second);
    // If no integration was useful in that turn, an explicit parent task can consume saved artifacts.
    if (!rt.publisher.get(first).observation.source.includes("Illustrated")) {
      rt.followupTask("slow", {
        task: "Integrate the completed illustration",
        facts: "",
        slideId: first,
      });
      await rt.settle();
    }
    assert(rt.publisher.get(first).observation.source.includes("Illustrated"));
  } finally {
    image.resolve({ data: [] });
    await rt.close();
  }
});

test("Fast stops removed-slide work after rejection rather than replaying narration into the survivor", async () => {
  const pending = deferred<ModelResult>();
  let calls = 0;
  const rt = await SlideRuntime.create({
    ...options,
    model: {
      async infer() {
        calls++;
        return calls === 1
          ? pending.promise
          : call("edit", { old: "Your talk", new: "MISROUTED" });
      },
    },
  });
  try {
    const first = rt.publisher.selectedId,
      second = (await rt.nextSlide()).id;
    rt.receiveTranscript("Second slide narration", 1, second);
    await rt.gate.tick();
    await until(() => calls === 1);
    const merged = await rt.publisher.mergeSlides(
      [first, second].map((id) =>
        rt.publisher.branch("slow", "slow", rt.publisher.get(id).observation),
      ),
      { title: "Combined", source: "<main>Combined facts</main>" },
      true,
    );
    assert.equal(merged.outcome, "published");
    pending.resolve(call("edit", { old: "Your talk", new: "LATE" }));
    await rt.settle();
    assert.equal(calls, 1);
    assert.equal(rt.publisher.current.source, "<main>Combined facts</main>");
    assert(rt.events.some((e) => e.type === "work_obsolete"));
    assert.equal(rt.deckContext().archivedNarration[0].slideId, second);
  } finally {
    pending.resolve(done);
    await rt.close();
  }
});

test("late transcription stays attached to the captured slide after navigation", async () => {
  const seen: ModelInput[] = [];
  const rt = await SlideRuntime.create({
    ...options,
    model: {
      async infer(i) {
        seen.push(i);
        return done;
      },
    },
  });
  try {
    const original = rt.publisher.selectedId;
    const selected = (await rt.nextSlide()).id;
    rt.receiveTranscript(
      "Final recognition for the slide just left",
      1,
      original,
    );
    await rt.gates.get(original)!.tick();
    await rt.settle();
    assert.equal(context(seen[0]).workingSlideId, original);
    assert.equal(rt.publisher.selectedId, selected);
    assert.equal(rt.gates.get(selected)!.latest, null);
  } finally {
    await rt.close();
  }
});

test("settle does not report success for explicit work queued behind pause", async () => {
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
    rt.pause();
    rt.followupTask("slow", { task: "Queued refinement", facts: "" });
    let settled = false;
    const pending = rt.settle().then(() => {
      settled = true;
    });
    await delay(30);
    assert.equal(settled, false);
    rt.resume();
    await pending;
    assert.equal(calls, 1);
  } finally {
    await rt.close();
  }
});

test("finish ends an activation but fresh speech continues the same persistent session", async () => {
  let calls = 0;
  const rt = await SlideRuntime.create({
    ...options,
    model: {
      async infer() {
        calls++;
        return call("finish", {});
      },
    },
  });
  try {
    rt.receiveTranscript("First idea", 1);
    await rt.gate.tick();
    await rt.settle();
    assert.equal(calls, 1);
    rt.receiveTranscript("First idea plus a second", 2);
    await rt.gate.tick();
    await rt.settle();
    assert.equal(calls, 2);
    assert.equal(
      rt.actors
        .get("fast")!
        .history.entries.filter(
          (e) =>
            e.kind === "item" &&
            "type" in e.item &&
            e.item.type === "function_call_output",
        ).length,
      2,
    );
  } finally {
    await rt.close();
  }
});

test("pause invalidates pending Slow eligibility and resume reevaluates without a duplicate wake", async () => {
  const first = deferred<"wake" | "hold">();
  let decisions = 0,
    calls = 0;
  const rt = await SlideRuntime.create({
    ...options,
    slowDecider: {
      async evaluate() {
        decisions++;
        return decisions === 1 ? first.promise : "hold";
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
    await rt.publisher.edit(
      rt.publisher.branch("fast", "fast", rt.publisher.current),
      "first",
      { old: "Your talk", new: "Draft" },
    );
    await until(() => decisions === 1);
    rt.pause();
    rt.resume();
    first.resolve("wake");
    await rt.settle();
    assert.equal(decisions, 2);
    assert.equal(calls, 0);
    assert(!rt.events.some((e) => e.type === "slow_decision_error"));
  } finally {
    first.resolve("hold");
    await rt.close();
  }
});

test("pause at the queued eligibility boundary prevents issuing a new Decision API request", async () => {
  let decisions = 0,
    armed = true;
  const rt = await SlideRuntime.create({
    ...options,
    slowDecider: {
      async evaluate() {
        decisions++;
        return "hold";
      },
    },
    model: {
      async infer() {
        return done;
      },
    },
  });
  try {
    rt.subscribe((e) => {
      if (e.type === "slow_decision_started" && armed) {
        armed = false;
        rt.pause();
      }
    });
    await rt.publisher.edit(
      rt.publisher.branch("fast", "fast", rt.publisher.current),
      "boundary",
      { old: "Your talk", new: "New idea" },
    );
    await delay(20);
    assert.equal(rt.paused, true);
    assert.equal(decisions, 0);
    rt.resume();
    await rt.settle();
    assert.equal(decisions, 1);
  } finally {
    await rt.close();
  }
});

test("Slow tool loop can split, atomically edit both parts, then merge without changing selection", async () => {
  let calls = 0;
  const rt = await SlideRuntime.create({
    ...options,
    model: {
      async infer(input) {
        const deck = context(input).deck;
        calls++;
        if (calls === 1)
          return call("split_slide", {
            slideId: deck.slides[0].id,
            parts: [
              { title: "First", source: "<main>A</main>" },
              { title: "Second", source: "<main>B</main>" },
            ],
          });
        if (calls === 2) {
          assert.equal(deck.slides.length, 2);
          return call("edit_slides", {
            edits: [
              { slideId: deck.slides[0].id, old: "A", new: "Updated A" },
              { slideId: deck.slides[1].id, old: "B", new: "Updated B" },
            ],
          });
        }
        if (calls === 3) {
          assert(deck.slides.every((s: any) => s.source.includes("Updated")));
          return call("merge_slides", {
            slideIds: deck.slides.map((s: any) => s.id),
            title: "Combined",
            source: "<main>Updated A and Updated B</main>",
          });
        }
        return call("finish", {});
      },
    },
  });
  try {
    const selected = rt.publisher.selectedId;
    rt.followupTask("slow", { task: "Restructure the content", facts: "" });
    await rt.settle();
    assert.equal(calls, 4);
    assert.equal(rt.publisher.selectedId, selected);
    assert.equal(rt.publisher.list().length, 1);
    assert.equal(
      rt.publisher.current.source,
      "<main>Updated A and Updated B</main>",
    );
    assert.equal(rt.publisher.deckUndo.length, 3);
  } finally {
    await rt.close();
  }
});
