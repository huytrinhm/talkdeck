import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createLocalRuntime } from "../src/runtime.js";
import { JsxBackend } from "../src/host/jsx-backend.js";
import { lineHash } from "../src/hashline.js";
import type { SourceRead } from "../src/contracts.js";
import type { ReplayCompatibility } from "../src/evaluation/replay.js";
import {
  buildIntegratedTransactionCassette,
  replayIntegratedTransactions,
} from "../src/headless/transaction-replay.js";
import type { GenerationInvocation } from "../src/orchestration/backend.js";

const change = (read: SourceRead, transform: (source: string) => string) => ({
  edits: [
    {
      snapshotId: read.snapshotId,
      nodeId: read.nodeId,
      op: "replace",
      startLine: 1,
      hashes: read.lines.map((l) => l.hash),
      text: transform(read.lines.map((l) => l.text).join("\n")),
    },
  ],
});

test("integrated transaction recording replays actual input, accepted/refused/error tools, returned snapshots, creation and history", async () => {
  await mkdir(".artifacts/tests", { recursive: true });
  const directory = await mkdtemp(".artifacts/tests/integrated-replay-");
  const local = await createLocalRuntime({
    directory: resolve(directory, "original"),
  });
  const fresh = await createLocalRuntime({
    directory: resolve(directory, "replay"),
  });
  const commits: any[] = [],
    operations: any[] = [],
    initial = local.engine.readDocument();
  let previous = lineHash(initial.source);
  const unsubscribe = local.engine.subscribe((event) => {
    commits.push({
      kind: "commit",
      sequence: commits.length,
      beforeSourceSha: previous,
      afterSourceSha: event.revision,
      source: event.document.source,
      reason: event.reason,
      transactionId: event.transactionId,
    });
    previous = event.revision;
  });
  const backend = new JsxBackend(local, {
    instructions: "Synthetic integration fixture; no model inference.",
    onTool: (event) => {
      operations.push({
        kind: "tool",
        ...event,
        sourceSha256: local.engine.state().revision,
      });
    },
  });
  const replay = new JsxBackend(fresh, {
    instructions: "Synthetic integration fixture; no model inference.",
  });
  const compatibility: ReplayCompatibility = {
    protocol: "hashline-replay-v1",
    sourceSchema: 1,
    toolSchemaSha256: lineHash(JSON.stringify(local.tools.definitions())),
    promptSha256: lineHash("test"),
    dependencies: [],
  };
  const context = (
    slideId = "n10",
    role: "slow" | "fast" = "slow",
  ): GenerationInvocation => {
    const base = {
      agent: role,
      role,
      slideId,
      inferenceId: "recorded-synthetic",
      signal: new AbortController().signal,
    };
    return { ...base, context: backend.generation.context(base) };
  };
  const invoke = async (name: string, args: unknown, input = context()) =>
    (await backend.generation.invoke(input, name, args)).output as any;
  const input = async (id: string, slideId: string, text: string) => {
    const value = { id, slideId, text, deliveredAtMs: operations.length + 1 };
    await backend.deliverUtterance(value);
    operations.push({
      kind: "input",
      input: value,
      sourceSha256: local.engine.state().revision,
    });
  };
  try {
    await backend.initialize("");
    await replay.initialize("");
    await input("u1", "n10", "Original evidence stays exact.");
    const read = (await invoke("read_source", { nodeId: "n10" })) as SourceRead;
    const accepted = await invoke(
      "edit_source",
      change(read, (source) =>
        source.replace(
          "</Slide>",
          '<Text role="title">Original</Text></Slide>',
        ),
      ),
    );
    assert.equal(accepted.accepted, true);
    // This second mutation uses the full deck snapshot returned by the first commit, not a fresh read call.
    const second = await invoke(
      "edit_source",
      change(accepted.source, (source) =>
        source.replace(">Original</Text>", ">Revised</Text>"),
      ),
    );
    assert.equal(second.accepted, true);
    const created = await backend.createSlide("Later");
    operations.push({
      kind: "create",
      title: "Later",
      slideId: created.id,
      sourceSha256: local.engine.state().revision,
    });
    await input(
      "u2",
      created.id,
      "Evidence on the created slide survives history.",
    );
    await backend.navigate("n10");
    operations.push({
      kind: "navigate",
      slideId: "n10",
      sourceSha256: local.engine.state().revision,
    });
    for (const direction of ["undo", "redo"] as const) {
      const result = await backend.restoreHistory(direction);
      operations.push({
        kind: "history",
        direction,
        selectedSlideId: result.selectedId,
        sourceSha256: local.engine.state().revision,
      });
    }
    const badRead = (await invoke("read_source", {
      nodeId: "n10",
    })) as SourceRead;
    const refused = await invoke(
      "edit_source",
      change(badRead, (source) =>
        source.replace(">Revised</Text>", `>${"W".repeat(400)}</Text>`),
      ),
    );
    assert.equal(refused.accepted, false);
    const deckRead = (await invoke(
      "read_source",
      { nodeId: "deck" },
      context("n10", "fast"),
    )) as SourceRead;
    await assert.rejects(
      invoke(
        "edit_source",
        change(deckRead, (source) => source),
        context("n10", "fast"),
      ),
      /Fast edits only/,
    );
    await invoke("read_speaker_notes", { slideId: "n10" });
    // A completion callback may observe later source. Commit/read identities must remain authoritative.
    operations.find(
      (event) =>
        event.kind === "tool" &&
        event.name === "edit_source" &&
        event.result?.accepted,
    ).sourceSha256 = local.engine.state().revision;
    const firstReadIndex = operations.findIndex(
      (event) => event.kind === "tool" && event.name === "read_source",
    );
    operations.push(...operations.splice(firstReadIndex, 1));
    const duplicate = operations.find(event => event.kind === "input").input;
    await backend.deliverUtterance(duplicate);
    operations.push({ kind: "input", input: duplicate, sourceSha256: local.engine.state().revision });
    const recording = {
      initial,
      commits,
      operations,
      compatibility,
      provenance: "synthetic-test" as const,
    };
    const cassette = buildIntegratedTransactionCassette(recording);
    const result = await replayIntegratedTransactions(
      cassette,
      replay,
      compatibility,
    );
    assert.equal(result.actorReplay, false);
    assert.equal(result.coverage.commits, commits.length);
    assert.deepEqual(result.coverage.ignoredObservationTools, [
      "read_speaker_notes",
    ]);
    assert.equal(result.transactions.length, 2);
    assert.ok(result.snapshots.length >= 5);
    assert.ok(result.snapshots.every((pair) => pair.recorded !== pair.actual));
    assert.equal(
      fresh.engine.readDocument().source,
      local.engine.readDocument().source,
    );
    assert.equal((await fresh.engine.readiness()).ready, true);
    assert.throws(
      () =>
        buildIntegratedTransactionCassette({
          ...recording,
          operations: operations.filter((event) => event.kind !== "create"),
        }),
      /no recorded input, transaction or host operation/,
    );
    const altered = structuredClone(recording);
    altered.operations.find((event) => event.kind === "input").input.text =
      "Fabricated";
    assert.throws(
      () => buildIntegratedTransactionCassette(altered),
      /changed text or attribution/,
    );
    const broken = structuredClone(recording);
    broken.commits[1].beforeSourceSha = "0".repeat(64);
    assert.throws(
      () => buildIntegratedTransactionCassette(broken),
      /broken source\/sequence chain/,
    );
  } finally {
    unsubscribe();
    await backend.close();
    await replay.close();
    await local.close();
    await fresh.close();
    await rm(directory, { recursive: true, force: true });
  }
});
