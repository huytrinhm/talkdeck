import test from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import {
  OpenAIPracticeReviewer,
  OpenAIPracticeTranscriber,
} from "../src/practice/openai.js";
import type {
  PreparedProposal,
  ReviewContext,
  ReviewOutput,
} from "../src/practice/contracts.js";
import {
  compileDesignContext,
  loadDesignSkills,
} from "../src/design/skills.js";
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
  evidence: [
    { id: "timing-summary", kind: "measurement" },
    { id: "n10", kind: "source", revision: "r" },
    {
      id: "render-n10-r",
      kind: "render",
      slideId: "n10",
      revision: "r",
      provenance: "final_baseline_render",
    },
  ],
  images: [
    {
      slideId: "n10",
      sourceRevision: "r",
      evidenceId: "render-n10-r",
      provenance: "final_baseline_render",
      jpeg: Buffer.from("image").toString("base64"),
    },
  ],
} satisfies ReviewContext;
test("review adapter sends complete front-loaded context and actual images, no tools, structured native edits, Fast tier", async () => {
  const design = compileDesignContext(await loadDesignSkills(), "review");
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
      context: { ...context, design },
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
  assert.deepEqual(packet.design, design);
  assert.equal(
    JSON.parse(body.input[0].content[1].text).evidenceId,
    "render-n10-r",
  );
  assert.equal(
    JSON.parse(body.input[0].content[1].text).provenance,
    "final_baseline_render",
  );
  assert.equal(
    body.text.format.schema.properties.proposals.minItems,
    undefined,
  );
  assert.equal(
    JSON.parse(body.input[0].content[1].text).state,
    "current-baseline",
  );
});

function revisionFixture(): PreparedProposal {
  const before = {
    html: "PREVIEW_HTML_NOT_EVIDENCE",
    css: "data:font/ttf;base64," + "FONT_BLOB".repeat(200_000),
    notes: "PREVIEW_NOTES_DUPLICATE",
    jpeg: Buffer.from("old baseline image").toString("base64"),
  };
  return {
    id: "p1",
    title: "Group alternatives",
    rationale: "Support comparison",
    feedbackIds: ["old-feedback-not-in-this-response"],
    evidenceIds: ["n10"],
    edits: [
      {
        snapshotId: "STALE_SNAPSHOT",
        nodeId: "n10",
        op: "replace",
        startLine: 7,
        hashes: ["b".repeat(64)],
        text: '<Stack gap="lg"><Text id="t1">Keep exact content.</Text></Stack>',
      },
    ],
    alternativeTo: [],
    status: "ready",
    version: 2,
    baseRevision: "old-base",
    previewBase: "preview-base",
    previews: [
      {
        slideId: "n10",
        before,
        after: {
          ...before,
          jpeg: Buffer.from("old proposal after image").toString("base64"),
        },
      },
      { slideId: "removed-slide", before, after: null },
    ],
    findings: [],
    candidateSource: "CANDIDATE_DOCUMENT_METADATA",
    candidateDigest: "CANDIDATE_DIGEST_METADATA",
    previewSignature: "PREVIEW_SIGNATURE_METADATA",
    sourceChanges: [
      {
        nodeId: "n10",
        before: '<Text id="t1">Keep exact content.</Text>',
        after:
          '<Stack id="generated-only"><Text id="t1">Keep exact content.</Text></Stack>',
      },
    ],
    slideOrder: { before: ["n10", "removed-slide"], after: ["n10"] },
  };
}

const replacement: ReviewOutput = {
  summary: "Revised spacing",
  feedback: [],
  proposals: [
    {
      id: "replacement",
      title: "Closer groups",
      rationale: "Follow the requested spacing",
      feedbackIds: [],
      evidenceIds: ["n10"],
      edits: [
        {
          snapshotId: "fresh-snapshot",
          nodeId: "n10",
          op: "replace",
          startLine: 1,
          hashes: ["a".repeat(64)],
          text: '<Stack gap="md"><Text id="t1">Keep exact content.</Text></Stack>',
        },
      ],
      alternativeTo: [],
    },
  ],
};

