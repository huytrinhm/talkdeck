import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import OpenAI from "openai";
import { createLocalRuntime } from "../src/runtime.js";
import { JsxBackend } from "../src/host/jsx-backend.js";
import { SlideRuntime } from "../src/orchestration/runtime.js";
import { createRecordedModels } from "../src/headless/models.js";
import {
  replayRecordedActors,
  type ActorReplayRecording,
} from "../src/headless/actor-replay.js";
import { disableReplayNetwork } from "../src/evaluation/offline.js";
import { lineHash } from "../src/hashline.js";

const models = {
  fast: "gpt-6-luna",
  slow: "gpt-6-sol",
  specialist: "gpt-6-sol",
  decision: "gpt-6-luna",
};
test("recorded-event replay executes actual actors, gates, SDK requests and Chromium; changed context/results fail closed", async () => {
  await mkdir(".artifacts/tests", { recursive: true });
  const directory = await mkdtemp(".artifacts/tests/actor-replay-");
  const local = await createLocalRuntime({
    directory: resolve(directory, "recorded"),
  });
  const commits: ActorReplayRecording["commits"] = [],
    operations: any[] = [],
    scheduler: any[] = [];
  const initial = local.engine.readDocument(), initialSource = initial.source;
  const instructions = await readFile("docs/AGENT_PROMPT.md", "utf8");
  let before = lineHash(initialSource),
    responseNumber = 0;
  const unsubscribe = local.engine.subscribe((event) => {
    commits.push({
      sequence: commits.length,
      atMs: performance.now(),
      beforeSourceSha: before,
      afterSourceSha: event.revision,
      source: event.document.source,
      reason: event.reason,
      transactionId: event.transactionId,
    });
    before = event.revision;
  });
  const backend = new JsxBackend(local, {
    instructions,
    onTool: (event) => {
      operations.push({
        kind: "tool",
        ...event,
        sourceSha256: local.engine.state().revision,
      });
    },
  });
  const providers = createRecordedModels(
    new OpenAI({ apiKey: "synthetic-no-network", maxRetries: 0 }),
    { async model() {} },
    {
      models,
      transport: async (url, init) => {
        const request = JSON.parse(String(init?.body));
        if (String(url).endsWith("/decisions")) {
          const name = request.questions[0].name;
          return new Response(
            JSON.stringify({
              answers: [
                {
                  name,
                  type: "choice",
                  choice: name === "speech_dispatch" ? "dispatch" : "hold",
                },
              ],
              usage: { input_tokens: 1, output_tokens: 0 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        const prior = request.input.filter(
          (item: any) => item.type === "function_call_output",
        );
        let name = "finish",
          args: unknown = {};
        if (!prior.length) {
          name = "read_source";
          args = { nodeId: "n10" };
        } else if (prior.length === 1) {
          const read = JSON.parse(prior[0].output);
          name = "edit_source";
          args = {
            edits: [
              {
                snapshotId: read.snapshotId,
                nodeId: read.nodeId,
                op: "replace",
                startLine: 1,
                hashes: read.lines.map((line: any) => line.hash),
                text: read.lines
                  .map((line: any) => line.text)
                  .join("\n")
                  .replace(
                    "</Slide>",
                    '<Text role="title">Replay preserves this claim</Text></Slide>',
                  ),
              },
            ],
          };
        }
        const number = ++responseNumber;
        return new Response(
          JSON.stringify({
            id: `response-${number}`,
            status: "completed",
            model: request.model,
            service_tier: "fast",
            output: [
              {
                type: "function_call",
                call_id: `call-${number}`,
                name,
                arguments: JSON.stringify(args),
              },
            ],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  );
  const actor = await SlideRuntime.create({
    backend,
    ...providers,
    autoTick: false,
    context: "Original context",
    log: {
      write(type, data) {
        scheduler.push({ type, atMs: performance.now(), ...data });
      },
      observation() {},
    },
  });
  let network: ReturnType<typeof disableReplayNetwork> | undefined;
  try {
    const input = {
      id: "recorded-input&special",
      slideId: "n10",
      text: "The original exact claim.",
      deliveredAtMs: performance.now(),
    };
    await actor.deliverUtterance(input);
    operations.push({
      kind: "input",
      input,
      sourceSha256: local.engine.state().revision,
    });
    await actor.gate.tick();
    await actor.settle(30000);
    const recording: ActorReplayRecording = {
      initialSource,
      finalSourceSha256: lineHash(local.engine.readDocument().source),
      initialContext: "Original context",
      models,
      providers: {
        ...providers.replayCassette(),
        provenance: "synthetic-test",
      },
      commits,
      operations,
      scheduler,
    };
    await actor.close();
    unsubscribe();
    // Exercise the actual CLI on a new-protocol recording, including disk loading,
    // context extraction and transaction preflight, not only the replay function.
    const recorded = resolve(directory, "cli-recording"), cliOutput = resolve(directory, "cli-output");
    await mkdir(join(recorded, "states"), { recursive: true });
    await mkdir(join(recorded, "final"));
    const artifact = await local.renderer.render(initialSource, "n10");
    const files: Record<string, unknown> = {
      "initial.json": initial,
      "final/deck.json": local.engine.readDocument(),
      "configuration.json": {
        source: "real-actor-jsx-headless", instructions, models,
        promptSha256: lineHash(instructions),
        toolSchemaSha256: lineHash(JSON.stringify(local.tools.definitions())),
        initialDependencies: artifact.dependencies,
      },
      "manifest.json": {
        schemaVersion: 1, sourceSha: "0".repeat(40), dirty: true,
        nodeVersion: process.version, platform: process.platform,
        startedAt: new Date().toISOString(),
        lockSha256: lineHash(await readFile("package-lock.json", "utf8")),
        promptSha256: lineHash(instructions), fixtureSha256: "0".repeat(64),
        dependencies: [], mode: "transaction-replay",
      },
      "provider-cassette.json": recording.providers,
      "commits.json": commits.map(commit => ({ kind: "commit", ...commit })),
      "operations.json": operations,
    };
    await Promise.all(Object.entries(files).map(([name, value]) =>
      writeFile(join(recorded, name), JSON.stringify(value))));
    await writeFile(join(recorded, "scheduler.jsonl"), scheduler.map(value => JSON.stringify(value)).join("\n"));
    const originalCassette = await readFile(join(recorded, "provider-cassette.json"), "utf8");
    await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/headless-actor-replay.ts",
      "--run", recorded, "--out", cliOutput], { timeout: 60_000 });
    const cliReport = JSON.parse(await readFile(join(cliOutput, "report.json"), "utf8"));
    assert.equal(cliReport.passed, true);
    assert.equal(cliReport.result.actorReplay, true);
    assert.equal(cliReport.result.exactProviderRequests, recording.providers.records.length);
    assert.equal(cliReport.offline.blockedAttempts, 0);
    assert.equal(await readFile(join(cliOutput, "final-deck.jsx"), "utf8"), local.engine.readDocument().source);
    assert.equal(await readFile(join(recorded, "provider-cassette.json"), "utf8"), originalCassette);
    network = disableReplayNetwork();
    let counter = 0;
    const run = async (value: ActorReplayRecording) => {
      const replay = await createLocalRuntime({
        directory: resolve(directory, `replayed-${++counter}`),
      });
      const target = new JsxBackend(replay, {
        instructions,
      });
      try {
        return await replayRecordedActors(value, target);
      } finally {
        await target.close();
        await replay.close();
      }
    };
    const result = await run(recording);
    assert.equal(result.actorReplay, true);
    assert.equal(result.sourceSha256, recording.finalSourceSha256);
    assert.equal(result.exactProviderRequests, providers.records().length);
    assert.equal(result.verifiedCommits, 2);
    assert.equal(result.verifiedTools, 3);
    assert.equal(result.transactions.length, 1);
    assert.ok(result.snapshots.every((pair) => pair.recorded !== pair.actual));
    assert.equal(result.coverage.liveLatencyEvidence, false);
    const contextChanged = structuredClone(recording);
    contextChanged.initialContext += " changed";
    await assert.rejects(run(contextChanged), /literal request differs/);
    const speechChanged = structuredClone(recording);
    const changedDecision = speechChanged.providers.records.find(
      (entry) => entry.role === "decision",
    )!;
    const changedRequest = JSON.parse(changedDecision.requestBody);
    const changedProjection = JSON.parse(changedRequest.input[0].content[0].text);
    changedProjection.current_transcript = "Unrecorded claim";
    changedRequest.input[0].content[0].text = JSON.stringify(changedProjection);
    changedDecision.requestBody = JSON.stringify(changedRequest);
    await assert.rejects(run(speechChanged), /Decision current_transcript differs/);
    const oldProtocol = structuredClone(recording);
    const oldDecision = oldProtocol.providers.records.find(
      (entry) => entry.role === "decision",
    )!;
    const oldRequest = JSON.parse(oldDecision.requestBody);
    oldRequest.input = JSON.stringify({ speech: changedProjection.speech });
    oldDecision.requestBody = JSON.stringify(oldRequest);
    const preservedRequest = oldDecision.requestBody;
    await assert.rejects(run(oldProtocol), /Unsupported recorded speech decision boundary/);
    assert.equal(oldDecision.requestBody, preservedRequest);
    const resultChanged = structuredClone(recording);
    resultChanged.operations.find(
      (o) => o.kind === "tool" && o.name === "read_source",
    ).result.lines[0].hash = "0".repeat(64);
    await assert.rejects(run(resultChanged), /every hash|differs/);
    const unsupported = structuredClone(recording);
    unsupported.operations.push({
      kind: "pause",
      sourceSha256: recording.finalSourceSha256,
    });
    await assert.rejects(run(unsupported), /unsupported control\/image/);
    const deckRequest = structuredClone(recording);
    deckRequest.scheduler.push({
      type: "tool_result",
      name: "request_deck_edit",
    });
    await assert.rejects(run(deckRequest), /specialist\/task identity/);
    assert.equal(network.evidence().blockedAttempts, 0);
  } finally {
    await actor.close();
    unsubscribe();
    network?.restore();
    await local.close();
    await rm(directory, { recursive: true, force: true });
  }
});
