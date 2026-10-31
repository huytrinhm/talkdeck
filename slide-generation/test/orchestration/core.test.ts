import test from "node:test";
import assert from "node:assert/strict";
import { merge, replaceExactly } from "../../src/orchestration/merge.js";
import { AssetStore } from "../../src/orchestration/assets.js";
import { Publisher } from "../../src/orchestration/publisher.js";
import { History } from "../../src/orchestration/history.js";
import { SpeechGate } from "../../src/orchestration/gate.js";
import { TranscriptAccumulator, readWav } from "../../src/orchestration/transcription.js";
import { readFileSync } from "node:fs";
import type { Decider, Observation, Renderer, Rendered } from "../../src/orchestration/types.js";
const png = Buffer.from("image");
const renderer: Renderer = {
  async render() {
    return { screenshot: png, geometry: [], diagnostics: [] };
  },
  async close() {},
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const obs = (id: string): Observation => ({
  id,
  source: `<main>${id}</main>`,
  screenshot: png,
  geometry: [],
  diagnostics: [],
  fastWatermark: 0,
});
test("exact replacement rejects absent, repeated, overlapping and empty targets", () => {
  assert.equal(replaceExactly("abc", "b", ""), "ac");
  for (const [s, o] of [
    ["abc", "z"],
    ["abcabc", "abc"],
    ["aaa", "aa"],
    ["abc", ""],
  ])
    assert.throws(() => replaceExactly(s, o, "x"));
});
test("merge accepts disjoint and identical edits, rejects overlap and competing insertion", () => {
  assert.equal(
    merge("<a>A</a><b>B</b>", "<a>AA</a><b>B</b>", "<a>A</a><b>BB</b>"),
    "<a>AA</a><b>BB</b>",
  );
  assert.equal(merge("abc", "axc", "axc"), "axc");
  assert.throws(() => merge("abc", "axc", "ayc"));
  assert.throws(() => merge("abc", "aXbc", "aYbc"));
});
test("publisher uses private inference branch for sequential edits and exactly-once conflict forwarding", async () => {
  const p = new Publisher(renderer);
  await p.initialize("<h1>A</h1><p>B</p>");
  const f = p.branch("fast", "fast", p.current),
    s = p.branch("slow", "slow", p.current);
  let forwarded = 0;
  p.onConflict = () => forwarded++;
  await p.edit(s, "s", { old: "<p>B</p>", new: "<p>C</p>" });
  assert.equal(
    (await p.edit(f, "f1", { old: "<h1>A</h1>", new: "<h1>D</h1>" })).outcome,
    "published",
  );
  assert.equal(p.current.source, "<h1>D</h1><p>C</p>");
  // Fast never observed C, so its second call still matches B in its private branch.
  assert.equal(
    (await p.edit(f, "f2", { old: "<p>B</p>", new: "<p>E</p>" })).outcome,
    "rejected",
  );
  await p.edit(f, "f2", { old: "<p>B</p>", new: "<p>E</p>" });
  assert.equal(forwarded, 1);
  assert.equal(p.undo.length, 2);
});
test("publication is serialized through rendering and rollback leaves frame unchanged", async () => {
  const render = deferred<Rendered>();
  let count = 0;
  const p = new Publisher({
    async render() {
      if (++count === 2) return render.promise;
      return renderer.render("");
    },
    async close() {},
  });
  await p.initialize("A B");
  const first = p.current;
  const a = p.edit(p.branch("fast", "fast", first), "a", {
    old: "A",
    new: "X",
  });
  const b = p.edit(p.branch("slow", "slow", first), "b", {
    old: "B",
    new: "Y",
  });
  await Promise.resolve();
  assert.equal(p.current, first);
  assert.equal(count, 2);
  render.resolve({
    screenshot: png,
    geometry: [],
    diagnostics: [
      { code: "bad", severity: "error", message: "Invalid candidate" },
    ],
  });
  assert.equal((await a).outcome, "rejected");
  assert.equal((await b).current.source, "A Y");
  assert.equal(p.undo.length, 1);
});
test("no-op creates no undo/publication; specialists cannot publish", async () => {
  const p = new Publisher(renderer);
  await p.initialize("ABC");
  assert.equal(
    (
      await p.edit(p.branch("fast", "fast", p.current), "a", {
        old: "ABC",
        new: "ABC",
      })
    ).outcome,
    "unchanged",
  );
  assert.equal(
    (
      await p.edit(p.branch("s", "specialist", p.current), "a", {
        old: "ABC",
        new: "X",
      })
    ).outcome,
    "rejected",
  );
  assert.equal(p.undo.length, 0);
});
test("immutable assets copy caller input and output", () => {
  const store = new AssetStore(),
    data = Buffer.from("hello"),
    ref = store.put("text/plain", data);
  data[0] = 0;
  store.get(ref)!.data[0] = 1;
  assert.equal(store.get(ref)!.data.toString(), "hello");
  assert.equal(store.put("text/plain", Buffer.from("hello")), ref);
});
test("history projects only latest two distinct image/source observations and retains tool pairing", () => {
  const h = new History();
  h.observe(obs("a"));
  h.observe(obs("b"));
  h.observe(obs("b"));
  h.add({
    type: "function_call",
    call_id: "x",
    name: "view_slide",
    arguments: "{}",
  });
  h.add({ type: "function_call_output", call_id: "x", output: "{}" });
  h.observe(obs("c"));
  const input = JSON.stringify(h.project());
  assert.equal((input.match(/data:image\/png;base64/g) ?? []).length, 2);
  assert(!input.includes("<main>a</main>"));
  assert(input.includes("<main>b</main>"));
  assert.equal((input.match(/"call_id":"x"/g) ?? []).length, 2);
});
test("gate holds without dropping text, ignores stale corrections, permits dispatch after append", async () => {
  const promises: ReturnType<typeof deferred<"dispatch" | "hold">>[] = [];
  const dispatched: number[] = [];
  const decider: Decider = {
    evaluate() {
      const p = deferred<"dispatch" | "hold">();
      promises.push(p);
      return p.promise;
    },
  };
  const gate = new SpeechGate(decider, (s) => dispatched.push(s.revision));
  gate.receive("sixty", 1);
  const t1 = gate.tick();
  gate.receive("forty-eight", 2);
  promises[0].resolve("dispatch");
  await t1;
  assert.deepEqual(dispatched, []);
  const t2 = gate.tick();
  promises[1].resolve("hold");
  await t2;
  assert.equal(gate.latest?.revision, 2);
  await gate.tick();
  assert.equal(promises.length, 2, "unchanged held speech is not billed repeatedly");
  gate.receive("forty-eight students", 3);
  const t3 = gate.tick();
  promises[2].resolve("dispatch");
  await t3;
  assert.deepEqual(dispatched, [3]);
  assert.equal(gate.latest?.revision, 3);
  gate.close();
});
test("overlapping gate decisions do not dispatch duplicate baselines or exceed concurrency cap", async () => {
  const ps: ReturnType<typeof deferred<"dispatch" | "hold">>[] = [];
  const out: number[] = [];
  const gate = new SpeechGate(
    {
      evaluate() {
        const p = deferred<"dispatch" | "hold">();
        ps.push(p);
        return p.promise;
      },
    },
    (s) => out.push(s.revision),
    "",
    undefined,
    2,
  );
  gate.receive("Complete meaning.", 1);
  const a = gate.tick();
  await gate.tick();
  assert.equal(ps.length, 1, "same revision has only one in-flight evaluation");
  gate.receive("Complete meaning. Another idea.", 2);
  const b = gate.tick();
  await gate.tick();
  assert.equal(ps.length, 2);
  ps[1].resolve("dispatch");
  await b;
  ps[0].resolve("dispatch");
  await a;
  assert.deepEqual(out, [2]);
  gate.close();
});
test("transcription reconciles out-of-order final events and ignores late deltas", () => {
  const seen: string[] = [];
  const t = new TranscriptAccumulator((text) => seen.push(text));
  t.event({
    type: "input_audio_buffer.committed",
    item_id: "a",
    previous_item_id: null,
  });
  t.event({
    type: "input_audio_buffer.committed",
    item_id: "b",
    previous_item_id: "a",
  });
  t.event({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "b",
    transcript: "second",
  });
  t.event({
    type: "conversation.item.input_audio_transcription.delta",
    item_id: "a",
    delta: "frist",
  });
  t.event({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "a",
    transcript: "first",
  });
  t.event({
    type: "conversation.item.input_audio_transcription.delta",
    item_id: "a",
    delta: "wrong",
  });
  assert.equal(t.text, "first second");
  assert.equal(seen.at(-1), "first second");
});
test("prepared audio fixture is supported PCM and contains 85 seconds of audio", () => {
  const wav = readWav(
    readFileSync(new URL("../../fixtures/legacy/test-fixture.wav", import.meta.url)),
  );
  assert(wav.durationMs > 85000 && wav.durationMs < 86000);
  assert(wav.pcm.length > 4_000_000);
});
test("merge treats numeric and identifier tokens atomically, never combines two numbers", () => {
  assert.throws(() => merge("<b>100</b>", "<b>200</b>", "<b>101</b>"));
  assert.throws(() => merge("4.4", "3.4", "4.6"));
  assert.throws(() => merge("width:100px", "width:200px", "width:101px"));
});
test("failed render throws without changing displayed source, screenshot or undo", async () => {
  let calls = 0;
  const p = new Publisher({
    async render() {
      if (++calls > 1) throw new Error("browser crashed");
      return renderer.render("");
    },
    async close() {},
  });
  await p.initialize("before");
  const initial = p.current;
  const result = await p.edit(p.branch("slow", "slow", initial), "x", {
    old: "before",
    new: "after",
  });
  assert.equal(result.outcome, "rejected");
  assert.equal(p.current, initial);
  assert.equal(p.undo.length, 0);
});
test("200 ms clock does not restart on every transcript update", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  let calls = 0;
  const gate = new SpeechGate(
    {
      async evaluate() {
        calls++;
        return "hold";
      },
    },
    () => {},
  );
  gate.start();
  for (let i = 1; i <= 8; i++) {
    gate.receive(`word ${i}`, i);
    t.mock.timers.tick(50);
    await Promise.resolve();
    await Promise.resolve();
  }
  assert.equal(calls, 2);
  gate.close();
  t.mock.timers.reset();
});
test("logging failure before commit retains the old frame; subscriber failure after commit is advisory", async () => {
  let failLog = true;
  const p = new Publisher(renderer, {
    observation() {},
    write(type) {
      if (type === "publication" && failLog) throw new Error("disk full");
    },
  });
  await p.initialize("before");
  const initial = p.current;
  const branch = p.branch("fast", "fast", initial);
  assert.equal(
    (await p.edit(branch, "a", { old: "before", new: "after" })).outcome,
    "rejected",
  );
  assert.equal(p.current, initial);
  assert.equal(p.undo.length, 0);
  failLog = false;
  p.onPublish = () => {
    throw new Error("subscriber unavailable");
  };
  const result = await p.edit(branch, "b", { old: "before", new: "after" });
  assert.equal(result.outcome, "published");
  assert.equal(p.current.source, "after");
  assert.equal(p.undo.length, 1);
  assert(
    result.diagnostics.some(
      (d) => d.code === "notification" && d.severity === "advisory",
    ),
  );
});
test("a valid hold acknowledges evaluation without acknowledging dispatch or losing speech", async () => {
  const gate = new SpeechGate(
    {
      async evaluate() {
        return "hold";
      },
    },
    () => assert.fail("Must not dispatch a hold"),
  );
  gate.receive("An unresolved fragment", 1);
  await gate.tick();
  assert.equal(gate.lastEvaluatedRevision, 1);
  assert.equal(gate.lastDispatched, null);
  assert.equal(gate.latest?.text, "An unresolved fragment");
  gate.close();
});

