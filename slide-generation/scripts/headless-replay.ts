import { parseArgs } from "node:util";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { createLocalRuntime } from "../src/runtime.js";
import { FileDeckRepository } from "../src/storage/repository.js";
import { JsxBackend } from "../src/host/jsx-backend.js";
import { lineHash } from "../src/hashline.js";
import { disableReplayNetwork } from "../src/evaluation/offline.js";
import { manifestSchema } from "../src/evaluation/manifest.js";
import type { ReplayCompatibility } from "../src/evaluation/replay.js";
import {
  buildIntegratedTransactionCassette,
  replayIntegratedTransactions,
} from "../src/headless/transaction-replay.js";
import { childNodes, parseAndValidate } from "../src/schema.js";
import type { RenderDependency } from "../src/render/types.js";
import {
  designSkillSnapshotSchema,
  validateDesignSkillSnapshot,
} from "../src/design/skills.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const dependencySchema = z.object({
  kind: z.enum([
    "font",
    "asset",
    "catalog",
    "renderer",
    "compiler",
    "contrast",
  ]),
  id: z.string(),
  version: z.string(),
  sha256: digest,
});
const configSchema = z
  .object({
    source: z.literal("real-actor-jsx-headless"),
    instructions: z.string(),
    promptSha256: digest,
    toolSchemaSha256: digest,
    initialDependencies: z.array(dependencySchema),
    designSkills: designSkillSnapshotSchema.optional(),
  })
  .passthrough();
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const sorted = (dependencies: RenderDependency[]) =>
  [...dependencies].sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b)),
  );
const stable = (value: unknown): string =>
  JSON.stringify(value, (_, child) =>
    child && typeof child === "object" && !Array.isArray(child)
      ? Object.fromEntries(
          Object.entries(child).sort(([a], [b]) => a.localeCompare(b)),
        )
      : child,
  );

