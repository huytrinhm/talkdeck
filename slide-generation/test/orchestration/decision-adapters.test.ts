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

test("speech adapter supplies actual image, honest coverage, dispatch effects and no binary/timing dump", async () => {
  const f = fixture(),
    decider = new OpenAIDecider(f.client, "decision");
  assert.equal(
    await decider.evaluate(
      {
        ...base(),
        current: observation(),
        deck: {
          slides: [{ id: "s1", title: "Price" }],
          extra: Buffer.from("private bytes"),
        },
        statuses: { fast: "running", slow: "idle" },
        spokenEdits: true,
      },
      signal(),
    ),
    "dispatch",
  );
  const request = f.requests[0],
    data = payload(request);
  assert.equal(
    request.input[0].content[1].image_url,
    "data:image/jpeg;base64,anBlZw==",
  );
  assert.equal(data.current.screenshot, undefined);
  assert.equal(data.speech.receivedAt, undefined);
  assert.equal(data.undispatchedAgeMs, undefined);
  assert.equal(data.deck.extra, "[binary omitted]");
  assert.equal(data.statuses.fast, "running");
  assert.deepEqual(data.coverage.slideSources, []);
  assert.equal(data.coverage.geometry, "not measured");
  assert.match(data.coverage.deck, /inventory is not whole-deck source/);
  assert.equal(data.lastDispatched, null);
  assert.equal(data.delta.kind, "initial");
  assert.equal(data.delta.newText, undefined);
  assert.match(data.speechContract, /null means none/);
  assert.match(
    data.actionEffects.dispatch,
    /does not itself edit or prove publication/,
  );
  assert.match(data.speechMode, /explicit user editing requests/);
});

test("speech deltas distinguish appended content, unchanged text, replacements and foreign-slide baselines", async () => {
  const f = fixture(),
    decider = new OpenAIDecider(f.client, "decision");
  for (const [text, kind] of [
    ["Price $20. Setup ten minutes.", "append"],
    ["Price $20", "unchanged"],
    ["Price $30", "replacement"],
  ]) {
    await decider.evaluate(
      {
        ...base(),
        lastDispatched: speech("Price $20"),
        speech: {
          ...speech(text, 3),
          corrections: [
            { revision: 1, before: "old", after: "Price $20" },
            { revision: 3, before: "Price $20", after: text },
          ],
        },
      },
      signal(),
    );
    const data = payload(f.requests.at(-1));
    assert.equal(data.delta.kind, kind);
    assert.equal(data.correctionsSinceDispatch.length, 1);
  }
  assert.equal(payload(f.requests[0]).delta.newText, ". Setup ten minutes.");
  await decider.evaluate(
    { ...base(), lastDispatched: { ...speech("Prior"), slideId: "other" } },
    signal(),
  );
  assert.equal(payload(f.requests.at(-1)).delta.kind, "incomparable_slide");
});

test("canonical slide projection removes duplicate evidence without dropping visible content or changing legacy HTML", async () => {
  const f = fixture(),
    decider = new OpenAIDecider(f.client, "decision");
  const transcript =
    '<Transcript><Prompt utteranceId="u1">Price $20</Prompt></Transcript>';
  const current = {
    ...observation(),
    source: `<Slide id="s1">${transcript}<SpeakerNotes>Price $20</SpeakerNotes><Text>Price $20</Text></Slide>`,
  };
  await decider.evaluate(
    {
      ...base(),
      current,
      deck: { notes: { slideId: "s1", transcript, notes: "Price $20" } },
    },
    signal(),
  );
  const data = payload(f.requests[0]);
  assert.equal(
    data.current.source,
    '<Slide id="s1"><Text>Price $20</Text></Slide>',
  );
  assert.equal(data.current.sourceEvidence, undefined);
  assert.equal(data.current.comparableNotes, undefined);
  assert.equal(data.deck.notes.transcript, transcript);
  await decider.evaluate({ ...base(), current }, signal());
  assert.equal(payload(f.requests[1]).current.sourceEvidence[0], transcript);
  await decider.evaluate(
    {
      ...base(),
      current,
      deck: {
        notes: { slideId: "s1", transcript: "different", notes: "different" },
      },
    },
    signal(),
  );
  assert.equal(payload(f.requests[2]).current.sourceEvidence[0], transcript);
  await decider.evaluate({ ...base(), current: observation() }, signal());
  assert.equal(payload(f.requests[3]).current.source, observation().source);
});

test("optional legacy speech inputs remain usable and explicitly lack visual evidence; invalid answers fail", async () => {
  const f = fixture(),
    decider = new OpenAIDecider(f.client, "decision");
  await decider.evaluate(base(), signal());
  assert.equal(f.requests[0].input[0].content.length, 1);
  assert.equal(payload(f.requests[0]).current, null);
  assert.match(
    payload(f.requests[0]).coverage.screenshot.status,
    /unavailable/,
  );
  assert.match(payload(f.requests[0]).speechMode, /not editing commands/);
  f.choice("unexpected");
  await assert.rejects(decider.evaluate(base(), signal()), /dispatch\/hold/);
});

test("Slow packet distinguishes passive speech, watermark, statuses and image/source coverage", async () => {
  const f = fixture(),
    decider = new OpenAISlowDecider(f.client, "decision");
  const current = {
    ...observation(),
    sourceRevision: "new",
    visualSourceRevision: "old",
    availability: {
      screenshot: "previous render",
      geometry: "not measured",
      diagnostics: "not run",
    },
  };
  await decider.evaluate(
    {
      current,
      lastObservedFastWatermark: 2,
      speech: { ...speech("Other slide"), slideId: "s2" },
      context: "",
      messages: [{ id: "m", from: "fast", to: "slow", text: "Rejected edit" }],
      statuses: { fast: "running" },
      deck: { slides: [{ id: "s1" }, { id: "s2", source: "<main/>" }] },
      spokenEdits: true,
    },
    signal(),
  );
  const data = payload(f.requests[0]);
  assert.equal(
    f.requests[0].input[0].content[1].image_url,
    "data:image/jpeg;base64,anBlZw==",
  );
  assert.equal(data.current.sourceRevision, "new");
  assert.equal(data.coverage.screenshot.sourceRevision, "old");
  assert.equal(data.coverage.screenshot.availability, "previous render");
  assert.equal(data.lastObservedFastWatermark, 2);
  assert.equal(data.current.fastWatermark, 4);
  assert.equal(data.speech.slideId, "s2");
  assert.match(data.speechContract, /passive cumulative/);
  assert.match(data.speechContract, /never silently retarget/);
  assert.equal(data.statuses.fast, "running");
  assert.deepEqual(data.coverage.slideSources, ["s2"]);
  assert.match(data.actionEffects.wake, /no mutation/);
  assert.match(data.actionEffects.hold, /later Fast publication/);
});