test("stale edit rejects a target that became ambiguous after a concurrent duplication", async () => {
  const p = new Publisher(renderer);
  await p.initialize("<main><p>A</p></main>");
  const fast = p.branch("fast", "fast", p.current);
  let forwarded = 0;
  p.onConflict = () => forwarded++;
  await p.edit(p.branch("slow", "slow", p.current), "duplicate", {
    old: "<p>A</p>",
    new: "<p>A</p><p>A</p>",
  });
  const result = await p.edit(fast, "stale", {
    old: "<p>A</p>",
    new: "<p>B</p>",
  });
  assert.equal(result.outcome, "rejected");
  assert.equal(p.current.source, "<main><p>A</p><p>A</p></main>");
  assert.equal(forwarded, 1);
});

test("identical duplication already published remains an accepted no-op", async () => {
  const p = new Publisher(renderer);
  await p.initialize("<main><p>A</p></main>");
  const initial = p.current;
  const fast = p.branch("fast", "fast", initial),
    slow = p.branch("slow", "slow", initial);
  const edit = { old: "<p>A</p>", new: "<p>A</p><p>A</p>" };
  await p.edit(slow, "s", edit);
  assert.equal((await p.edit(fast, "f", edit)).outcome, "unchanged");
  assert.equal(p.undo.length, 1);
});
