import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalRuntime } from "../src/runtime.js";
import { FileDeckRepository } from "../src/storage/repository.js";
import { JsxBackend } from "../src/host/jsx-backend.js";
import { disableReplayNetwork } from "../src/evaluation/offline.js";
import { lineHash } from "../src/hashline.js";
import { replayRecordedActors } from "../src/headless/actor-replay.js";
import { main as replayTransactions } from "./headless-replay.js";
import { validateDesignSkillSnapshot } from "../src/design/skills.js";
const { values } = parseArgs({
  options: { run: { type: "string" }, out: { type: "string" } },
  strict: true,
});
if (!values.run || !values.out)
  throw new Error(
    "Usage: headless-actor-replay --run RECORDED_RUN_DIR --out NEW_ARTIFACT_DIR",
  );
const root = fileURLToPath(new URL("../", import.meta.url)),
  recorded = resolve(values.run),
  out = resolve(values.out),
  inside = relative(join(root, ".artifacts"), out);
if (!inside || inside.startsWith("..") || isAbsolute(inside))
  throw new Error("Output must be new under slide-generation/.artifacts");
await mkdir(dirname(out), { recursive: true });
await mkdir(out);
const network = disableReplayNetwork();
let local: Awaited<ReturnType<typeof createLocalRuntime>> | undefined;
const json = async (name: string) =>
  JSON.parse(await readFile(join(recorded, name), "utf8"));
try {
  await replayTransactions([
    "--run",
    recorded,
    "--out",
    join(out, "transaction-preflight"),
  ]);
  const [
    initial,
    configuration,
    providers,
    commits,
    operations,
    final,
    manifest,
  ] = await Promise.all(
    [
      "initial.json",
      "configuration.json",
      "provider-cassette.json",
      "commits.json",
      "operations.json",
      "final/deck.json",
      "manifest.json",
    ].map(json),
  );
  if (lineHash(configuration.instructions) !== configuration.promptSha256)
    throw new Error("Recorded instructions hash differs");
  const currentInstructions = await readFile(
    join(root, "docs/AGENT_PROMPT.md"), "utf8",
  );
  if (currentInstructions !== configuration.instructions)
    throw new Error("Unsupported recorded actor prompt: current instructions differ; historical requests are not rewritten");
  if (
    lineHash(await readFile(join(root, "package-lock.json"), "utf8")) !==
    manifest.lockSha256
  )
    throw new Error("Recorded dependency lock differs");
  const scheduler = (await readFile(join(recorded, "scheduler.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const firstInference = scheduler.find((event) => event.type === "inference");
  const initialBoundaries = (firstInference?.input ?? []).flatMap((item: any) => {
    if (item.role !== "user" || typeof item.content !== "string") return [];
    try {
      const value = JSON.parse(item.content);
      return value?.kind === "current_boundary" ? [value] : [];
    } catch {
      return []; // Observation text and archived evidence are not boundary envelopes.
    }
  });
  if (initialBoundaries.length !== 1 || typeof initialBoundaries[0].context !== "string")
    throw new Error("Unsupported initial actor boundary: expected one current_boundary with string context; historical requests are not rewritten");
  const initialContext = initialBoundaries[0].context;
  await new FileDeckRepository(join(out, "runtime/deck.json")).initialize(
    initial,
  );
  local = await createLocalRuntime({ directory: join(out, "runtime") });
  if (
    lineHash(JSON.stringify(local.tools.definitions())) !==
    configuration.toolSchemaSha256
  )
    throw new Error("Recorded tool schema differs");
  const backend = new JsxBackend(local, {
    instructions: configuration.instructions,
    designSkills:
      configuration.designSkills === undefined
        ? undefined
        : validateDesignSkillSnapshot(configuration.designSkills),
  });
  const result = await replayRecordedActors(
    {
      initialSource: initial.source,
      finalSourceSha256: lineHash(final.source),
      initialContext,
      models: configuration.models,
      providers,
      commits,
      operations,
      scheduler,
    },
    backend,
  );
  const readiness = await local.engine.readiness();
  await writeFile(
    join(out, "report.json"),
    JSON.stringify(
      {
        passed: true,
        result,
        readiness,
        dependencyVerification: "transaction-preflight/report.json",
        offline: network.evidence(),
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(out, "final-deck.jsx"),
    local.engine.readDocument().source,
  );
  process.stdout.write(
    JSON.stringify({ directory: out, passed: true, ...result }) + "\n",
  );
} catch (error) {
  await writeFile(
    join(out, "failure.json"),
    JSON.stringify(
      { passed: false, error: String(error), offline: network.evidence() },
      null,
      2,
    ),
  );
  process.stderr.write(String(error) + "\n");
  process.exitCode = 1;
} finally {
  try {
    await local?.close();
  } finally {
    network.restore();
  }
}