export async function main(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      run: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean" },
    },
    strict: true,
  });
  if (values.help) {
    process.stdout.write(
      "Usage: headless-replay --run RECORDED_RUN_DIR --out NEW_ARTIFACT_DIR\nOffline canonical transaction replay; does not claim actor/model replay.\n",
    );
    return;
  }
  if (!values.run || !values.out)
    throw new Error(
      "Usage: headless-replay --run RECORDED_RUN_DIR --out NEW_ARTIFACT_DIR",
    );
  const recorded = resolve(values.run),
    out = resolve(values.out),
    inside = relative(join(root, ".artifacts"), out);
  if (!inside || inside.startsWith("..") || isAbsolute(inside))
    throw new Error(
      "Replay output must be a new directory below slide-generation/.artifacts",
    );
  if (recorded === out)
    throw new Error("Replay cannot overwrite its recording");
  await mkdir(dirname(out), { recursive: true });
  await mkdir(out);
  const network = disableReplayNetwork();
  let runtime: Awaited<ReturnType<typeof createLocalRuntime>> | undefined,
    backend: JsxBackend | undefined;
  try {
    const [manifest, configuration, initial, commits, operations] =
      await Promise.all([
        json(join(recorded, "manifest.json")).then((v) =>
          manifestSchema.parse(v),
        ),
        json(join(recorded, "configuration.json")).then((v) =>
          configSchema.parse(v),
        ),
        json(join(recorded, "initial.json")),
        json(join(recorded, "commits.json")),
        json(join(recorded, "operations.json")),
      ]);
    if (initial.schemaVersion !== 1 || typeof initial.source !== "string")
      throw new Error("Recorded initial deck is invalid");
    parseAndValidate(initial.source);
    if (lineHash(configuration.instructions) !== configuration.promptSha256)
      throw new Error(
        "Recorded instructions differ from their configuration hash",
      );
    const currentInstructions =
      (await readFile(join(root, "docs/AGENT_PROMPT.md"), "utf8")) +
      "\n\n" +
      (await readFile(join(root, "SPEC.md"), "utf8"));
    const currentPromptSha = lineHash(currentInstructions),
      promptMatches = currentPromptSha === configuration.promptSha256;
    // Transaction replay does not infer. A changed prompt is recorded, never passed off as actor compatibility.
    const lockSha = lineHash(
      await readFile(join(root, "package-lock.json"), "utf8"),
    );
    if (lockSha !== manifest.lockSha256)
      throw new Error("Replay dependency lock differs from recorded run");
    await new FileDeckRepository(join(out, "runtime/deck.json")).initialize(
      initial,
    );
    runtime = await createLocalRuntime({ directory: join(out, "runtime") });
    const toolSha = lineHash(JSON.stringify(runtime.tools.definitions()));
    if (toolSha !== configuration.toolSchemaSha256)
      throw new Error(
        "Current tool schema differs from the recorded generation contract",
      );
    const expectedDependencies = new Map<string, RenderDependency>();
    const verify = async (
      source: string,
      slideId: string,
      expected: RenderDependency[],
    ) => {
      const artifact = await runtime!.renderer.render(source, slideId);
      if (stable(sorted(artifact.dependencies)) !== stable(sorted(expected)))
        throw new Error(
          `Resolved dependency bytes/versions differ for ${slideId} at ${lineHash(source)}`,
        );
      for (const dep of expected) {
        const key = `${dep.kind}:${dep.id}:${dep.version}`,
          previous = expectedDependencies.get(key);
        if (previous && previous.sha256 !== dep.sha256)
          throw new Error(`Recorded dependency identity changes bytes: ${key}`);
        expectedDependencies.set(key, dep);
      }
    };
    const first = childNodes(parseAndValidate(initial.source)).find(
      (n) => n.tag === "Slide",
    );
    if (!first) throw new Error("Initial source has no slide");
    await verify(initial.source, first.id!, configuration.initialDependencies);
    let verifiedArtifacts = 1;
    for (const filename of (await readdir(join(recorded, "states")))
      .filter((name) => name.endsWith(".json"))
      .sort()) {
      const state = await json(join(recorded, "states", filename));
      if (
        typeof state.source !== "string" ||
        lineHash(state.source) !== state.revision ||
        !Array.isArray(state.renders)
      )
        throw new Error(`Invalid recorded state artifact ${filename}`);
      for (const render of state.renders) {
        const dependencies = z
          .array(dependencySchema)
          .parse(JSON.parse(render.dependenciesJson));
        await verify(state.source, render.slideId, dependencies);
        verifiedArtifacts++;
      }
    }
    const dependencies = [...expectedDependencies.values()].filter(
      (dep): dep is RenderDependency & { kind: "font" | "asset" | "catalog" } =>
        ["font", "asset", "catalog"].includes(dep.kind),
    );
    const recordedCompatibility: ReplayCompatibility = {
      protocol: "hashline-replay-v1",
      sourceSchema: 1,
      toolSchemaSha256: configuration.toolSchemaSha256,
      promptSha256: configuration.promptSha256,
      dependencies,
    };
    const currentCompatibility = {
      ...recordedCompatibility,
      toolSchemaSha256: toolSha,
      promptSha256: currentPromptSha,
    };
    const cassette = buildIntegratedTransactionCassette({
      initial,
      commits,
      operations,
      compatibility: recordedCompatibility,
      provenance:
        manifest.mode === "live" ? "recorded-model" : "synthetic-test",
    });
    await writeFile(
      join(out, "transaction-cassette.json"),
      JSON.stringify(cassette, null, 2),
    );
    backend = new JsxBackend(runtime, {
      instructions: configuration.instructions,
      designSkills:
        configuration.designSkills === undefined
          ? undefined
          : validateDesignSkillSnapshot(configuration.designSkills),
    });
    await backend.initialize(initial.source);
    const result = await replayIntegratedTransactions(
      cassette,
      backend,
      currentCompatibility,
    );
    const readiness = await runtime.engine.readiness(),
      final = runtime.engine.readDocument();
    const recordedFinal = await json(join(recorded, "final/deck.json"));
    if (stable(final) !== stable(recordedFinal))
      throw new Error("Replay final deck differs from recorded final export");
    await writeFile(join(out, "final-deck.jsx"), final.source);
    await writeFile(
      join(out, "final-deck.json"),
      JSON.stringify(final, null, 2),
    );
    await writeFile(
      join(out, "readiness.json"),
      JSON.stringify(readiness, null, 2),
    );
    const report = {
      passed: true,
      recordedRun: recorded,
      result,
      readiness,
      offline: network.evidence(),
      compatibility: {
        toolSchemaMatches: true,
        lockMatches: true,
        configInstructionsIntegrity: true,
        promptMatches,
        promptChangeAllowedForTransactionOnly: !promptMatches,
        verifiedArtifacts,
        dependencies: [...expectedDependencies.values()],
      },
      sourceSha: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      dirty:
        execFileSync("git", ["status", "--porcelain"], {
          cwd: root,
          encoding: "utf8",
        }).trim().length > 0,
      actorReplay: false,
      liveLatencyEvidence: false,
    };
    await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
    process.stdout.write(
      JSON.stringify({
        directory: out,
        passed: true,
        sourceSha256: result.sourceSha256,
        steps: result.steps,
        ready: readiness.ready,
        actorReplay: false,
      }) + "\n",
    );
    return report;
  } catch (error) {
    await writeFile(
      join(out, "failure.json"),
      JSON.stringify(
        {
          passed: false,
          error: String(error),
          offline: network.evidence(),
          actorReplay: false,
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    try {
      await backend?.close();
      await runtime?.close();
    } finally {
      network.restore();
    }
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(String(error) + "\n");
    process.exitCode = 1;
  });
