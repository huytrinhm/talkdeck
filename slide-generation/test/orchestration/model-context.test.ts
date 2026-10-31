import test from "node:test";
import assert from "node:assert/strict";
import { actorContext } from "../../src/orchestration/model-context.js";

test("recipient projection separates local editing evidence from private tasks and scheduler state", () => {
  const raw = {
    recipient: { id: "fast", role: "fast", parentId: null },
    activation: {
      id: "a",
      trigger: "speech",
      phase: "in_progress",
      boundarySequence: 8,
    },
    workingSlideId: "slide",
    tasks: [{ id: "t", task: "Inspect only", facts: "Do not edit" }],
    activeTasks: [{ id: "t", task: "Inspect only", facts: "Do not edit" }],
    speech: {
      slideId: "slide",
      text: "Exact words",
      receivedAt: 10,
      revision: 8,
      corrections: [],
    },
    speechDelivery: {
      kind: "append",
      delta: " words",
      revision: 8,
      slideId: "slide",
      previousSlideId: "slide",
    },
    deck: {
      epoch: 1,
      pauseEpoch: 2,
      revision: "hash",
      selectedSlideId: "elsewhere",
      designState: { theme: "matches_bootstrap_defaults", sharedDefinitions: 0 },
      slides: [{ id: "slide" }],
      notes: { transcript: '<Prompt utteranceId="u1">Exact words</Prompt>' },
    },
    statuses: [
      { id: "fast", role: "fast", state: "running" },
      { id: "child", role: "specialist", state: "waiting" },
    ],
    requiredResults: ["child"],
    messages: [],
    assetRefs: [],
  };
  const before = structuredClone(raw);
  const fast = actorContext(raw);
  assert.deepEqual(fast.activeTasks, [{ task: "Inspect only", facts: "Do not edit" }]);
  assert.equal(fast.newTaskCount, 1);
  assert.deepEqual(
    fast.deck?.notes,
    raw.deck.notes,
    "handoff retains exact utterance identity",
  );
  for (const text of [
    "pauseEpoch",
    "receivedAt",
    "boundarySequence",
    "selectedSlideId",
    '"statuses"',
    '"tasks"',
  ])
    assert(!JSON.stringify(fast).includes(text), text);
  const designer = actorContext({
    ...raw,
    recipient: { id: "slow", role: "slow" },
  });
  assert.deepEqual(designer.deck?.designState, raw.deck.designState);
  assert.deepEqual(fast.deck?.designState, raw.deck.designState);
  assert.deepEqual(designer.specialists, [
    { id: "child", state: "waiting", resultRequired: true },
  ]);
  const child = actorContext({
    ...raw,
    recipient: { id: "child", role: "specialist", parentId: "slow" },
  });
  assert.equal(child.speech, undefined);
  assert.equal(child.deck, undefined);
  assert.equal(child.specialists, undefined);
  assert.deepEqual(child.activeTasks, fast.activeTasks);
  assert.deepEqual(raw, before, "guards and recorded state remain intact");
});

test("duplicate notes are omitted only when the immutable observation contains the exact evidence", () => {
  const transcript =
    '<Transcript><Prompt utteranceId="u">Exact request</Prompt></Transcript>';
  const source = `<Slide id="s">${transcript}<SpeakerNotes>Exact notes</SpeakerNotes><Text>Visible</Text></Slide>`;
  const observation = {
    id: "o",
    slideId: "s",
    source,
    screenshot: Buffer.alloc(0),
    geometry: [],
    diagnostics: [],
    fastWatermark: 0,
  };
  const raw = {
    recipient: { role: "fast" },
    deck: { notes: { slideId: "s", transcript, notes: "Exact notes" } },
  };
  assert.equal(actorContext(raw, observation).deck?.notes, undefined);
  assert.deepEqual(
    actorContext(raw, { ...observation, slideId: "other" }).deck?.notes,
    raw.deck.notes,
  );
  assert.deepEqual(
    actorContext(raw, {
      ...observation,
      source: source.replace("Exact notes", "Older notes"),
    }).deck?.notes,
    raw.deck.notes,
  );
});
