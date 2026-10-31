/** Generate the five-slide spoken fixture; headings are metadata, never spoken. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { clientFromEnv } from "./config.js";

const root = fileURLToPath(new URL("../../fixtures/legacy/", import.meta.url));
const stem = "test-fixture-5-slides";
const script = readFileSync(join(root, `${stem}.txt`), "utf8");
const sections = [
  ...script.matchAll(
    /^# Slide (\d+): (.+)\n+([\s\S]*?)(?=^# Slide |$(?![\s\S]))/gm,
  ),
].map((match) => ({
  number: Number(match[1]),
  title: match[2],
  text: match[3].trim(),
}));
if (
  sections.length !== 5 ||
  sections.some((s, i) => s.number !== i + 1 || !s.text || s.text.length > 4096)
)
  throw new Error(
    "Expected five ordered, nonempty slide sections within the TTS input limit",
  );
const client = clientFromEnv();
const model = process.env.TTS_MODEL ?? "gpt-4o-mini-tts";
const voice = process.env.TTS_VOICE ?? "alloy";
const instructions =
  "Read the provided narration verbatim in natural English as one educator giving a clear, conversational presentation. Use a steady, unhurried pace. Keep the same calm voice throughout. Preserve all numbers, qualifications and spoken self-corrections exactly as written. Do not add an introduction, conclusion, slide number or heading. Pause briefly between paragraphs.";
const rate = 24000,
  bytesPerSample = 2,
  gapMs = 1200;
const gap = Buffer.alloc((rate * bytesPerSample * gapMs) / 1000);
const cache = fileURLToPath(new URL("../../.artifacts/legacy-tts/", import.meta.url));
mkdirSync(cache, { recursive: true });
const chunks: Buffer[] = [];
const timeline: Record<string, unknown>[] = [];
let samples = 0;
const layouts = [
  "Problem framing / before-and-after concept",
  "Three-step process + trial cohort",
  "Three comparison panels with distinct units",
  "Staffing scenario + limitations",
  "Four-week timeline + decision thresholds",
];
for (const section of sections) {
  const digest = createHash("sha256")
    .update(JSON.stringify({ text: section.text, model, voice, instructions }))
    .digest("hex");
  const cached = join(cache, `${digest}.pcm`);
  let pcm: Buffer;
  try {
    pcm = readFileSync(cached);
  } catch {
    console.log(`Generating slide ${section.number}: ${section.title}`);
    const response = await client.audio.speech.create(
      {
        model,
        voice,
        input: section.text,
        instructions,
        response_format: "pcm",
      },
      { timeout: 120000, maxRetries: 1 },
    );
    pcm = Buffer.from(await response.arrayBuffer());
    if (!pcm.length || pcm.length % bytesPerSample)
      throw new Error("Invalid PCM response");
    writeFileSync(cached, pcm);
  }
  const startSample = samples;
  chunks.push(pcm);
  samples += pcm.length / bytesPerSample;
  timeline.push({
    ...section,
    suggestedLayout: layouts[section.number - 1],
    startSample,
    endSample: samples,
    startMs: (startSample * 1000) / rate,
    endMs: (samples * 1000) / rate,
  });
  console.log(
    `Slide ${section.number}: ${((samples - startSample) / rate).toFixed(2)} seconds`,
  );
  if (section.number < 5) {
    chunks.push(gap);
    samples += gap.length / bytesPerSample;
  }
}
const pcm = Buffer.concat(chunks);
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(rate, 24);
header.writeUInt32LE(rate * bytesPerSample, 28);
header.writeUInt16LE(bytesPerSample, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);
const wav = Buffer.concat([header, pcm]);
writeFileSync(join(root, `${stem}.wav`), wav);
writeFileSync(
  join(root, `${stem}.json`),
  JSON.stringify(
    {
      title: "Library locker pickup: from pilot to a bounded extension",
      syntheticAudio: true,
      fictionalScenario: true,
      model,
      voice,
      instructions,
      audio: `${stem}.wav`,
      script: `${stem}.txt`,
      sampleRate: rate,
      channels: 1,
      bitsPerSample: 16,
      gapMs,
      durationMs: (samples * 1000) / rate,
      scriptSha256: createHash("sha256").update(script).digest("hex"),
      audioSha256: createHash("sha256").update(wav).digest("hex"),
      boundaryContract:
        "Each slide starts at startSample. endSample excludes the 1200 ms inter-slide silence. Headings are not spoken. Boundaries are test metadata used by fixture-deck.ts to drive explicit slide navigation; speech itself is not a navigation command.",
      expectedFinalFacts: {
        signedUp: 60,
        completed: 48,
        nonCompleters: 12,
        trialWeeks: 2,
        collectionMinutes: {
          before: 20,
          after: 5,
          saved: 15,
          reductionPercent: 75,
        },
        successfulFirstVisitPercent: {
          before: 80,
          after: 95,
          increasePercentagePoints: 15,
        },
        satisfactionOutOfFive: { before: 3.2, after: 4.4 },
        extraStaffMinutesPerDay: 30,
        illustrativeScenario: {
          collectionsPerDay: 10,
          studentMinutesSaved: 150,
          netMinutesSaved: 120,
          measuredVolume: false,
        },
        recommendation:
          "One-month extension limited to high-demand textbooks; proposed thresholds are not observed outcomes.",
      },
      correctionCases: [
        {
          spokenInSlide: 2,
          targetSlide: 2,
          incorrect: "60 completed",
          corrected: "60 signed up; 48 completed",
        },
        {
          spokenInSlide: 4,
          targetSlide: 3,
          incorrect: "4.6 satisfaction",
          corrected: "4.4 satisfaction; baseline 3.2 unchanged",
        },
      ],
      slides: timeline,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Saved ${stem}.wav and ${stem}.json: ${(samples / rate).toFixed(2)} seconds total`,
);
