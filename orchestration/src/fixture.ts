import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { clientFromEnv, models } from "./config.js";
import { FileLog } from "./log.js";
import { AssetStore } from "./assets.js";
import { ChromiumRenderer } from "./renderer.js";
import { OpenAIDecider, OpenAIModel } from "./openai.js";
import { SlideRuntime } from "./runtime.js";
import { LiveTranscription, readWav } from "./transcription.js";
const root = fileURLToPath(new URL("../../", import.meta.url));
const output = resolve(
  process.env.RUN_DIR ??
    join(
      root,
      "orchestration",
      "runs",
      new Date().toISOString().replace(/[:.]/g, "-"),
    ),
);
mkdirSync(output, { recursive: true });
const client = clientFromEnv(),
  selected = models(),
  log = new FileLog(output),
  assets = new AssetStore(join(output, "assets"));
// Verify connectivity before consuming the audio; this also warms the HTTP connection.
await client.models.retrieve(selected.decision, {
  timeout: 30000,
  maxRetries: 1,
});
const runtime = await SlideRuntime.create({
  client,
  assets,
  log,
  model: new OpenAIModel(client, selected, log),
  decider: new OpenAIDecider(client, selected.decision, log),
  renderer: new ChromiumRenderer(assets),
  context:
    "Create one slide explaining a fictional campus library locker pickup pilot for a student audience. Narration is the sole source of factual claims.",
});
const start = performance.now();
runtime.subscribe((event) => {
  if (["published", "agent_error", "speech_dispatched"].includes(event.type))
    console.log(
      JSON.stringify({
        elapsedMs: Math.round(performance.now() - start),
        ...event,
      }),
    );
});
let transcriber: LiveTranscription | undefined;
let failure: unknown;
const interrupt = () => {
  failure = new Error("Fixture interrupted");
  transcriber?.close();
  void runtime.close();
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
try {
  if (process.argv.includes("--text")) {
    const words = readFileSync(join(root, "test-fixture.txt"), "utf8")
      .split(/\s+/)
      .filter(Boolean);
    let text = "";
    for (let i = 0; i < words.length; i++) {
      text += (i ? " " : "") + words[i];
      runtime.receiveTranscript(text, i + 1);
      await delay(250 / (Number(process.env.REPLAY_SPEED) || 1));
    }
  } else {
    const wav = readFileSync(join(root, "test-fixture.wav"));
    console.log(
      JSON.stringify({
        output,
        audioDurationMs: readWav(wav).durationMs,
        models: selected,
      }),
    );
    transcriber = new LiveTranscription(
      client,
      selected.transcription,
      (text, revision) => runtime.receiveTranscript(text, revision),
      log,
    );
    await transcriber.connect();
    await transcriber.replay(wav, Number(process.env.REPLAY_SPEED) || 1);
    writeFileSync(join(output, "transcript.txt"), transcriber.accumulator.text);
  }
  // Allow the gate to consider the last partial/final update; never force a dispatch.
  const gateDeadline = performance.now() + 90000;
  while (
    runtime.gate.lastEvaluatedRevision !== runtime.gate.latest?.revision &&
    performance.now() < gateDeadline
  )
    await delay(200);
  if (runtime.gate.lastEvaluatedRevision !== runtime.gate.latest?.revision)
    throw new Error(
      "Final transcript was not evaluated by the decision gate before the deadline",
    );
  runtime.gate.close();
  await runtime.settle(240000);
} catch (e) {
  failure = e;
  console.error(e instanceof Error ? e.message : String(e));
} finally {
  transcriber?.close();
  const final = runtime.publisher.current;
  writeFileSync(join(output, "final.html"), final.source);
  writeFileSync(join(output, "final.png"), final.screenshot);
  const summary = {
    output,
    models: selected,
    durationMs: Math.round(performance.now() - start),
    publications: runtime.events.filter((e) => e.type === "published").length,
    statuses: runtime.statuses(),
    transcriptRevision: runtime.gate.latest?.revision,
    dispatchedRevision: runtime.gate.lastDispatched?.revision,
    evaluatedRevision: runtime.gate.lastEvaluatedRevision,
    diagnostics: final.diagnostics,
    error: failure instanceof Error ? failure.message : failure,
  };
  writeFileSync(join(output, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  await runtime.close();
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
if (failure) process.exitCode = 1;
