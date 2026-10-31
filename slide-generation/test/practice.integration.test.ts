import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createPracticeRuntime } from "../src/practice/runtime.js";
import type {
  ReviewContext,
  ReviewOutput,
  ReviewRequest,
  Reviewer,
} from "../src/practice/contracts.js";
import type { Model, ModelResult } from "../src/orchestration/types.js";
import { nodes, parseSource } from "../src/parser.js";

const done: ModelResult = { output: [] };
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
function proposal(
  context: ReviewContext,
  oldText = "Before",
  newText = "After",
  id = "p1",
  slideId = "n10",
) {
  const read = context.baseline.reads.find((r) => r.nodeId === slideId)!;
  const target = read.lines.find((l) => l.text.includes(oldText));
  assert(target);
  return {
    id,
    title: "Clarify the title",
    rationale: "Use the clearer wording from rehearsal",
    feedbackIds: ["f1"],
    evidenceIds: ["n10", context.speech[0]?.id ?? "timing-summary"],
    alternativeTo: [],
    edits: [
      {
        snapshotId: read.snapshotId,
        nodeId: read.nodeId,
        op: "replace" as const,
        startLine: target.number,
        hashes: [target.hash],
        text: target.text.replace(oldText, newText),
      },
    ],
  };
}
function output(
  context: ReviewContext,
  proposals: ReviewOutput["proposals"] = [proposal(context)],
): ReviewOutput {
  return {
    summary: "One useful change",
    feedback: [
      {
        id: "f1",
        observation: "The spoken title is clearer",
        suggestion: "Update the title",
        evidenceIds: ["n10", context.speech[0]?.id ?? "timing-summary"],
      },
    ],
    proposals,
  };
}
async function setup(
  reviewer: Reviewer,
  model: Model = {
    async infer() {
      return done;
    },
  },
) {
  await mkdir(".artifacts/tests", { recursive: true });
  const directory = await mkdtemp(".artifacts/tests/practice-");
  const app = await createPracticeRuntime({
    directory: resolve(directory),
    reviewer,
    actors: {
      model,
      autoTick: false,
      decider: {
        async evaluate() {
          throw new Error("Practice must never request a speech decision");
        },
      },
      slowDecider: {
        async evaluate() {
          return "hold";
        },
      },
    },
  });
  const read = app.local.engine.readSource("n10"),
    last = read.lines.at(-1)!;
  assert.equal(
    (
      await app.local.engine.edit({
        edits: [
          {
            snapshotId: read.snapshotId,
            nodeId: read.nodeId,
            op: "insert_before",
            startLine: last.number,
            hashes: [last.hash],
            text: '<Text role="title">Before</Text>',
          },
        ],
      })
    ).accepted,
    true,
  );
  return {
    ...app,
    directory,
    async cleanup() {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
async function record(f: Awaited<ReturnType<typeof setup>>) {
  const r = await f.practice.start({
    audience: "Students",
    targetDurationMinutes: 5,
  });
  await f.practice.addSpeech(r.id, {
    id: "u1",
    startMs: 0,
    endMs: 1000,
    text: "After is the clearer title.",
    timing: "aligned",
  });
  await f.practice.finish(r.id);
  return f.practice.wait(r.id);
}

test("one end-pass receives full frozen context, prepares real previews privately, and accepts one undoable transaction", async () => {
  let calls = 0,
    packet: ReviewContext | undefined;
  const f = await setup({
    async review({ context }) {
      calls++;
      packet = context;
      return output(context);
    },
  });
  try {
    const before = f.local.engine.readDocument().source,
      history = f.backend.historyStatus().undoDepth;
    const r = await record(f);
    assert.equal(r.status, "ready", r.error ?? "");
    assert.equal(calls, 1);
    assert.equal(f.local.engine.readDocument().source, before);
    assert.equal(f.backend.historyStatus().undoDepth, history);
    assert.equal(packet!.speech[0].text, "After is the clearer title.");
    assert.equal(packet!.images.length, 1);
    assert.equal(packet!.design?.skill, "talkdeck-slide-design");
    assert.match(packet!.design!.instructions, /L10 — Side-by-side comparison/);
    assert.match(packet!.design!.instructions, /There is no Chart, Table/);
    assert.deepEqual(r.context!.design, packet!.design);
    assert.equal(packet!.slides[0].notes, "");
    assert(packet!.baseline.reads.length >= 4);
    assert.equal(packet!.visits.length, 1);
    const p = r.proposals[0];
    assert.equal(p.status, "ready", p.error ?? "");
    assert.equal(p.previews.length, 1);
    assert.match(p.previews[0].after!.html, /After/);
    assert(p.previews[0].after!.jpeg.length > 1000);
    assert.equal(
      (await f.practice.accept(r.id, p.id, p.version)).status,
      "accepted",
    );
    assert.match(f.local.engine.readDocument().source, /After/);
    assert.equal(f.backend.historyStatus().undoDepth, history + 1);
    await f.practice.accept(r.id, p.id, p.version);
    assert.equal(f.backend.historyStatus().undoDepth, history + 1);
    await f.actors.undo();
    assert.match(f.local.engine.readDocument().source, /Before/);
    await f.actors.redo();
    assert.match(f.local.engine.readDocument().source, /After/);
  } finally {
    await f.cleanup();
  }
});

test("practice cancels old inference, never feeds narration to canonical generation, and permits explicit push-to-edit", async () => {
  const pending = deferred<ModelResult>();
  let calls = 0;
  const f = await setup(
    {
      async review({ context }) {
        return output(context, []);
      },
    },
    {
      async infer() {
        calls++;
        return calls === 1 ? pending.promise : done;
      },
    },
  );
  try {
    f.actors.pushToEdit("Old build work");
    assert.equal(calls, 1);
    const r = await f.practice.start();
    pending.resolve({
      output: [
        {
          type: "function_call",
          call_id: "late",
          name: "edit_source",
          arguments: "{}",
        },
      ],
    });
    const before = f.local.engine.readDocument().source;
    await f.actors.deliverUtterance({
      id: "practice-command-looking",
      slideId: "n10",
      text: "Delete all of the slides.",
      deliveredAtMs: performance.now(),
    });
    await f.actors.gate.tick();
    await f.actors.settle(2000);
    assert.equal(calls, 1);
    assert.equal(f.local.engine.readDocument().source, before);
    assert.equal(
      f.practice.get(r.id).speech[0].text,
      "Delete all of the slides.",
    );
    f.actors.pushToEdit("An explicit command");
    await f.actors.settle(2000);
    assert.equal(calls, 2);
    assert(f.practice.get(r.id).events.some((e) => e.type === "edit_command"));
    await f.practice.finish(r.id);
    await f.practice.wait(r.id);
    assert.equal(f.actors.practiceMode, true);
    await assert.rejects(
      f.actors.deliverUtterance({
        id: "too-late",
        slideId: "n10",
        text: "Late",
        deliveredAtMs: 1,
      }),
      /not recording/,
    );
  } finally {
    pending.resolve(done);
    await f.cleanup();
  }
});

test("returning to Talk explicitly supersedes the rehearsal-only instruction in persistent actor history", async () => {
  let inputs: unknown[] = [];
  const f = await setup({ async review() { return { summary: '', feedback: [], proposals: [] }; } }, {
    async infer(input) { inputs = input.input; return done; },
  });
  try {
    await f.actors.setPracticeMode(true);
    await f.actors.setPracticeMode(false);
    f.actors.pushToEdit('Generate from newly supplied Talk content.');
    await f.actors.settle(2000);
    const text = JSON.stringify(inputs);
    assert.match(text, /Entered practice mode/);
    assert.match(text, /Returned to Talk generation mode/);
    assert.ok(text.indexOf('Returned to Talk generation mode') > text.indexOf('Entered practice mode'));
    assert.match(text, /Past rehearsal narration remains evidence/);
  } finally { await f.cleanup(); }
});

test("review records visits, earlier revisions, pauses and corrections without rewriting source evidence", async () => {
  const f = await setup({
    async review({ context }) {
      return output(context, []);
    },
  });
  try {
    const r = await f.practice.start();
    await f.practice.addSpeech(r.id, {
      id: "wrong",
      startMs: 0,
      endMs: 100,
      text: "Six",
      timing: "aligned",
    });
    await f.practice.addSpeech(r.id, {
      id: "correct",
      correctionOf: "wrong",
      startMs: 0,
      endMs: 100,
      text: "Five",
      timing: "aligned",
    });
    const second = await f.actors.nextSlide();
    await f.actors.selectSlide("n10");
    await f.practice.recordingPause(r.id, true);
    await f.practice.recordingPause(r.id, false);
    await f.practice.finish(r.id);
    const result = await f.practice.wait(r.id);
    assert.equal(result.status, "ready", result.error ?? "");
    assert.equal(result.speech.length, 2);
    assert.equal(result.context!.speech.length, 1);
    assert.equal(result.context!.speech[0].text, "Five");
    assert(result.context!.visits.some((v) => v.slideId === second.id));
    assert(result.context!.priorDecks.length > 0);
    assert(result.context!.events.some((e) => e.type === "pause"));
  } finally {
    await f.cleanup();
  }
});

test("invalid references fail review; invalid edits remain visible but cannot be accepted", async () => {
  let broken = true;
  const f = await setup({
    async review({ context }) {
      const out = output(context);
      if (broken) out.feedback[0].evidenceIds = ["invented"];
      else out.proposals[0].edits[0].text = "<Script>bad</Script>";
      return out;
    },
  });
  try {
    const r = await record(f);
    assert.equal(r.status, "failed");
    assert.match(r.error!, /Unknown evidence/);
    broken = false;
    await f.practice.retry(r.id);
    const retried = await f.practice.wait(r.id);
    assert.equal(retried.status, "ready");
    assert.equal(retried.proposals[0].status, "invalid");
    await assert.rejects(f.practice.accept(r.id, "p1", 1), /current ready/);
    assert.match(f.local.engine.readDocument().source, /Before/);
  } finally {
    await f.cleanup();
  }
});

test("unrelated changes survive acceptance; changed targets refuse without overwriting live content", async () => {
  const f = await setup({
    async review({ context }) {
      return output(context);
    },
  });
  try {
    const r = await record(f);
    assert.equal(r.proposals[0].status, "ready", r.proposals[0].error ?? "");
    const brief = f.local.engine.readSource("n2");
    await f.local.engine.edit({
      edits: [
        {
          snapshotId: brief.snapshotId,
          nodeId: "n2",
          op: "replace",
          startLine: 1,
          hashes: brief.lines.map((l) => l.hash),
          text: '<Brief id="n2">Unrelated new brief</Brief>',
        },
      ],
    });
    const accepted = await f.practice.accept(r.id, "p1", 1);
    assert.equal(accepted.status, "accepted", accepted.error ?? "");
    assert.match(f.local.engine.readDocument().source, /Unrelated new brief/);
    await f.actors.undo();
    const second = await record(f);
    const read = f.local.engine.readSource("n10"),
      line = read.lines.find((l) => l.text.includes("Before"))!;
    await f.local.engine.edit({
      edits: [
        {
          snapshotId: read.snapshotId,
          nodeId: read.nodeId,
          op: "replace",
          startLine: line.number,
          hashes: [line.hash],
          text: line.text.replace("Before", "User changed it"),
        },
      ],
    });
    assert.equal((await f.practice.accept(second.id, "p1", 1)).status, "stale");
    assert.match(f.local.engine.readDocument().source, /User changed it/);
  } finally {
    await f.cleanup();
  }
});

test("cancellation ignores a late review result and retry reuses frozen context", async () => {
  const pending = deferred<ReviewOutput>();
  let input: ReviewRequest | undefined,
    calls = 0;
  const f = await setup({
    async review(request) {
      input = request;
      calls++;
      return calls === 1 ? pending.promise : output(request.context);
    },
  });
  try {
    const r = await f.practice.start();
    await f.practice.finish(r.id);
    for (let i = 0; i < 200 && !input; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert(input);
    await f.practice.cancel(r.id);
    assert.equal(input.signal.aborted, true);
    pending.resolve(output(input.context));
    assert.equal((await f.practice.wait(r.id)).status, "cancelled");
    const before = f.practice.get(r.id).context!.baseline.revision;
    const retainedDesign = f.practice.get(r.id).context!.design;
    await f.practice.retry(r.id);
    const result = await f.practice.wait(r.id);
    assert.equal(result.status, "ready", result.error ?? "");
    assert.equal(result.context!.baseline.revision, before);
    assert.deepEqual(result.context!.design, retainedDesign);
  } finally {
    pending.resolve({ summary: "", feedback: [], proposals: [] });
    await f.cleanup();
  }
});

test("HTTP practice controls validate input and expose review, previews and acceptance without frontend", async () => {
  const f = await setup({
    async review({ context }) {
      return output(context);
    },
  });
  const post = (path: string, body: unknown = {}) =>
    f.app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const created = await post("/practice", { brief: { audience: "Class" } });
    assert.equal(created.status, 201);
    const r = await created.json();
    assert.equal(
      (
        await post(`/practice/${r.id}/speech`, {
          id: "u1",
          text: "After",
          startMs: 0,
          endMs: 100,
        })
      ).status,
      202,
    );
    assert.equal((await post(`/practice/${r.id}/finish`)).status, 202);
    await f.practice.wait(r.id);
    const review = await (await f.app.request(`/practice/${r.id}`)).json();
    assert.equal(review.proposals[0].status, "ready");
    assert.equal(
      (await post(`/practice/${r.id}/proposals/p1/accept`, { version: 9 }))
        .status,
      409,
    );
    const accepted = await post(`/practice/${r.id}/proposals/p1/accept`, {
      version: 1,
    });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).status, "accepted");
    assert.equal((await post("/controls/undo")).status, 200);
    assert.equal((await post("/controls/build")).status, 200);
    assert.equal((await f.app.request("/practice/missing")).status, 404);
  } finally {
    await f.cleanup();
  }
});

test("counter-prompt creates a cancellable new review and preserves the original evidence/anchors", async () => {
  let calls = 0;
  const f = await setup({
    async review(request) {
      calls++;
      return output(request.context, [
        proposal(
          request.context,
          "Before",
          request.revision ? "Revised" : "After",
        ),
      ]);
    },
  });
  try {
    const r = await record(f);
    const baseline = JSON.stringify(r.context);
    const next = await f.practice.revise(r.id, "p1", "Use Revised instead");
    assert.equal(next.status, "processing");
    const reviewed = await f.practice.wait(next.id);
    assert.equal(reviewed.status, "ready", reviewed.error ?? "");
    assert.equal(calls, 2);
    assert.equal(f.practice.get(r.id).proposals[0].status, "superseded");
    assert.equal(JSON.stringify(f.practice.get(r.id).context), baseline);
    assert.match(reviewed.proposals[0].previews[0].after!.html, /Revised/);
    assert.equal(
      (await f.practice.accept(next.id, "p1", reviewed.proposals[0].version))
        .status,
      "accepted",
    );
  } finally {
    await f.cleanup();
  }
});

test("accepted speaker-note proposals undo/redo their notes while preserving later raw speech", async () => {
  const f = await setup({
    async review({ context }) {
      const read = context.baseline.reads.find((r) => r.nodeId === "n10")!;
      const line = read.lines.find((l) => l.text.includes("<SpeakerNotes"))!;
      const p = proposal(context);
      p.edits = [
        {
          snapshotId: read.snapshotId,
          nodeId: read.nodeId,
          op: "replace",
          startLine: line.number,
          hashes: [line.hash],
          text: line.text.replace(
            "/>",
            ">Remember the example.</SpeakerNotes>",
          ),
        },
      ];
      return output(context, [p]);
    },
  });
  try {
    const r = await record(f);
    assert.equal(r.proposals[0].status, "ready", r.proposals[0].error ?? "");
    await f.practice.accept(r.id, "p1", 1);
    assert.equal(
      f.local.engine.readSpeakerNotes("n10").notes,
      "Remember the example.",
    );
    // Ingest directly as later source evidence, not practice speech; history must preserve it.
    await f.backend.deliverUtterance({
      id: "later-note",
      slideId: "n10",
      text: "A later qualification.",
      deliveredAtMs: 1,
    });
    const raw = f.local.engine.readSpeakerNotes("n10").transcript;
    await f.actors.undo();
    assert.equal(
      f.local.engine.readSpeakerNotes("n10").notes.trim(),
      "A later qualification.",
    );
    assert.equal(f.local.engine.readSpeakerNotes("n10").transcript, raw);
    await f.actors.redo();
    assert.match(
      f.local.engine.readSpeakerNotes("n10").notes,
      /Remember the example/,
    );
    assert.match(
      f.local.engine.readSpeakerNotes("n10").notes,
      /later qualification/,
    );
  } finally {
    await f.cleanup();
  }
});

test("saved reviews can be reloaded and accepted without relying on ephemeral snapshot handles", async () => {
  const reviewer: Reviewer = {
    async review({ context }) {
      return output(context);
    },
  };
  const f = await setup(reviewer);
  let second: Awaited<ReturnType<typeof createPracticeRuntime>> | undefined;
  try {
    const r = await record(f);
    await f.close();
    second = await createPracticeRuntime({
      directory: resolve(f.directory),
      reviewer,
      actors: {
        model: {
          async infer() {
            return done;
          },
        },
        autoTick: false,
        decider: {
          async evaluate() {
            return "hold";
          },
        },
        slowDecider: {
          async evaluate() {
            return "hold";
          },
        },
      },
    });
    assert.equal(second.practice.get(r.id).status, "ready");
    assert.equal(
      (await second.practice.accept(r.id, "p1", 1)).status,
      "accepted",
    );
    assert.match(second.local.engine.readDocument().source, /After/);
  } finally {
    if (second) await second.close();
    else await f.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("audio recording is durable and batch transcription maps sample time back across recording gaps", async () => {
  const f = await setup({
    async review({ context }) {
      return output(context, []);
    },
  });
  // A separate service on the same actual backend provides a deterministic ASR adapter.
  const { PracticeService } = await import("../src/practice/service.js");
  await f.practice.close();
  let calls = 0;
  const service = await PracticeService.create({
    directory: resolve(f.directory, "audio-practice"),
    local: f.local,
    backend: f.backend,
    actors: f.actors,
    reviewer: {
      async review({ context }) {
        return output(context, []);
      },
    },
    transcriber: {
      async transcribe(pcm) {
        calls++;
        assert.equal(pcm.length, 96000);
        return [
          { startMs: 200, endMs: 800, text: "First" },
          { startMs: 1200, endMs: 1800, text: "Second" },
        ];
      },
    },
  });
  try {
    const r = await service.start({}, "audio");
    await service.addAudio(r.id, 0, 1000, Buffer.alloc(48000));
    await service.addAudio(r.id, 0, 1000, Buffer.alloc(48000));
    await service.addAudio(r.id, 1, 4000, Buffer.alloc(48000));
    await assert.rejects(
      service.addAudio(r.id, 1, 4000, Buffer.alloc(48000, 1)),
      /Conflicting/,
    );
    const wav = await service.audio(r.id, 0);
    assert.equal(wav.subarray(0, 4).toString(), "RIFF");
    await service.finish(r.id);
    const result = await service.wait(r.id);
    assert.equal(result.status, "ready", result.error ?? "");
    assert.equal(calls, 1);
    assert.deepEqual(
      result.context!.speech.map((s) => [s.startMs, s.endMs, s.text]),
      [
        [1200, 1800, "First"],
        [4200, 4800, "Second"],
      ],
    );
  } finally {
    await service.close();
    await f.cleanup();
  }
});

test("independent proposals share one baseline and remain applicable after accepting a disjoint proposal", async () => {
  let secondId = "";
  const f = await setup({
    async review({ context }) {
      return output(context, [
        proposal(context, "Before", "First improved", "p1"),
        proposal(context, "Second original", "Second improved", "p2", secondId),
      ]);
    },
  });
  try {
    secondId = (await f.actors.nextSlide()).id;
    const read = f.local.engine.readSource(secondId),
      last = read.lines.at(-1)!;
    await f.local.engine.edit({
      edits: [
        {
          snapshotId: read.snapshotId,
          nodeId: secondId,
          op: "insert_before",
          startLine: last.number,
          hashes: [last.hash],
          text: '<Text role="title">Second original</Text>',
        },
      ],
    });
    const r = await record(f);
    assert(r.proposals.every((p) => p.status === "ready"));
    const depth = f.backend.historyStatus().undoDepth;
    assert.equal((await f.practice.accept(r.id, "p1", 1)).status, "accepted");
    const second = await f.practice.accept(r.id, "p2", 1);
    assert.equal(second.status, "accepted", second.error ?? "");
    assert.equal(f.backend.historyStatus().undoDepth, depth + 2);
    const source = f.local.engine.readDocument().source;
    assert.match(source, /First improved/);
    assert.match(source, /Second improved/);
  } finally {
    await f.cleanup();
  }
});

test("a shared theme proposal previews every affected slide and competing alternatives cannot both be accepted", async () => {
  const f = await setup({
    async review({ context }) {
      const read = context.baseline.reads.find((r) => r.nodeId === "n3")!;
      const line = read.lines.find((l) => l.text.includes("--color-bg"))!;
      const theme = {
        ...proposal(context),
        edits: [
          {
            snapshotId: read.snapshotId,
            nodeId: read.nodeId,
            op: "replace" as const,
            startLine: line.number,
            hashes: [line.hash],
            text: line.text.replace("#fafafa", "#ffffff"),
          },
        ],
        alternativeTo: ["p2"],
      };
      return output(context, [
        theme,
        { ...theme, id: "p2", alternativeTo: ["p1"] },
      ]);
    },
  });
  try {
    await f.actors.nextSlide();
    const r = await record(f);
    assert.equal(r.proposals[0].status, "ready", r.proposals[0].error ?? "");
    assert.equal(r.proposals[0].previews.length, 2);
    await f.practice.accept(r.id, "p1", 1);
    await assert.rejects(f.practice.accept(r.id, "p2", 1), /alternative/);
  } finally {
    await f.cleanup();
  }
});

test("a canonical change during acceptance validation cannot publish an unpreviewed candidate", async () => {
  const f = await setup({
    async review({ context }) {
      return output(context);
    },
  });
  const entered = deferred<void>(),
    release = deferred<void>();
  try {
    const r = await record(f);
    const check = f.local.browser.check.bind(f.local.browser);
    let blocked = false;
    f.local.browser.check = async (source) => {
      const result = await check(source);
      if (!blocked && source.includes("After")) {
        blocked = true;
        entered.resolve();
        await release.promise;
      }
      return result;
    };
    const acceptance = f.practice.accept(r.id, "p1", 1);
    await entered.promise;
    await f.backend.deliverUtterance({
      id: "interleaving",
      slideId: "n10",
      text: "New source evidence during validation.",
      deliveredAtMs: 10,
    });
    release.resolve();
    const result = await acceptance;
    assert.equal(result.status, "stale");
    assert.match(f.local.engine.readDocument().source, /Before/);
    assert.doesNotMatch(f.local.engine.readDocument().source, />After</);
    assert.match(
      f.local.engine.readSpeakerNotes("n10").notes,
      /New source evidence/,
    );
  } finally {
    release.resolve();
    await f.cleanup();
  }
});

test("explicit requested change without an initial proposal prepares privately and remains versioned", async () => {
  let requests = 0;
  const f = await setup({async review({context,change}) {
    requests++;
    if (change) {
      assert.equal(change.slideId, "n10");
      assert.equal(change.prompt, "Use After as the title");
      return output(context);
    }
    return output(context, []);
  }});
  try {
    const original = f.local.engine.readDocument().source;
    const first = await record(f);
    assert.equal(first.proposals.length, 0);
    const job = await f.practice.requestChange(first.id, "n10", "Use After as the title");
    const ready = await f.practice.wait(job.id);
    assert.equal(ready.status, "ready", ready.error ?? "");
    assert.equal(ready.proposals[0].status, "ready", ready.proposals[0].error ?? "");
    assert.equal(f.local.engine.readDocument().source, original);
    assert(ready.proposals[0].previews[0].visualDiff?.changes.some(c=>c.kind==='text'));
    assert.equal(requests, 2);
    assert.equal((await f.practice.accept(ready.id, ready.proposals[0].id, ready.proposals[0].version)).status, "accepted");
  } finally {await f.cleanup();}
});

test("unchanged canonical source still refreshes changed render dependencies before acceptance", async () => {
  const f = await setup({async review({context}) {return output(context);}});
  try {
    const r = await record(f), proposal = r.proposals[0];
    const original = f.local.engine.readDocument().source;
    const render = f.local.renderer.render.bind(f.local.renderer);
    f.local.renderer.render = async (...args) => {
      const artifact = await render(...args);
      // A new deployment dependency, with real browser capture. It is not a source edit.
      artifact.dependencies = artifact.dependencies.map(d=>d.kind==='renderer'?{...d,sha256:'new-renderer-deployment'}:d);
      return artifact;
    };
    const refreshed = await f.practice.accept(r.id, proposal.id, proposal.version);
    assert.equal(refreshed.status, "ready");
    assert.equal(refreshed.version, proposal.version + 1);
    assert.equal(f.local.engine.readDocument().source, original);
    assert.notEqual(refreshed.previewSignature, proposal.previewSignature);
    assert.equal((await f.practice.accept(r.id, proposal.id, refreshed.version)).status, "accepted");
  } finally {await f.cleanup();}
});
