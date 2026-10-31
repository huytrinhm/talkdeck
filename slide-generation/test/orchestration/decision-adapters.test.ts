import test from "node:test";
import assert from "node:assert/strict";
import type OpenAI from "openai";
import {
  OpenAIDecider,
  OpenAISlowDecider,
} from "../../src/orchestration/openai.js";
import type {
  DecisionInput,
  Observation,
  Speech,
} from "../../src/orchestration/types.js";

const speech = (text: string, revision = 1): Speech => ({
  slideId: "s1",
  text,
  revision,
  receivedAt: 200,
  corrections: [],
});
const observation = (): Observation => ({
  id: "frame",
  slideId: "s1",
  source: "<main>Price $20</main>",
  screenshot: Buffer.from("jpeg"),
  screenshotMimeType: "image/jpeg",
  fastWatermark: 4,
  geometry: [],
  diagnostics: [],
  availability: {
    screenshot: "current render",
    geometry: "not measured",
    diagnostics: "not run",
  },
});
function fixture() {
  const requests: any[] = [];
  let choice: string | undefined;
  const client = {
    decisions: {
      create: async (request: any) => {
        requests.push(request);
        return {
          answers: [
            {
              type: "choice",
              name: request.questions[0].name,
              choice:
                choice ??
                (request.questions[0].name === "speech_dispatch"
                  ? "dispatch"
                  : "hold"),
            },
          ],
          usage: {},
        };
      },
    },
  } as unknown as OpenAI;
  return {
    requests,
    client,
    choice: (value: string) => {
      choice = value;
    },
  };
}
function payload(request: any) {
  return JSON.parse(request.input[0].content[0].text);
}
const signal = () => new AbortController().signal;
const base = (): DecisionInput => ({
  speech: speech("Price $20"),
  lastDispatched: null,
  undispatchedAgeMs: 12,
  context: "",
});

test("speech gate sends only transcript comparison and pixels in the normal case; instructions are complete", async () => {
  const f = fixture(), decider = new OpenAIDecider(f.client, "decision");
  await decider.evaluate({ ...base(), current: observation(), spokenEdits: true,
    deck: { epoch: 9, notes: "duplicate", extra: Buffer.from("private") }, statuses: { fast: "running" } }, signal());
  const request = f.requests[0];
  assert.deepEqual(payload(request), { previously_sent_transcript: null, current_transcript: "Price $20" });
  assert.equal(request.input[0].content[1].image_url, "data:image/jpeg;base64,anBlZw==");
  const instructions = request.questions[0].instructions;
  assert.match(instructions, /slide-writing agent/);
  assert.match(instructions, /previously_sent_transcript/);
  assert.match(instructions, /Dispatch sends the cumulative transcript for reasoning/);
  assert.match(instructions, /explicit user editing requests/);
});

test("append and replacement comparisons retain the baseline; foreign-slide baselines and images do not leak", async () => {
  const f = fixture(), decider = new OpenAIDecider(f.client, "decision");
  for (const text of ["Price $20. Setup ten minutes.", "Price $20", "Price $30"]){
    await decider.evaluate({ ...base(), current: observation(), lastDispatched: speech("Price $20"), speech: speech(text, 3) }, signal());
    assert.deepEqual(payload(f.requests.at(-1)), { previously_sent_transcript: "Price $20", current_transcript: text });
  }
  await decider.evaluate({ ...base(), lastDispatched: { ...speech("Other"), slideId: "other" }, current: { ...observation(), slideId: "other" } }, signal());
  assert.equal(payload(f.requests.at(-1)).previously_sent_transcript, null);
  assert.equal(f.requests.at(-1).input[0].content.length, 1);
  assert.match(payload(f.requests.at(-1)).image_unavailable, /No slide image/);
});

test("only additional correction context is retained; identical or already supplied replacements are omitted", async () => {
  const f = fixture(), decider = new OpenAIDecider(f.client, "decision");
  await decider.evaluate({ ...base(), current: observation(), lastDispatched: speech("Price $20"), speech: {
    ...speech("Price $30", 4), corrections: [
      { revision: 1, before: "old", after: "Price $20" },
      { revision: 2, before: "Price $20", after: "Price $30" },
      { revision: 3, before: "setup twenty", after: "setup ten" },
      { revision: 4, before: "same", after: "same" },
    ],
  } }, signal());
  assert.deepEqual(payload(f.requests[0]).correction_context, [{ before: "setup twenty", after: "setup ten" }]);
});

test("missing/stale image limits remain explicit; native fallback omits notes, legacy HTML stays intact", async () => {
  const f = fixture(), decider = new OpenAIDecider(f.client, "decision");
  const current = { ...observation(), screenshot: Buffer.alloc(0), source: '<Slide><Transcript><Prompt>Hidden</Prompt></Transcript><SpeakerNotes>Notes</SpeakerNotes><Text>Price $20</Text></Slide>' };
  await decider.evaluate({ ...base(), current }, signal());
  assert.equal(payload(f.requests[0]).visible_source, '<Slide><Text>Price $20</Text></Slide>');
  assert(payload(f.requests[0]).image_unavailable);
  await decider.evaluate({ ...base(), current: { ...observation(), screenshot: Buffer.alloc(0) } }, signal());
  assert.equal(payload(f.requests[1]).visible_source, observation().source);
  await decider.evaluate({ ...base(), current: { ...observation(), availability: { ...observation().availability!, screenshot: "previous render" } } }, signal());
  assert.equal(payload(f.requests[2]).image_limitation, "previous render");
  assert.match(f.requests[0].questions[0].instructions, /Editing instructions arrive through separate tasks/);
  f.choice("unexpected");await assert.rejects(decider.evaluate(base(), signal()), /dispatch\/hold/);
});

test("designer gate retains useful multi-slide attribution but no duplicate identity, empty lists or policy paragraphs", async () => {
  const f = fixture(), decider = new OpenAISlowDecider(f.client, "decision");
  await decider.evaluate({ current: observation(), lastObservedFastWatermark: 2,
    speech: { ...speech("Other slide"), slideId: "s2" }, context: "",
    messages: [{ id: "m", from: "fast", to: "slow", targetSlideId: "s2", text: "Rejected edit" }],
    statuses: { fast: "running" }, deck: { slides: [{ id: "s1" }, { id: "s2" }], designState: { theme: "customized", sharedDefinitions: 1, interpretation: "duplicate policy" } }, spokenEdits: true,
  }, signal());
  const data = payload(f.requests[0]);
  assert.equal(data.target_slide_id, "s1");
  assert.deepEqual(data.other_slide_speech, { slideId: "s2", text: "Other slide" });
  assert.equal(data.current_transcript, undefined);
  assert.deepEqual(data.design_state, { theme: "customized", sharedDefinitions: 1 });
  assert.equal(data.statuses, undefined);
  assert.equal(data.speechMode, undefined);
  assert.deepEqual(data.work_messages, [{ from: "fast", text: "Rejected edit", targetSlideId: "s2" }]);
  assert.match(f.requests[0].questions[0].instructions, /first deliberate composition/);
});