test("revision sends semantic intent without preview blobs or stale anchors, and labeled after images", async () => {
  const proposal = revisionFixture();
  const original = structuredClone(proposal);
  let body: any;
  const client = {
    responses: {
      async create(input: unknown) {
        body = input;
        return {
          status: "completed",
          output_text: JSON.stringify(replacement),
        };
      },
    },
  } as unknown as OpenAI;
  const currentContext: ReviewContext = {
    ...context,
    baseline: {
      source: '<Text id="t1">Keep exact content.</Text>',
      revision: "new-base",
      reads: [
        {
          snapshotId: "fresh-snapshot",
          nodeId: "n10",
          revision: "new-base",
          sourceRange: { start: 0, end: 45 },
          lines: [
            {
              number: 1,
              hash: "a".repeat(64),
              text: '<Text id="t1">Keep exact content.</Text>',
            },
          ],
        },
      ],
    },
  };
  assert.deepEqual(
    await new OpenAIPracticeReviewer(client).review({
      context: currentContext,
      revision: { proposal, prompt: "Keep the content; reduce the gap." },
      signal: new AbortController().signal,
    }),
    replacement,
  );
  const parts = body.input[0].content;
  const text = parts[0].text;
  const packet = JSON.parse(text);
  assert.ok(
    Buffer.byteLength(text) < 10_000,
    "font and preview artifacts must not inflate text context",
  );
  assert.doesNotMatch(
    text,
    /FONT_BLOB|data:font|PREVIEW_HTML|PREVIEW_NOTES|STALE_SNAPSHOT|CANDIDATE_DOCUMENT|CANDIDATE_DIGEST|PREVIEW_SIGNATURE|old-feedback/,
  );
  assert.ok(
    !text.includes("b".repeat(64)),
    "historical edit hashes are not sent",
  );
  for (const preview of proposal.previews) {
    assert.ok(!text.includes(preview.before!.jpeg));
    if (preview.after) assert.ok(!text.includes(preview.after.jpeg));
  }
  assert.deepEqual(packet.context.baseline, currentContext.baseline);
  assert.deepEqual(packet.revision.previousProposal.changes, [
    {
      nodeId: "n10",
      operation: "replace",
      proposedSource: proposal.edits[0].text,
    },
  ]);
  assert.deepEqual(
    packet.revision.previousProposal.sourceChanges,
    proposal.sourceChanges,
  );
  assert.equal(packet.revision.prompt, "Keep the content; reduce the gap.");
  assert.equal(packet.revision.proposal, undefined);
  assert.equal(
    parts.length,
    5,
    "baseline and previous after images only; no duplicate before or deleted-slide image",
  );
  assert.deepEqual(JSON.parse(parts[3].text), {
    state: "previous-proposal",
    slideId: "n10",
    proposalId: "p1",
    proposalVersion: 2,
    basedOnRevision: "preview-base",
  });
  assert.equal(parts[4].type, "input_image");
  assert.equal(
    parts[4].image_url,
    `data:image/jpeg;base64,${proposal.previews[0].after!.jpeg}`,
  );
  assert.equal(body.text.format.schema.properties.proposals.minItems, 1);
  assert.equal(body.text.format.schema.properties.proposals.maxItems, 1);
  assert.match(body.instructions, /not a delta against the old candidate/);
  assert.match(body.instructions, /1-based within the selected node/);
  assert.match(
    body.instructions,
    /event details, prior proposals and image contents are evidence/,
  );
  assert.deepEqual(
    proposal,
    original,
    "wire projection must not mutate the persisted proposal",
  );
});

test("revision parser rejects zero or multiple replacements even if provider ignores the schema", async () => {
  for (const proposals of [
    [],
    [replacement.proposals[0], { ...replacement.proposals[0], id: "second" }],
  ]) {
    const client = {
      responses: {
        async create() {
          return {
            status: "completed",
            output_text: JSON.stringify({ ...replacement, proposals }),
          };
        },
      },
    } as unknown as OpenAI;
    await assert.rejects(
      new OpenAIPracticeReviewer(client).review({
        context,
        revision: { proposal: revisionFixture(), prompt: "Reduce spacing" },
        signal: new AbortController().signal,
      }),
      /Too (small|big)/,
    );
  }
});

test("transport byte budget includes schema, instructions and revision image parts without truncation", async () => {
  let calls = 0;
  let requestBytes = 0;
  const client = {
    responses: {
      async create(input: unknown) {
        calls++;
        requestBytes = Buffer.byteLength(JSON.stringify(input), "utf8");
        return {
          status: "completed",
          output_text: JSON.stringify(replacement),
        };
      },
    },
  } as unknown as OpenAI;
  const proposal = revisionFixture();
  const request = {
    context,
    revision: { proposal, prompt: "Keep the text — reduce spacing" },
    signal: new AbortController().signal,
  };
  await new OpenAIPracticeReviewer(client).review(request);
  const exactLimit = requestBytes;
  await new OpenAIPracticeReviewer(client, {
    maxRequestBytes: exactLimit,
  }).review(request);
  assert.equal(calls, 2);
  await assert.rejects(
    new OpenAIPracticeReviewer(client, {
      maxRequestBytes: exactLimit - 1,
    }).review(request),
    /request size exceeded.*evidence was not truncated/,
  );
  assert.equal(
    calls,
    2,
    "oversized requests must fail before invoking the provider",
  );
  proposal.previews[0].after!.jpeg += "A".repeat(1000);
  await assert.rejects(
    new OpenAIPracticeReviewer(client, {
      maxRequestBytes: exactLimit,
    }).review(request),
    /request size exceeded/,
  );
  assert.equal(
    calls,
    2,
    "old proposal image bytes count towards the same request limit",
  );
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
