import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { SlideRuntime } from "../src/runtime.js";
import type { ModelInput, ModelResult, Observation } from "../src/types.js";
const rendered = {
  screenshot: Buffer.from("png"),
  geometry: [],
  diagnostics: [],
};
const renderer = {
  async render() {
    return rendered;
  },
  async close() {},
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
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
const done: ModelResult = { output: [] };
const until = async (check: () => boolean) => {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await delay(5);
  }
  throw new Error("Condition not reached");
};
test("Fast coalesces speech while busy; passive speech never wakes Slow; same session never overlaps", async () => {
  const first = deferred<ModelResult>();
  const calls: ModelInput[] = [];
  let active = 0,
    max = 0;
  const rt = await SlideRuntime.create({
    renderer,
    autoTick: false,
    slowDecider: {
      async evaluate() {
        return "wake";
      },
    },
    decider: {
      async evaluate() {
        return "dispatch";
      },
    },
    model: {
      async infer(input) {
        calls.push(input);
        active++;
        max = Math.max(max, active);
        const result = calls.length === 1 ? await first.promise : done;
        active--;
        return result;
      },
    },
  });
  try {
    rt.receiveTranscript("one", 1);
    await rt.gate.tick();
    await until(() => calls.length === 1);
    rt.receiveTranscript("one two", 2);
    await rt.gate.tick();
    rt.receiveTranscript("one two three", 3);
    await rt.gate.tick();
    assert.equal(calls.length, 1);
    assert.equal(rt.statuses().find((a) => a.id === "slow")?.state, "idle");
    first.resolve(done);
    await rt.settle();
    assert.equal(calls.length, 2);
    assert.equal(max, 1);
    assert(JSON.stringify(calls[1].input).includes("one two three"));
    assert(!JSON.stringify(calls[0].input).includes("one two three"));
    assert(calls.every((c) => c.role === "fast"));
  } finally {
    first.resolve(done);
    await rt.close();
  }
});
test("Decision-approved Fast publication wakes Slow; active Slow gets one gated followup, never for its own", async () => {
  const slowFirst = deferred<ModelResult>();
  let slowCalls = 0;
  const rt = await SlideRuntime.create({
    renderer,
    autoTick: false,
    slowDecider: {
      async evaluate() {
        return "wake";
      },
    },
    decider: {
      async evaluate() {
        return "hold";
      },
    },
    model: {
      async infer(input) {
        if (input.role === "slow") {
          slowCalls++;
          if (slowCalls === 1) return slowFirst.promise;
        }
        return done;
      },
    },
  });
  try {
    const p = rt.publisher;
    await p.edit(p.branch("fast", "fast", p.current), "one", {
      old: "Your talk",
      new: "First title",
    });
    await until(() => slowCalls === 1);
    await p.edit(p.branch("fast", "fast", p.current), "two", {
      old: "First title",
      new: "Second title",
    });
    await p.edit(p.branch("fast", "fast", p.current), "three", {
      old: "Second title",
      new: "Third title",
    });
    assert.equal(slowCalls, 1);
    slowFirst.resolve(done);
    await rt.settle();
    assert.equal(slowCalls, 2);
    await p.edit(p.branch("slow", "slow", p.current), "own", {
      old: "Third title",
      new: "Refined title",
    });
    await delay(10);
    assert.equal(slowCalls, 2);
  } finally {
    slowFirst.resolve(done);
    await rt.close();
  }
});
test("mailboxes queue without waking and followups wake once and retain history", async () => {
  const pending = deferred<ModelResult>();
  let calls = 0;
  const rt = await SlideRuntime.create({
    renderer,
    autoTick: false,
    slowDecider: {
      async evaluate() {
        return "wake";
      },
    },
    decider: {
      async evaluate() {
        return "hold";
      },
    },
    model: {
      async infer() {
        calls++;
        return calls === 1 ? pending.promise : done;
      },
    },
  });
  try {
    rt.sendMessage({
      id: "m",
      from: "fast",
      to: "slow",
      text: "Consider hierarchy",
    });
    await delay(5);
    assert.equal(calls, 0);
    rt.followupTask("slow", { task: "Refine", facts: "" });
    await until(() => calls === 1);
    rt.followupTask("slow", { task: "Also examine spacing", facts: "" });
    assert.equal(calls, 1);
    pending.resolve(done);
    await rt.settle();
    assert.equal(calls, 2);
    assert(rt.actors.get("slow")!.history.entries.length >= 4);
  } finally {
    pending.resolve(done);
    await rt.close();
  }
});
test("Slow waits for private specialist result; artifacts do not publish themselves", async () => {
  let slowCalls = 0,
    specialistCalls = 0;
  const child = deferred<ModelResult>();
  const rt = await SlideRuntime.create({
    renderer,
    autoTick: false,
    slowDecider: {
      async evaluate() {
        return "wake";
      },
    },
    decider: {
      async evaluate() {
        return "hold";
      },
    },
    model: {
      async infer(input) {
        if (input.role === "slow") {
          slowCalls++;
          if (slowCalls === 1)
            return call("delegate", {
              task: "Make a diagram",
              facts: "Reserve -> collect -> pickup",
            });
          return done;
        }
        specialistCalls++;
        if (specialistCalls === 1) return child.promise;
        return done;
      },
    },
  });
  try {
    rt.followupTask("slow", { task: "Refine", facts: "" });
    await until(() =>
      rt.statuses().some((a) => a.id === "slow" && a.state === "waiting"),
    );
    child.resolve(
      call("save_artifact", {
        mediaType: "image/svg+xml",
        content: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      }),
    );
    await rt.settle();
    assert.equal(rt.assets.refs().length, 1);
    assert.equal(rt.publisher.undo.length, 0);
    assert.equal(slowCalls, 3);
    assert(
      JSON.stringify(rt.actors.get("slow")!.history.entries).includes(
        "image/svg+xml",
      ),
    );
  } finally {
    child.resolve(done);
    await rt.close();
  }
});
test("delegate enforces two active specialists and shutdown releases waiting parent", async () => {
  let slow = 0;
  const child = deferred<ModelResult>();
  const rt = await SlideRuntime.create({
    renderer,
    autoTick: false,
    slowDecider: {
      async evaluate() {
        return "wake";
      },
    },
    decider: {
      async evaluate() {
        return "hold";
      },
    },
    model: {
      async infer(input) {
        if (input.role === "slow") {
          if (++slow <= 3)
            return call(
              "delegate",
              { task: `task ${slow}`, facts: "" },
              `d${slow}`,
            );
          return done;
        }
        return Promise.race([
          child.promise,
          new Promise<ModelResult>((resolve) =>
            input.signal.addEventListener("abort", () => resolve(done), {
              once: true,
            }),
          ),
        ]);
      },
    },
  });
  rt.followupTask("slow", { task: "Prepare assets", facts: "" });
  await until(() => rt.statuses().some((a) => a.state === "waiting"));
  assert.equal(rt.statuses().filter((a) => a.role === "specialist").length, 2);
  assert(
    JSON.stringify(rt.actors.get("slow")!.history.entries).includes(
      "Two specialists already active",
    ),
  );
  await rt.close();
  child.resolve(done);
});
test("recognition corrections do not automatically mutate an already displayed claim", async () => {
  const pending = deferred<ModelResult>();
  let calls = 0;
  const rt = await SlideRuntime.create({
    renderer,
    autoTick: false,
    slowDecider: {
      async evaluate() {
        return "wake";
      },
    },
    decider: {
      async evaluate() {
        return "dispatch";
      },
    },
    model: {
      async infer() {
        calls++;
        return pending.promise;
      },
    },
  });
  try {
    const p = rt.publisher;
    await p.edit(p.branch("fast", "fast", p.current), "seed", {
      old: "Your talk",
      new: "60 students",
    });
    await until(() => calls === 1); // Slow is reasoning about the publication.
    rt.receiveTranscript("sixty students", 1);
    await rt.gate.tick();
    rt.receiveTranscript("forty-eight students", 2);
    await rt.gate.tick();
    assert(p.current.source.includes("60 students"));
    assert.equal(rt.gate.latest!.corrections.length, 1);
  } finally {
    pending.resolve(done);
    await rt.close();
  }
});
test("failed inference releases actor and explicit followup can recover", async () => {
  let calls = 0;
  const rt = await SlideRuntime.create({
    renderer,
    autoTick: false,
    slowDecider: {
      async evaluate() {
        return "wake";
      },
    },
    decider: {
      async evaluate() {
        return "hold";
      },
    },
    model: {
      async infer() {
        if (++calls === 1) throw new Error("provider unavailable");
        return done;
      },
    },
  });
  try {
    rt.followupTask("slow", { task: "Refine", facts: "" });
    await until(() => rt.statuses().some((a) => a.state === "failed"));
    rt.followupTask("slow", {
      task: "Try again with current context",
      facts: "",
    });
    await rt.settle();
    assert.equal(calls, 2);
    assert(rt.statuses().every((a) => a.state === "idle"));
  } finally {
    await rt.close();
  }
});
test("only Slow introduces private artifacts; Fast may reuse them after publication", async () => {
  const rt = await SlideRuntime.create({
    renderer,
    autoTick: false,
    slowDecider: {
      async evaluate() {
        return "wake";
      },
    },
    decider: {
      async evaluate() {
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
    const ref = rt.assets.put("image/svg+xml", Buffer.from("<svg/>"));
    const edit = {
      old: "<h1>Your talk</h1>",
      new: `<h1>Your talk</h1><img src="${ref}">`,
    };
    const p = rt.publisher;
    assert.equal(
      (await p.edit(p.branch("fast", "fast", p.current), "private", edit))
        .outcome,
      "rejected",
    );
    assert.equal(
      (await p.edit(p.branch("slow", "slow", p.current), "integrate", edit))
        .outcome,
      "published",
    );
    assert.equal(
      (
        await p.edit(p.branch("fast", "fast", p.current), "reuse", {
          old: "Your talk",
          new: "Library results",
        })
      ).outcome,
      "published",
    );
    await rt.settle();
  } finally {
    await rt.close();
  }
});

test("fresh dispatched speech renews the work budget during a continuous Fast activation", async () => {
  const turns: ReturnType<typeof deferred<ModelResult>>[] = [];
  const rt = await SlideRuntime.create({
    renderer,
    autoTick: false,
    maxSteps: 2,
    slowDecider: {
      async evaluate() {
        return "wake";
      },
    },
    decider: {
      async evaluate() {
        return "dispatch";
      },
    },
    model: {
      async infer() {
        const turn = deferred<ModelResult>();
        turns.push(turn);
        return turn.promise;
      },
    },
  });
  try {
    rt.receiveTranscript("word1", 1);
    await rt.gate.tick();
    await until(() => turns.length === 1);
    for (let revision = 2; revision <= 5; revision++) {
      rt.receiveTranscript(
        Array.from({ length: revision }, (_, i) => `word${i + 1}`).join(" "),
        revision,
      );
      await rt.gate.tick();
      turns[revision - 2].resolve(done);
      await until(
        () =>
          turns.length === revision ||
          rt.statuses().some((a) => a.state === "failed"),
      );
      assert.equal(rt.actors.get("fast")!.state, "running");
    }
    turns.at(-1)!.resolve(done);
    await rt.settle();
    assert.equal(turns.length, 5);
  } finally {
    for (const turn of turns) turn.resolve(done);
    await rt.close();
  }
});

test("Slow consumes a required child result that completed during its final inference", async () => {
  const parentFinishing = deferred<ModelResult>(),
    child = deferred<ModelResult>();
  let slowCalls = 0;
  const rt = await SlideRuntime.create({
    renderer,
    autoTick: false,
    slowDecider: {
      async evaluate() {
        return "wake";
      },
    },
    decider: {
      async evaluate() {
        return "hold";
      },
    },
    model: {
      async infer(input) {
        if (input.role === "slow") {
          slowCalls++;
          if (slowCalls === 1)
            return call("delegate", { task: "Check the diagram", facts: "" });
          if (slowCalls === 2) return parentFinishing.promise;
          return done;
        }
        return child.promise;
      },
    },
  });
  try {
    rt.followupTask("slow", { task: "Refine", facts: "" });
    await until(() => slowCalls === 2);
    child.resolve(done);
    await until(() =>
      rt.statuses().some((a) => a.role === "specialist" && a.state === "idle"),
    );
    parentFinishing.resolve(done);
    await rt.settle();
    assert.equal(slowCalls, 3);
    const history = JSON.stringify(rt.actors.get("slow")!.history.entries);
    assert(history.includes("Specialist completed"));
  } finally {
    parentFinishing.resolve(done);
    child.resolve(done);
    await rt.close();
  }
});

test("a specialist failure observed and handled by Slow does not fail the completed session", async () => {
  let slowCalls = 0;
  const rt = await SlideRuntime.create({
    renderer,
    autoTick: false,
    slowDecider: {
      async evaluate() {
        return "wake";
      },
    },
    decider: {
      async evaluate() {
        return "hold";
      },
    },
    model: {
      async infer(input) {
        if (input.role === "slow") {
          if (++slowCalls === 1)
            return call("delegate", {
              task: "Optional illustration",
              facts: "",
            });
          return done;
        }
        throw new Error("Image provider unavailable");
      },
    },
  });
  try {
    rt.followupTask("slow", {
      task: "Refine; omit illustration if unavailable",
      facts: "",
    });
    await until(() => rt.actors.get("slow")!.state === "idle");
    await rt.settle();
    assert(
      JSON.stringify(rt.actors.get("slow")!.history.entries).includes(
        "Specialist failed",
      ),
    );
  } finally {
    await rt.close();
  }
});

test("settle waits for an active parent to observe a child failure instead of rejecting early", async () => {
  const child = deferred<ModelResult>(),
    parent = deferred<ModelResult>();
  let slowCalls = 0;
  const rt = await SlideRuntime.create({
    renderer,
    autoTick: false,
    slowDecider: {
      async evaluate() {
        return "wake";
      },
    },
    decider: {
      async evaluate() {
        return "hold";
      },
    },
    model: {
      async infer(input) {
        if (input.role === "slow") {
          if (++slowCalls === 1)
            return call("delegate", { task: "Diagram", facts: "" });
          if (slowCalls === 2) return parent.promise;
          return done;
        }
        await child.promise;
        throw new Error("Temporary specialist failure");
      },
    },
  });
  try {
    rt.followupTask("slow", { task: "Refine", facts: "" });
    await until(() => slowCalls === 2);
    const settling = rt.settle();
    let rejected = false;
    void settling.catch(() => {
      rejected = true;
    });
    child.resolve(done);
    await delay(45);
    assert.equal(rejected, false);
    parent.resolve(done);
    await settling;
    assert.equal(slowCalls, 3);
  } finally {
    child.resolve(done);
    parent.resolve(done);
    await rt.close();
  }
});

test("work without fresh input still obeys the configured step bound", async () => {
  let calls = 0;
  const rt = await SlideRuntime.create({
    renderer,
    autoTick: false,
    maxSteps: 2,
    slowDecider: {
      async evaluate() {
        return "wake";
      },
    },
    decider: {
      async evaluate() {
        return "hold";
      },
    },
    model: {
      async infer() {
        return call("view_slide", {}, `view${++calls}`);
      },
    },
  });
  try {
    rt.followupTask("fast", { task: "Inspect", facts: "" });
    await assert.rejects(rt.settle(), /step limit/);
    assert.equal(calls, 2);
  } finally {
    await rt.close();
  }
});
