import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createLocalRuntime } from "../src/runtime.js";
import { lineHash } from "../src/hashline.js";

const exec = promisify(execFile);
test("headless replay CLI consumes recorded run files, blocks network and refuses changed tool contracts", async () => {
  await mkdir(".artifacts/tests", { recursive: true });
  const directory = await mkdtemp(".artifacts/tests/headless-replay-cli-"),
    recorded = resolve(directory, "recorded");
  await mkdir(recorded);
  await mkdir(join(recorded, "states"));
  await mkdir(join(recorded, "final"));
  const local = await createLocalRuntime({
    directory: join(recorded, "runtime"),
  });
  try {
    const initial = local.engine.readDocument(),
      commits: unknown[] = [];
    let before = lineHash(initial.source);
    const unsubscribe = local.engine.subscribe((event) => {
      commits.push({
        kind: "commit",
        sequence: commits.length,
        beforeSourceSha: before,
        afterSourceSha: event.revision,
        source: event.document.source,
        reason: event.reason,
        transactionId: event.transactionId,
      });
      before = event.revision;
    });
    const instructions =
      (await readFile("docs/AGENT_PROMPT.md", "utf8")) +
      "\n\n" +
      (await readFile("SPEC.md", "utf8"));
    const artifact = await local.renderer.render(initial.source, "n10");
    const configuration = {
      source: "real-actor-jsx-headless",
      instructions,
      promptSha256: lineHash(instructions),
      toolSchemaSha256: lineHash(JSON.stringify(local.tools.definitions())),
      initialDependencies: artifact.dependencies,
    };
    const input = {
      id: "cli-original",
      text: "The exact words remain.",
      slideId: "n10",
      deliveredAtMs: 100,
    };
    await local.engine.ingest(input);
    await local.engine.settledInput();
    unsubscribe();
    const final = local.engine.readDocument();
    const manifest = {
      schemaVersion: 1,
      sourceSha: "0".repeat(40),
      dirty: true,
      nodeVersion: process.version,
      platform: process.platform,
      startedAt: new Date().toISOString(),
      lockSha256: lineHash(await readFile("package-lock.json", "utf8")),
      promptSha256: lineHash(instructions),
      fixtureSha256: "0".repeat(64),
      dependencies: [],
      mode: "transaction-replay",
    };
    const files: Record<string, unknown> = {
      "initial.json": initial,
      "configuration.json": configuration,
      "manifest.json": manifest,
      "commits.json": commits,
      "operations.json": [
        { kind: "input", input, sourceSha256: lineHash(final.source) },
      ],
      "final/deck.json": final,
    };
    await Promise.all(
      Object.entries(files).map(([name, value]) =>
        writeFile(join(recorded, name), JSON.stringify(value)),
      ),
    );
    const output = resolve(directory, "replayed");
    await exec(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/headless-replay.ts",
        "--run",
        recorded,
        "--out",
        output,
      ],
      { timeout: 20_000 },
    );
    const report = JSON.parse(
      await readFile(join(output, "report.json"), "utf8"),
    );
    assert.equal(report.passed, true);
    assert.equal(report.actorReplay, false);
    assert.equal(report.result.provenance, "synthetic-test");
    assert.equal(report.readiness.ready, true);
    assert.equal(report.offline.nodeNetworkDisabled, true);
    assert.equal(report.offline.browserRequestsAbortedByCheckPipeline, true);
    assert.equal(report.offline.blockedAttempts, 0);
    assert.equal(
      await readFile(join(output, "final-deck.jsx"), "utf8"),
      final.source,
    );
    configuration.toolSchemaSha256 = "0".repeat(64);
    await writeFile(
      join(recorded, "configuration.json"),
      JSON.stringify(configuration),
    );
    const refused = resolve(directory, "refused");
    await assert.rejects(
      exec(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/headless-replay.ts",
          "--run",
          recorded,
          "--out",
          refused,
        ],
        { timeout: 20_000 },
      ),
      /tool schema differs/,
    );
    assert.equal(
      JSON.parse(await readFile(join(refused, "failure.json"), "utf8")).passed,
      false,
    );
  } finally {
    await local.close();
    await rm(directory, { recursive: true, force: true });
  }
});
