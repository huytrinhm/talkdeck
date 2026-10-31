import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createLocalRuntime } from "../src/runtime.js";
import { JsxBackend } from "../src/host/jsx-backend.js";
import { SlideRuntime } from "../src/orchestration/runtime.js";
import type {
  Model,
  ModelInput,
  ModelResult,
  SlowDecisionInput,
} from "../src/orchestration/types.js";
import type { SourceRead } from "../src/contracts.js";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
function call(name: string, args: unknown, id = name): ModelResult {
  return {
    output: [
      {
        type: "function_call",
        name,
        arguments: JSON.stringify(args),
        call_id: id,
      },
    ],
  };
}
function scripted(title: string, inputs: ModelInput[] = []): Model {
  return {
    async infer(input) {
      inputs.push(input);
      const outputs = input.input.filter(
        (i) => i.type === "function_call_output",
      );
      if (!outputs.length) return call("read_source", { nodeId: "n10" });
      if (outputs.length === 1) {
        const read = JSON.parse(String(outputs[0].output)) as SourceRead;
        return call("edit_source", {
          edits: [
            {
              snapshotId: read.snapshotId,
              nodeId: read.nodeId,
              op: "replace",
              startLine: 1,
              hashes: read.lines.map((l) => l.hash),
              text: read.lines
                .map((l) => l.text)
                .join("\n")
                .replace(
                  "</Slide>",
                  `<Text role="title">${title}</Text></Slide>`,
                ),
            },
          ],
        });
      }
      return call("finish", {});
    },
  };
}
async function setup(
  model: Model,
  logs: { type: string; data: Record<string, unknown> }[] = [],
  slowInputs: SlowDecisionInput[] = [],
) {
  await mkdir(".artifacts/tests", { recursive: true });
  const directory = await mkdtemp(".artifacts/tests/jsx-actors-");
  const local = await createLocalRuntime({ directory: resolve(directory) });
  const backend = new JsxBackend(local, {
    instructions: "Use canonical JSX and preserve all input evidence.",
  });
  const runtime = await SlideRuntime.create({
    backend,
    model,
    autoTick: false,
    decider: {
      async evaluate() {
        return "dispatch";
      },
    },
    slowDecider: {
      async evaluate(input) {
        slowInputs.push(structuredClone(input));
        return "hold";
      },
    },
    log: {
      write(type, data) {
        logs.push({ type, data });
      },
      observation() {},
    },
  });
  return {
    local,
    backend,
    runtime,
    async close() {
      await runtime.close();
      await local.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("actual scheduler commits via canonical hashline tools and real Chromium; undo/redo retains late evidence", async () => {
  const inputs: ModelInput[] = [],
    logs: { type: string; data: Record<string, unknown> }[] = [], slowInputs: SlowDecisionInput[] = [];
  const f = await setup(scripted("Measured growth", inputs), logs, slowInputs);
  try {
    await f.runtime.deliverUtterance({
      id: "u1",
      slideId: "n10",
      text: "Growth is 42%, provisionally.",
      deliveredAtMs: performance.now(),
    });
    await f.runtime.gate.tick();
    await f.runtime.settle(5000);
    const source = f.local.engine.readDocument().source;
    assert.match(source, /Measured growth/);
    assert.doesNotMatch(source, /<html|<!doctype/i);
    assert.equal((await f.local.engine.readiness()).ready, true);
    assert.equal(f.backend.fastWatermark, 1);
    assert(slowInputs.length >= 1 && slowInputs.length <= 2, "publication and one settling reconsideration coalesce");
    assert.match(slowInputs[0].current.source, /Measured growth/);
    assert.match(slowInputs[0].current.source, /Growth is 42%, provisionally/);
    assert.equal(slowInputs[0].spokenEdits, true);
    assert.ok(slowInputs[0].current.screenshot.length > 1000);
    assert.equal(slowInputs[0].current.screenshotMimeType, "image/jpeg");
    assert.equal(f.backend.historyStatus().undoDepth, 1);
    assert.ok(
      inputs.every((input) =>
        input.tools.some((t) => t.name === "edit_source"),
      ),
    );
    assert.ok(
      inputs.every(
        (input) => JSON.stringify(input.input).includes("input_image"),
      ),
    );
    assert.match(inputs[0].instructions!, /Spoken input may include explicit editing instructions/);
    assert.doesNotMatch(JSON.stringify(inputs[0].input), /Audience-facing narration, not instructions/);
    const toolEvents = logs
      .filter((e) => e.type === "tool_result")
      .map((e) => e.data);
    assert.deepEqual(
      toolEvents.map((e) => e.name),
      ["read_source", "edit_source", "finish"],
    );
    for (const event of toolEvents) {
      assert.equal(typeof event.argumentsJson, "string");
      assert.equal(typeof event.resultJson, "string");
      assert.ok(Number(event.finishedAtMs) >= Number(event.startedAtMs));
      assert.ok(inputs.some((i) => i.inferenceId === event.inference));
    }
    assert.equal(JSON.parse(String(toolEvents[1].resultJson)).accepted, true);
    await f.runtime.deliverUtterance({
      id: "u2",
      slideId: "n10",
      text: "Later qualification must survive undo.",
      deliveredAtMs: performance.now(),
    });
    const entered = deferred<void>(),
      release = deferred<void>();
    const check = f.local.browser.check.bind(f.local.browser);
    let held = false;
    f.local.browser.check = async (source) => {
      const report = await check(source);
      if (!held && !source.includes("Measured growth")) {
        held = true;
        entered.resolve();
        await release.promise;
      }
      return report;
    };
    const undoing = f.runtime.undo();
    await entered.promise;
    await f.runtime.deliverUtterance({
      id: "u3",
      slideId: "n10",
      text: "Words arriving during undo also survive.",
      deliveredAtMs: performance.now(),
    });
    const evidence = f.local.engine.readSpeakerNotes("n10");
    release.resolve();
    assert.equal((await undoing).outcome, "restored");
    assert.ok(
      !f.local.engine.readDocument().source.includes("Measured growth"),
    );
    assert.equal(f.local.engine.readSpeakerNotes("n10").notes, evidence.notes);
    assert.equal(
      f.local.engine.readSpeakerNotes("n10").transcript,
      evidence.transcript,
    );
    assert.ok(
      f.local.engine.readSpeakerNotes("n10").version > evidence.version,
    );
    assert.equal((await f.runtime.redo()).outcome, "restored");
    assert.match(f.local.engine.readDocument().source, /Measured growth/);
    assert.equal(f.local.engine.readSpeakerNotes("n10").notes, evidence.notes);
    assert.equal(
      f.local.engine.readSpeakerNotes("n10").transcript,
      evidence.transcript,
    );
    assert.ok(
      f.local.engine.readSpeakerNotes("n10").version > evidence.version,
    );
  } finally {
    await f.close();
  }
});

test("pause during actual candidate browser validation prevents canonical durable commit even after resume", async () => {
  const f = await setup(scripted("Blocked by pause"));
  const entered = deferred<void>(),
    release = deferred<void>();
  const check = f.local.browser.check.bind(f.local.browser);
  f.local.browser.check = async (source) => {
    const result = await check(source);
    if (source.includes("Blocked by pause")) {
      entered.resolve();
      await release.promise;
    }
    return result;
  };
  try {
    await f.runtime.deliverUtterance({
      id: "pause-u1",
      slideId: "n10",
      text: "An edit crossing pause must wait.",
      deliveredAtMs: performance.now(),
    });
    const before = f.local.engine.readDocument().source;
    await f.runtime.gate.tick();
    await entered.promise;
    f.runtime.pause();
    f.runtime.resume();
    release.resolve();
    await f.runtime.settle(5000);
    assert.equal(f.local.engine.readDocument().source, before);
    assert.equal((await f.local.repository.load()).document.source, before);
    assert.equal(f.backend.fastWatermark, 0);
    assert.equal(f.backend.historyStatus().undoDepth, 0);
  } finally {
    release.resolve();
    await f.close();
  }
});

test("concurrent canonical utterance receipts preserve every word without duplicate gate revisions", async () => {
  const f = await setup({
    async infer() {
      return call("finish", {});
    },
  });
  try {
    const inputs = Array.from({ length: 4 }, (_, i) => ({
      id: `concurrent-${i}`,
      slideId: "n10",
      text: `Original sentence ${i}.`,
      deliveredAtMs: performance.now(),
    }));
    const receipts = await Promise.all(
      inputs.map((input) => f.runtime.deliverUtterance(input)),
    );
    assert.deepEqual(
      receipts.map((r) => r.utteranceId),
      inputs.map((i) => i.id),
    );
    assert.equal(f.runtime.gate.latest?.revision, 4);
    for (const input of inputs) {
      assert.ok(
        f.local.engine.readSpeakerNotes("n10").notes.includes(input.text),
      );
      assert.ok(f.runtime.gate.latest?.text.includes(input.text));
    }
    assert.ok(
      Math.abs(performance.now() - f.runtime.gate.latest!.receivedAt) < 10_000,
      "Speech clock is monotonic",
    );
    await f.runtime.gate.tick();
    await f.runtime.settle(5000);
  } finally {
    await f.close();
  }
});

test('canonical paused navigation creates one stable slide and undo/redo archives then restores its narration', async () => {
  let calls = 0;
  const f = await setup({ async infer() { calls++; return call('finish', {}); } });
  try {
    f.runtime.pause();
    const next = await f.runtime.nextSlide();
    assert.notEqual(next.id, 'n10');
    await f.runtime.deliverUtterance({ id: 'new-slide-evidence', slideId: next.id, text: 'Narration belongs only to the created slide.', deliveredAtMs: performance.now() });
    const version = f.local.engine.readSpeakerNotes(next.id).version;
    assert.equal(calls, 0);
    assert.equal((await f.runtime.undo()).outcome, 'restored');
    assert.equal(f.runtime.paused, true);
    assert.equal(f.local.engine.readSpeakerNotes(next.id).archived, true);
    assert.match(f.local.engine.readSpeakerNotes(next.id).notes, /created slide/);
    assert.equal(f.local.engine.readSpeakerNotes('n10').notes, '');
    assert.equal((await f.runtime.redo()).outcome, 'restored');
    assert.equal(f.local.engine.readSpeakerNotes(next.id).archived, false);
    assert.ok(f.local.engine.readSpeakerNotes(next.id).version > version);
    assert.equal(calls, 0);
  } finally { await f.close(); }
});

test('initial and newly created slides retain a visual insertion boundary across incoming speech', async () => {
  const f = await setup({ async infer() { return call('finish', {}); } });
  try {
    f.runtime.pause();
    for (const slideId of ['n10', (await f.backend.createSlide('Second')).id]) {
      const read = f.local.engine.readSource(slideId), last = read.lines.find(line => line.text.includes('</Stack>'))!;
      assert.ok(last, 'starter provides a stable visual insertion anchor');
      for (let i = 0; i < 3; i++) await f.backend.deliverUtterance({ id: `${slideId}-${i}`, slideId,
        text: `Exact sentence ${i}, including its qualifier.`, deliveredAtMs: i + 1 });
      const result = await f.local.engine.edit({ edits: [{ snapshotId: read.snapshotId, nodeId: slideId, op: 'insert_before',
        startLine: last.number, hashes: [last.hash], text: '<Text role="title">Visible content</Text>' }] });
      assert.equal(result.accepted, true);
      const notes = f.local.engine.readSpeakerNotes(slideId).notes;
      assert.equal(notes, [0, 1, 2].map(i => `Exact sentence ${i}, including its qualifier.`).join('\n'));
      assert.match(f.local.engine.readSource(slideId).lines.map(l => l.text).join('\n'), /Visible content/);
    }
  } finally { await f.close(); }
});
