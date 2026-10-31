/** Re-run recorded real model edits through the current merge/renderer implementation. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { AssetStore } from "./assets.js";
import { ChromiumRenderer } from "./renderer.js";
import { Publisher, type Branch } from "./publisher.js";
const directory = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Pass a completed run directory");
const rows = readFileSync(join(directory, "events.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((s) => JSON.parse(s));
const assets = new AssetStore(),
  publisher = new Publisher(new ChromiumRenderer(assets));
const branches = new Map<string, Branch>(),
  active = new Map<string, string>(),
  calls = new Map<string, { old: string; new: string }>();
const failures: unknown[] = [];
let edits = 0;
try {
  const initial = rows.find((r) => r.type === "observation");
  await publisher.initialize(
    readFileSync(join(directory, `${initial.id}.html`), "utf8"),
  );
  for (const row of rows) {
    if (row.type === "message_queued") {
      try {
        const artifact = JSON.parse(row.message.text);
        if (artifact.mediaType && artifact.content) {
          const ref = assets.put(
            artifact.mediaType,
            Buffer.from(artifact.content),
          );
          if (ref !== artifact.ref) throw new Error("Artifact digest mismatch");
        }
      } catch (e) {
        if (e instanceof Error && e.message === "Artifact digest mismatch")
          throw e;
      }
    }
    if (row.type === "inference") {
      branches.set(row.id, {
        historyEpoch: publisher.historyEpoch,
        id: row.id,
        agent: row.agent,
        role: row.role,
        source: row.source,
        speech: row.speech,
      });
      active.set(row.agent, row.id);
    }
    if (row.type === "model_response")
      for (const output of row.output)
        if (output.type === "function_call" && output.name === "edit")
          calls.set(
            `${active.get(row.agent)}:${output.call_id}`,
            JSON.parse(output.arguments),
          );
    if (row.type === "tool_result" && row.name === "edit") {
      const branch = branches.get(row.inference)!,
        edit = calls.get(`${row.inference}:${row.callId}`)!;
      const actual = await publisher.edit(branch, row.callId, edit);
      edits++;
      const expectedSource = readFileSync(
        join(directory, `${row.output.observationId}.html`),
        "utf8",
      );
      if (
        actual.outcome !== row.output.outcome ||
        actual.current.source !== expectedSource
      )
        failures.push({
          call: row.callId,
          expected: row.output.outcome,
          actual: actual.outcome,
          diagnostics: actual.diagnostics,
        });
    }
  }
  const result = {
    edits,
    passed: failures.length === 0,
    failures,
    finalMatches:
      publisher.current.source ===
      readFileSync(join(directory, "final.html"), "utf8"),
  };
  writeFileSync(
    join(directory, "publication-replay.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed || !result.finalMatches) process.exitCode = 1;
} finally {
  await publisher.close();
}
