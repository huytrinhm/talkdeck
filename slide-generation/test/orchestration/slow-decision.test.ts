import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import OpenAI from "openai";
import { SlideRuntime } from "../../src/orchestration/runtime.js";
import { OpenAISlowDecider } from "../../src/orchestration/openai.js";
import type { SlowDecisionInput, ModelResult, Role } from "../../src/orchestration/types.js";
const done: ModelResult = { output: [] };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const until = async (f: () => boolean) => {
  for (let i = 0; i < 100; i++) {
    if (f()) return;
    await delay(5);
  }
  throw new Error("Condition not reached");
};
const renderer = {
  async render() {
    return { screenshot: Buffer.from("png"), geometry: [], diagnostics: [] };
  },
  async close() {},
};
const publish = async (
  rt: SlideRuntime,
  title: string,
  role: Role = "fast",
) => {
  const p = rt.publisher;
  const old = p.current.source.match(/<h1>.*?<\/h1>/)![0];
  return p.edit(p.branch(role, role, p.current), title, {
    old,
    new: `<h1>${title}</h1>`,
  });
};
test("Slow HOLD keeps idle; only new Fast publications reevaluate, not passive speech or mail", async () => {
  let decisions = 0,
    slowCalls = 0;
  const rt = await SlideRuntime.create({
    renderer,
    autoTick: false,
    decider: {
      async evaluate() {
        return "dispatch";
      },
    },
    slowDecider: {
      async evaluate() {
        decisions++;
        return "hold";
      },
    },
    model: {
      async infer(i) {
        if (i.role === "slow") slowCalls++;
        return done;
      },
    },
  });
  try {
    rt.receiveTranscript("A topic", 1);
    await rt.gate.tick();
    await rt.settle();
    assert.equal(decisions, 0);
    await publish(rt, "First");
    await rt.settle();
    assert.equal(decisions, 1);
    assert.equal(slowCalls, 0);
    rt.sendMessage({
      id: "m",
      from: "fast",
      to: "slow",
      text: "Consider the title",
    });
    rt.receiveTranscript("A topic with details", 2);
    await rt.gate.tick();
    await publish(rt, "Slow own change", "slow");
    await rt.settle();
    await delay(20);
    assert.equal(decisions, 1);
    await publish(rt, "Second Fast change");
    await rt.settle();
    assert.equal(decisions, 2);
    assert.equal(slowCalls, 0);
  } finally {
    await rt.close();
  }
});
test("Slow decisions coalesce pending publications and discard obsolete wake results", async () => {
  const first = deferred<"wake" | "hold">();
  const inputs: SlowDecisionInput[] = [];
  let slowCalls = 0,
    active = 0,
    max = 0;
  const rt = await SlideRuntime.create({
    renderer,
    autoTick: false,
    decider: {
      async evaluate() {
        return "hold";
      },
    },
    slowDecider: {
      async evaluate(input) {
        inputs.push(input);
        active++;
        max = Math.max(max, active);
        const answer = inputs.length === 1 ? await first.promise : "hold";
        active--;
        return answer;
      },
    },
    model: {
      async infer() {
        slowCalls++;
        return done;
      },
    },
  });
  try {
    await publish(rt, "First");
    await until(() => inputs.length === 1);
    let settled = false;
    const settling = rt.settle().then(() => {
      settled = true;
    });
    await publish(rt, "Second");
    await publish(rt, "Third");
    await delay(20);
    assert.equal(settled, false);
    assert.equal(inputs.length, 1);
    assert(inputs[0].current.source.includes("First"));
    first.resolve("wake");
    await settling;
    assert.equal(slowCalls, 0);
    assert.equal(inputs.length, 2);
    assert.equal(max, 1);
    assert(inputs[1].current.source.includes("Third"));
    assert(rt.events.some((e) => e.type === "slow_decision_stale"));
  } finally {
    first.resolve("hold");
    await rt.close();
  }
});
test("Active Slow receives no per-publication decisions; coalesced followup can HOLD", async () => {
  const first = deferred<ModelResult>();
  let decisions = 0,
    calls = 0;
  const rt = await SlideRuntime.create({
    renderer,
    autoTick: false,
    decider: {
      async evaluate() {
        return "hold";
      },
    },
    slowDecider: {
      async evaluate() {
        return ++decisions === 1 ? "wake" : "hold";
      },
    },
    model: {
      async infer() {
        calls++;
        return calls === 1 ? first.promise : done;
      },
    },
  });
  try {
    await publish(rt, "First");
    await until(() => calls === 1);
    await publish(rt, "Second");
    await publish(rt, "Third");
    assert.equal(decisions, 1);
    first.resolve(done);
    await rt.settle();
    assert.equal(decisions, 2);
    assert.equal(calls, 1);
  } finally {
    first.resolve(done);
    await rt.close();
  }
});
test("Explicit Slow task bypasses gate and invalidates a pending wake even after that task finishes", async () => {
  const pending = deferred<"wake" | "hold">();
  let decisions = 0,
    calls = 0;
  const rt = await SlideRuntime.create({
    renderer,
    autoTick: false,
    decider: {
      async evaluate() {
        return "hold";
      },
    },
    slowDecider: {
      async evaluate() {
        decisions++;
        return pending.promise;
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
    await publish(rt, "First");
    await until(() => decisions === 1);
    rt.followupTask("slow", { task: "Explicit refinement", facts: "" });
    await until(() => rt.actors.get("slow")!.state === "idle");
    pending.resolve("wake");
    await rt.settle();
    assert.equal(calls, 1);
    assert.equal(decisions, 1);
    assert(rt.events.some((e) => e.type === "slow_decision_stale"));
  } finally {
    pending.resolve("hold");
    await rt.close();
  }
});
test("Slow decision errors never wake or silently settle; next Fast publication can recover", async () => {
  let decisions = 0,
    calls = 0;
  const rt = await SlideRuntime.create({
    renderer,
    autoTick: false,
    decider: {
      async evaluate() {
        return "hold";
      },
    },
    slowDecider: {
      async evaluate() {
        if (++decisions === 1) throw new Error("Unavailable");
        return "wake";
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
    await publish(rt, "First");
    await assert.rejects(
      rt.settle(),
      /Slow activation decision failed.*Unavailable/,
    );
    await delay(20);
    assert.equal(decisions, 1);
    assert.equal(calls, 0);
    await publish(rt, "Second");
    await rt.settle();
    assert.equal(calls, 1);
    assert.equal(decisions, 2);
  } finally {
    await rt.close();
  }
});
test("Shutdown aborts a pending Slow decision without a late wake", async () => {
  let signal: AbortSignal | undefined,
    calls = 0;
  const rt = await SlideRuntime.create({
    renderer,
    autoTick: false,
    decider: {
      async evaluate() {
        return "hold";
      },
    },
    slowDecider: {
      async evaluate(_input, s) {
        signal = s;
        return new Promise((_resolve, reject) =>
          s.addEventListener("abort", () => reject(s.reason), { once: true }),
        );
      },
    },
    model: {
      async infer() {
        calls++;
        return done;
      },
    },
  });
  await publish(rt, "First");
  await until(() => !!signal);
  await rt.close();
  assert(signal!.aborted);
  assert.equal(calls, 0);
  assert(!rt.events.some((e) => e.type === "slow_decision_error"));
});
test("OpenAI Slow adapter sends current PNG/context and rejects invalid choices", async () => {
  const requests: Record<string, any>[] = [];
  let answer = "hold";
  const client = {
    decisions: {
      async create(body: Record<string, any>) {
        requests.push(body);
        return {
          answers: [
            { type: "choice", name: "slow_activation", choice: answer },
          ],
          usage: {},
        };
      },
    },
  } as unknown as OpenAI;
  const decider = new OpenAISlowDecider(client, "decision-model");
  const input: SlowDecisionInput = {
    current: {
      id: "frame",
      source: "<main>Facts</main>",
      screenshot: Buffer.from("png"),
      geometry: [],
      diagnostics: [],
      fastWatermark: 3,
    },
    lastObservedFastWatermark: 1,
    speech: null,
    messages: [],
    context: "Library talk",
  };
  assert.equal(
    await decider.evaluate(input, new AbortController().signal),
    "hold",
  );
  const content = requests[0].input[0].content;
  assert.equal(content[1].image_url, "data:image/png;base64,cG5n");
  const context = JSON.parse(content[0].text);
  assert.equal(context.image_unavailable, undefined);
  assert.equal(context.visible_source, undefined);
  assert.equal(context.lastObservedFastWatermark, undefined);
  assert.equal(context.brief, "Library talk");
  answer = "unexpected";
  await assert.rejects(
    decider.evaluate(input, new AbortController().signal),
    /wake\/hold/,
  );
});

test('a HOLD during Fast work is reconsidered once when Fast settles, without polling', async () => {
  const release = deferred<ModelResult>();
  let decisions = 0, fastCalls = 0;
  const rt = await SlideRuntime.create({ renderer, autoTick: false,
    decider: { async evaluate() { return 'dispatch'; } },
    slowDecider: { async evaluate() { decisions++; return 'hold'; } },
    model: { async infer() { fastCalls++; return release.promise; } },
  });
  try {
    rt.receiveTranscript('A useful complete topic.', 1);
    await rt.gate.tick(); await until(() => fastCalls === 1);
    await publish(rt, 'A provisional title');
    await until(() => rt.events.some(e => e.type === 'slow_decision'));
    assert.equal(decisions, 1);
    release.resolve(done); await rt.settle();
    assert.equal(decisions, 2);
    await delay(30); await rt.settle(); assert.equal(decisions, 2);
  } finally { release.resolve(done); await rt.close(); }
});
