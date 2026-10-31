/** Real five-slide fixture. Navigation is explicit harness input, never inferred from speech. */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { clientFromEnv, models } from "./config.js";
import { AssetStore } from "./assets.js";
import { ChromiumRenderer } from "./renderer.js";
import { FileLog } from "./log.js";
import { OpenAIDecider, OpenAISlowDecider, OpenAIModel } from "./openai.js";
import { SlideRuntime } from "./runtime.js";
import { LiveTranscription, readWav } from "./transcription.js";
const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(root, "test-fixture-5-slides.json"), "utf8"),
) as {
  slides: {
    number: number;
    title: string;
    text: string;
    startSample: number;
    endSample: number;
  }[];
};
const output = resolve(
  process.env.RUN_DIR ??
    join(
      root,
      "orchestration",
      "runs",
      `deck-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    ),
);
const log = new FileLog(output),
  assets = new AssetStore(join(output, "assets")),
  client = clientFromEnv(),
  selected = models();
const rt = await SlideRuntime.create({
  client,
  log,
  assets,
  renderer: new ChromiumRenderer(assets),
  model: new OpenAIModel(client, selected, log),
  decider: new OpenAIDecider(client, selected.decision, log),
  slowDecider: new OpenAISlowDecider(client, selected.decision, log),
  context:
    "Create a coherent presentation about the fictional campus library locker pilot. The harness manually navigates five planned topics. Keep each topic on its intended slide; later corrections may require refining past slides. Distinguish measured results, illustrative calculations, and proposed thresholds. Never navigate for the user.",
});
const pcm = readWav(readFileSync(join(root, "test-fixture-5-slides.wav"))).pcm;
const routed: { slideId: string; fixtureSlide: number; transcript?: string }[] =
  [];
let transcriber: LiveTranscription | undefined,
  failure: unknown,
  pausedPublication = false,
  pauseExercised = false;
let resumeTimer: ReturnType<typeof setTimeout> | undefined;
const started = performance.now();
rt.subscribe((e) => {
  if (e.type === "published" && rt.paused) pausedPublication = true;
  if (
    [
      "published",
      "slide_selected",
      "agent_error",
      "slow_decision_error",
      "work_paused",
      "work_resumed",
    ].includes(e.type)
  )
    console.log(
      JSON.stringify({
        elapsedMs: Math.round(performance.now() - started),
        ...e,
      }),
    );
  if (
    e.type === "speech_dispatched" &&
    routed.length === 3 &&
    !pauseExercised
  ) {
    pauseExercised = true;
    rt.pause();
    resumeTimer = setTimeout(() => rt.resume(), 600);
  }
});
const interrupt = () => {
  failure = new Error("Fixture interrupted");
  transcriber?.close();
  void rt.close();
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
function wavSegment(bytes: Buffer) {
  const h = Buffer.alloc(44);
  h.write("RIFF");
  h.writeUInt32LE(bytes.length + 36, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(24000, 24);
  h.writeUInt32LE(48000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(bytes.length, 40);
  return Buffer.concat([h, bytes]);
}
try {
  for (const slide of fixture.slides) {
    if (slide.number > 1) await rt.nextSlide();
    const slideId = rt.publisher.selectedId;
    const route = { slideId, fixtureSlide: slide.number, transcript: "" };
    routed.push(route);
    console.log(`Narrating fixture slide ${slide.number} into ${slideId}`);
    if (process.argv.includes("--text")) {
      const words = slide.text.split(/\s+/);
      for (let i = 1; i <= words.length; i++) {
        rt.receiveTranscript(words.slice(0, i).join(" "), i, slideId);
        await delay(100 / (Number(process.env.REPLAY_SPEED) || 1));
      }
      route.transcript = slide.text;
    } else {
      transcriber = new LiveTranscription(
        client,
        selected.transcription,
        (text, revision) => rt.receiveTranscript(text, revision, slideId),
        log,
      );
      await transcriber.connect();
      await transcriber.replay(
        wavSegment(pcm.subarray(slide.startSample * 2, slide.endSample * 2)),
        Number(process.env.REPLAY_SPEED) || 1,
      );
      route.transcript = transcriber.accumulator.text;
      transcriber.close();
      transcriber = undefined;
    }
    const gate = rt.gates.get(slideId)!;
    const deadline = performance.now() + 90000;
    while (
      gate.lastEvaluatedRevision !== gate.latest?.revision &&
      performance.now() < deadline
    )
      await delay(200);
    if (gate.lastEvaluatedRevision !== gate.latest?.revision)
      throw new Error(`Slide ${slide.number} final transcript not evaluated`);
    gate.close();
    if (slide.number === 4) {
      await rt.selectSlide(routed[2].slideId);
      await delay(200);
      await rt.selectSlide(slideId);
    }
  }
  await rt.settle(300000);
  if (process.argv.includes("--assets")) {
    rt.followupTask("slow", {
      task: "Create a focused specialist task to generate one useful opening-slide library locker illustration using image_generate (Flare 2.5), and another to create a reusable SVG or HTML component for the pickup workflow. Integrate both into the appropriate existing slides without changing selection. Use low image quality for this fixture. Finish once the assets are integrated and all cross-slide factual corrections are consistent.",
      facts:
        "No invented statistics or logos. Satisfaction must be 4.4, not 4.6. Participant count: 60 signed up, 48 completed.",
      slideId: routed[0].slideId,
    });
    await rt.settle(300000);
  }
  if (pausedPublication)
    throw new Error("A publication escaped the pause barrier");
} catch (e) {
  failure = e;
  console.error(e instanceof Error ? e.message : String(e));
} finally {
  clearTimeout(resumeTimer);
  transcriber?.close();
  const slides = rt.publisher.list();
  for (const [i, s] of slides.entries()) {
    writeFileSync(join(output, `slide-${i + 1}.html`), s.observation.source);
    writeFileSync(join(output, `slide-${i + 1}.png`), s.observation.screenshot);
  }
  const summary = {
    output,
    durationMs: performance.now() - started,
    mode: process.argv.includes("--text") ? "text" : "audio",
    routed,
    selectedId: rt.publisher.selectedId,
    pauseExercised,
    pausedPublication,
    slides: slides.map((s) => ({
      id: s.id,
      title: s.title,
      observationId: s.observation.id,
      diagnostics: s.observation.diagnostics,
    })),
    assets: assets.refs(),
    statuses: rt.statuses(),
    error: failure instanceof Error ? failure.message : failure,
  };
  writeFileSync(join(output, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
  await rt.close();
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
if (failure) process.exitCode = 1;
