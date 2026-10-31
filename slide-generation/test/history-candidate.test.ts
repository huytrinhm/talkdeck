import test from "node:test";
import assert from "node:assert/strict";
import { createDeck } from "../src/bootstrap.js";
import { parseSource, nodeById, nodes, textContent } from "../src/parser.js";
import { childNodes, parseAndValidate } from "../src/schema.js";
import { ingestCandidate } from "../src/source/ingestion.js";
import {
  prepareCandidate,
  advanceVersions,
  highWater,
} from "../src/source/candidate.js";
import { restoreContentCandidate } from "../src/source/history.js";
import { applyPatches, setChildren } from "../src/source/surgery.js";

function replaceNode(source: string, id: string, replacement: string) {
  const node = nodeById(parseSource(source), id);
  return source.slice(0, node.start) + replacement + source.slice(node.end);
}
function commit(source: string, staged: string) {
  return advanceVersions(source, prepareCandidate(source, staged).source);
}
function notes(source: string, id = "n10") {
  return textContent(
    childNodes(nodeById(parseSource(source), id)).find(
      (n) => n.tag === "SpeakerNotes",
    )!,
  );
}
function utterances(source: string) {
  return [...nodes(parseSource(source))]
    .filter((n) => n.tag === "Prompt")
    .map((n) => ({ id: n.props.utteranceId, text: textContent(n) }));
}

test("undo restores visual content but keeps raw corrections and latest cleaned notes", () => {
  const snapshot = createDeck().source;
  let current = ingestCandidate(snapshot, {
    id: "u1",
    slideId: "n10",
    text: "20 percent\r\nexact",
    deliveredAtMs: 1,
  }).source;
  current = ingestCandidate(current, {
    id: "u2",
    slideId: "n10",
    text: "Correction: 25 percent",
    deliveredAtMs: 2,
    correctionOf: "u1",
  }).source;
  const noteNode = nodeById(parseSource(current), "n12");
  current = commit(
    current,
    applyPatches(current, [
      setChildren(current, noteNode, "The corrected figure is 25 percent."),
    ]),
  );
  current = commit(
    current,
    current.replace(
      "</Slide>",
      '<Text role="title">Current visual</Text></Slide>',
    ),
  );
  const restored = restoreContentCandidate(current, snapshot);
  parseAndValidate(restored);
  assert.ok(!restored.includes("Current visual"));
  assert.deepEqual(utterances(restored), utterances(current));
  assert.equal(notes(restored), notes(current));
  assert.ok(
    highWater(parseSource(restored)) >= highWater(parseSource(current)),
  );
  assert.ok(
    Number(nodeById(parseSource(restored), "n10").props.version) >
      Number(nodeById(parseSource(current), "n10").props.version),
  );
});

test("undelete recovers archived latest evidence and advances its retained version", () => {
  let snapshot = createDeck().source;
  snapshot = ingestCandidate(snapshot, {
    id: "u1",
    slideId: "n10",
    text: "before snapshot",
    deliveredAtMs: 1,
  }).source;
  let current = ingestCandidate(snapshot, {
    id: "u2",
    slideId: "n10",
    text: "after snapshot exact words",
    deliveredAtMs: 2,
  }).source;
  const latestVersion = Number(
    nodeById(parseSource(current), "n10").props.version,
  );
  const expectedNotes = notes(current),
    expectedUtterances = utterances(current);
  current = commit(current, replaceNode(current, "n10", ""));
  const restored = restoreContentCandidate(current, snapshot);
  parseAndValidate(restored);
  assert.equal(notes(restored), expectedNotes);
  assert.deepEqual(utterances(restored), expectedUtterances);
  assert.equal(
    [...nodes(parseSource(restored))].filter(
      (n) => n.tag === "ArchivedSlide" && n.props.slideId === "n10",
    ).length,
    0,
  );
  assert.ok(
    Number(nodeById(parseSource(restored), "n10").props.version) >
      latestVersion,
    "Restored stable identity must not reset its version",
  );
});

test("undo of new-slide creation archives its newer evidence rather than dropping it", () => {
  const snapshot = createDeck().source;
  let current = commit(
    snapshot,
    snapshot.replace(
      '<Archive id="n13" />',
      '<Slide freeForm={{reason:"new"}}><Transcript/><SpeakerNotes/></Slide><Archive id="n13" />',
    ),
  );
  const added = childNodes(parseSource(current)).find(
    (n) => n.tag === "Slide" && n.id !== "n10",
  )!;
  current = ingestCandidate(current, {
    id: "later",
    slideId: added.id!,
    text: "keep me through undo",
    deliveredAtMs: 5,
  }).source;
  const restored = restoreContentCandidate(current, snapshot);
  parseAndValidate(restored);
  assert.equal(
    childNodes(parseSource(restored)).filter((n) => n.tag === "Slide").length,
    1,
  );
  const archive = [...nodes(parseSource(restored))].find(
    (n) => n.tag === "ArchivedSlide" && n.props.slideId === added.id,
  )!;
  assert.ok(archive);
  assert.equal(
    textContent(childNodes(archive).find((n) => n.tag === "SpeakerNotes")!),
    "keep me through undo",
  );
  assert.deepEqual(utterances(restored), utterances(current));
});
