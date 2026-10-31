import test from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import {
  OpenAIPracticeReviewer,
  OpenAIPracticeTranscriber,
} from "../src/practice/openai.js";
import type { ReviewContext } from "../src/practice/contracts.js";
const empty = { summary: "No changes", feedback: [], proposals: [] };
const context = {
  version: 1,
  practiceId: "p",
  instructions: "Be conservative",
  brief: { audience: "Students" },
  baseline: { source: "exact JSX", revision: "r", reads: [] },
  slides: [],
  speech: [],
  speechHistory: [],
  events: [],
  visits: [],
  priorDecks: [],
  measurements: {
    id: "timing-summary",
    durationMs: 1000,
    pausedMs: 0,
    wordCount: 0,
    approximateWordsPerMinute: 0,
    caveat: "No prosody evidence",
  },
  evidence: [{ id: "timing-summary", kind: "measurement" }],
  images: [
    {
      slideId: "n10",
      sourceRevision: "r",
      jpeg: Buffer.from("image").toString("base64"),
    },
  ],
} satisfies ReviewContext;
test("review adapter sends complete front-loaded context and actual images, no tools, structured native edits, Fast tier", async () => {
  let body: any;
  const client = new OpenAI({
    apiKey: "test",
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: "resp",
          object: "response",
          created_at: 1,
          status: "completed",
          output: [
            {
              type: "message",
              id: "m",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(empty),
                  annotations: [],
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  assert.deepEqual(
    await new OpenAIPracticeReviewer(client).review({
      context,
      signal: new AbortController().signal,
    }),
    empty,
  );
  assert.equal(body.service_tier, "fast");
  assert.equal(body.reasoning.effort, "medium");
  assert.equal(body.tools, undefined);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.equal(body.input[0].content[1].type, "input_text");
  assert.match(body.input[0].content[2].image_url, /^data:image\/jpeg;base64,/);
  const packet = JSON.parse(body.input[0].content[0].text).context;
  assert.equal(packet.baseline.source, "exact JSX");
  assert.equal(packet.images, undefined);
});
test("review adapter rejects truncated output instead of returning partial proposals", async () => {
  const client = {
    responses: {
      async create() {
        return { status: "incomplete", output_text: JSON.stringify(empty) };
      },
    },
  } as unknown as OpenAI;
  await assert.rejects(
    new OpenAIPracticeReviewer(client).review({
      context,
      signal: new AbortController().signal,
    }),
    /incomplete/,
  );
});
test("end-pass transcription uses timestamped WAV and converts segment seconds to milliseconds", async () => {
  let args: any;
  const client = {
    audio: {
      transcriptions: {
        async create(input: any) {
          args = input;
          return { segments: [{ start: 0.2, end: 0.9, text: "Hello" }] };
        },
      },
    },
  } as unknown as OpenAI;
  const result = await new OpenAIPracticeTranscriber(client).transcribe(
    Buffer.alloc(48000),
    new AbortController().signal,
  );
  assert.deepEqual(result, [{ startMs: 200, endMs: 900, text: "Hello" }]);
  assert.equal(args.model, "whisper-1");
  assert.equal(args.response_format, "verbose_json");
  const bytes = Buffer.from(await args.file.arrayBuffer());
  assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
  assert.equal(bytes.length, 48044);
});
