import { starterComposition } from '../src/starter.js';
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  loadDesignSkills,
  compileDesignContext,
  validateDesignSkillSnapshot,
} from "../src/design/skills.js";
import { JsxBackend } from "../src/host/jsx-backend.js";
import { createLocalRuntime } from "../src/runtime.js";
import { createDeck } from "../src/bootstrap.js";
import { allocateIds } from "../src/source/candidate.js";
import { expandSource } from "../src/expansion.js";

test("stored skill snapshots reproduce prompts and reject corrupt or reordered resources", async () => {
  const snapshot = await loadDesignSkills();
  const recorded = JSON.parse(JSON.stringify(snapshot));
  assert.deepEqual(
    compileDesignContext(recorded, "slow"),
    compileDesignContext(snapshot, "slow"),
  );
  const fast = compileDesignContext(snapshot, "fast").instructions;
  const slow = compileDesignContext(snapshot, "slow").instructions;
  assert(
    fast.length < slow.length * 0.65,
    "Fast should not inherit the full recipe collection",
  );
  assert.match(fast, /L20 — Closing/);
  assert.match(slow, /Do not imply that one option wins/);
  assert.doesNotMatch(slow, /Produce a self-contained, static 16:9 HTML/);
  recorded.files[0].text += "changed";
  assert.throws(() => validateDesignSkillSnapshot(recorded), /integrity/);
  const reordered = structuredClone(snapshot);
  reordered.files.reverse();
  assert.throws(() => validateDesignSkillSnapshot(reordered), /integrity/);
});

test("new authoring examples use actual native frame, motif, shape and slot syntax", async () => {
  const authoring = (await loadDesignSkills()).files.find(file => file.path === "authoring.md")!.text;
  const blocks = [...authoring.matchAll(/```jsx\n([\s\S]*?)\n```/g)].map(match => match[1]);
  const definition = blocks.find(block => block.startsWith("<Layout"))!;
  const instance = blocks.find(block => block.startsWith("<Headline"))!;
  assert(definition && instance);
  const inline = (tag: string) => authoring.match(new RegExp("`(<" + tag + "[^`]+/>)`"))![1];
  const base = createDeck().source.replace("</Theme>", `${inline("Frame")}${inline("Motif")}</Theme>`);
  // A registered Layout replaces the free-form starter, rather than mixing both.
  const defined = base.replace(starterComposition({ body: 'n14', rule: 'n15' }), '').replace('<Library id="n9" />', `<Library id="n9">${definition}</Library>`)
    .replace('<SpeakerNotes id="n12" />', `<SpeakerNotes id="n12" />${instance}`);
  assert.equal(expandSource(allocateIds(defined).source).library[0].name, "Headline");
  const decorated = base.replace('<SpeakerNotes id="n12" />', `<SpeakerNotes id="n12" />${inline("Shape")}<Text>Exact content</Text>`);
  assert.equal(expandSource(allocateIds(decorated).source).slides.length, 1);
});

test("skills affect actor instructions only, preserve legacy mode, and do not add tools or decision context", async () => {
  await mkdir(".artifacts/tests", { recursive: true });
  const directory = await mkdtemp(".artifacts/tests/design-context-");
  const local = await createLocalRuntime({ directory: resolve(directory) });
  try {
    const snapshot = await loadDesignSkills();
    const legacy = new JsxBackend(local, { instructions: "Host rules" });
    const enabled = new JsxBackend(local, {
      instructions: "Host rules",
      designSkills: snapshot,
    });
    await legacy.initialize("");
    await enabled.initialize("");
    const invocation = {
      agent: "slow",
      role: "slow" as const,
      slideId: "n10",
      inferenceId: "i",
      signal: new AbortController().signal,
    };
    const semanticContext = (backend: JsxBackend) => JSON.parse(JSON.stringify(backend.generation.context(invocation)),
      (key, value) => key === 'snapshotId' ? '<issued anchor ID>' : value);
    assert.deepEqual(semanticContext(enabled), semanticContext(legacy));
    assert.deepEqual(
      enabled.generation.definitions("slow"),
      legacy.generation.definitions("slow"),
    );
    assert.equal(legacy.designContext("review"), undefined);
    assert.doesNotMatch(
      legacy.generation.instructions("fast"),
      /slide-design skill/,
    );
    assert.match(
      enabled.generation.instructions("fast"),
      /Incremental drafting/,
    );
    assert.match(
      enabled.generation.instructions("slow"),
      /S05 — Warm humanist/,
    );
    const specialist = enabled.generation.instructions("specialist");
    assert.deepEqual(enabled.generation.definitions("specialist"), []);
    assert.match(specialist, /private specialist/i);
    assert.match(specialist, /parent handles canonical asset registration/);
    assert(specialist.length < 4000, "Specialists receive a compact private-task prompt, not the recipe book");
    assert.doesNotMatch(specialist, /Host rules|# Canonical authoring boundary|# Refinement|Follow the canonical JSX|read_source|edit_source|read_speaker_notes|presentation_readiness|search_icons|read_icon|## L\d\d|## S\d\d/);
    assert.match(specialist, /send_message/);
    assert.match(specialist, /queue their results to the designer/);
    assert.match(specialist, /Call finish after delivery/);
    const frozen = enabled.generation.instructions("slow");
    snapshot.files[0].text = "Caller mutation";
    enabled.designContext("slow")!.instructions = "Returned value mutation";
    assert.equal(enabled.generation.instructions("slow"), frozen);
    const read = local.engine.readSource("n10");
    const last = read.lines.at(-1)!;
    const example = (await loadDesignSkills()).files
      .find((f) => f.path === "authoring.md")!
      .text.match(/```jsx\n([\s\S]*?)\n```/)![1];
    const result = await local.engine.edit({
      edits: [
        {
          snapshotId: read.snapshotId,
          nodeId: read.nodeId,
          op: "insert_before",
          startLine: last.number,
          hashes: [last.hash],
          text: example,
        },
      ],
    });
    assert.equal(result.accepted, true, JSON.stringify(result));
    const image = (
      await local.browser.screenshot(local.engine.readDocument().source, [
        "n10",
      ])
    )[0];
    assert(
      image.jpeg.length > 1000,
      "The shipped JSX example must render through real Chromium",
    );
  } finally {
    await local.close();
    await rm(directory, { recursive: true, force: true });
  }
});
