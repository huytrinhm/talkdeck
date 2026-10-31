import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { SlideEngine, type CommitServices } from '../src/engine.js';
import { createDeck } from '../src/bootstrap.js';
import { FileDeckRepository } from '../src/storage/repository.js';
import { EvidenceInbox } from '../src/storage/inbox.js';
import { Trace } from '../src/telemetry/trace.js';
import { parseSource, nodeById } from '../src/parser.js';
import { lineHash } from '../src/hashline.js';
import type { Finding, ValidationPipeline } from '../src/contracts.js';

// Deliberately a unit test validator. These tests prove transaction mechanics, not browser correctness.
const passing: ValidationPipeline = { async check() { return { complete: true, findings: [], pendingNodeIds: [] }; } };
function change(engine: SlideEngine, nodeId: string, text: string) {
  const read = engine.readSource(nodeId);
  return { edits: [{ snapshotId: read.snapshotId, nodeId, op: 'replace' as const, startLine: 1, hashes: read.lines.map(l => l.hash), text }] };
}
async function setup(validation = passing) {
  await mkdir('.artifacts/tests', { recursive: true });
  const directory = await mkdtemp('.artifacts/tests/engine-');
  const repository = new FileDeckRepository(join(directory, 'deck.json'));
  const initial = await repository.initialize(createDeck());
  const services: CommitServices = { repository, normalize: async source => source, inbox: new EvidenceInbox(join(directory, 'inbox')) };
  const engine = new SlideEngine(initial.document, validation, new Trace(), services);
  return { engine, services, directory, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
test('unit transaction persists only after complete validation, returns normalized anchors and survives reload', async () => {
  const fixture = await setup();
  try {
    const { engine, services } = fixture;
    const result = await engine.edit(change(engine, 'n2', '<Brief id="n2">Changed</Brief>'));
    assert.equal(result.accepted, true);
    if (!result.accepted) return;
    assert.equal(result.source.revision, result.revision);
    assert.equal(result.versions.n1, 2);
    assert.equal(result.versions.n10, 1); // Moving offsets must not advance unrelated slide versions.
    assert.deepEqual((await services.repository.load()).document, engine.readDocument());
    const reloaded = new SlideEngine((await services.repository.load()).document, passing, undefined, services);
    assert.equal(reloaded.readSource('n2').lines[0].text, '<Brief id="n2">Changed</Brief>');
    const unchanged = await engine.edit(change(engine, 'n2', '<Brief id="n2">Changed</Brief>'));
    assert.equal(unchanged.accepted && unchanged.noOp, true);
    assert.equal(engine.readSource('n1').revision, result.revision);
  } finally { await fixture.cleanup(); }
});
test('failed last check rolls back source, ID allocation, versions and repository', async () => {
  let calls = 0;
  const fixture = await setup({ async check() { calls++; return { complete: calls !== 2, findings: [], pendingNodeIds: [] }; } });
  try {
    const { engine, services } = fixture, before = engine.readDocument();
    const read = engine.readSource('n10');
    const source = read.lines.map(l => l.text).join('\n').replace('</Slide>', '<Text>New</Text></Slide>');
    await assert.rejects(engine.edit(change(engine, 'n10', source)), /validation stages/);
    assert.deepEqual(engine.readDocument(), before);
    assert.deepEqual((await services.repository.load()).document, before);
  } finally { await fixture.cleanup(); }
});
test('idempotent retries return the original accepted result; keys cannot be reused for another request', async () => {
  const fixture = await setup();
  try {
    const edit = change(fixture.engine, 'n2', '<Brief id="n2">First</Brief>');
    const first = await fixture.engine.edit(edit, 'request-1');
    assert.deepEqual(await fixture.engine.edit(edit, 'request-1'), first);
    assert.throws(() => fixture.engine.edit(change(fixture.engine, 'n2', '<Brief id="n2">Second</Brief>'), 'request-1'), /different edits/);
  } finally { await fixture.cleanup(); }
});
test('new/worsened errors refuse while unchanged draft errors remain and readiness still blocks', async () => {
  const finding: Finding = { check: 'overflow', slideId: 'n10', nodeId: 'n10', severity: 'error', magnitude: 2, message: 'Existing' };
  const fixture = await setup({ async check(source) { return { complete: true, pendingNodeIds: [], findings: [{ ...finding, magnitude: source.includes('Worse') ? 5 : 2 }] }; } });
  try {
    assert.equal((await fixture.engine.edit(change(fixture.engine, 'n2', '<Brief id="n2">Allowed</Brief>'))).accepted, true);
    const before = fixture.engine.readDocument();
    assert.equal((await fixture.engine.edit(change(fixture.engine, 'n2', '<Brief id="n2">Worse</Brief>'))).accepted, false);
    assert.deepEqual(fixture.engine.readDocument(), before);
    assert.equal((await fixture.engine.readiness()).ready, false);
  } finally { await fixture.cleanup(); }
});
test('input is durably retained during browser work; disjoint edits restage without losing newer evidence', async () => {
  let release!: () => void, entered!: () => void, calls = 0;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const fixture = await setup({ async check() { if (++calls === 1) { entered(); await held; } return passing.check(''); } });
  try {
    const editing = fixture.engine.edit(change(fixture.engine, 'n2', '<Brief id="n2">Disjoint edit</Brief>'));
    await enteredPromise;
    const receipt = await fixture.engine.ingest({ id: 'u1', slideId: 'n10', text: 'Do not lose these words.', deliveredAtMs: 10 });
    assert.equal(receipt.utteranceId, 'u1');
    await fixture.engine.settledInput();
    assert.match(fixture.engine.readSpeakerNotes('n10').transcript, /Do not lose these words/);
    release();
    assert.equal((await editing).accepted, true);
    assert.match(fixture.engine.readSpeakerNotes('n10').notes, /Do not lose these words/);
    assert.match(fixture.engine.readSource('n2').lines[0].text, /Disjoint edit/);
    assert.ok(calls >= 4);
    assert.equal((await fixture.services.repository.load()).revision, lineHash(fixture.engine.readDocument().source));
  } finally { release(); await fixture.cleanup(); }
});
test('commit notification and trace sink failures cannot falsely report rollback after durable commit', async () => {
  const fixture = await setup();
  try {
    const trace = new Trace(() => { throw new Error('telemetry unavailable'); });
    const engine = new SlideEngine(fixture.engine.readDocument(), passing, trace, fixture.services);
    engine.subscribe(() => { throw new Error('transport unavailable'); });
    const result = await engine.edit(change(engine, 'n2', '<Brief id="n2">Committed</Brief>'));
    assert.equal(result.accepted, true);
    assert.equal(engine.state().notificationFailures, 1);
    assert.ok(trace.failures > 0);
    assert.equal(nodeById(parseSource((await fixture.services.repository.load()).document.source), 'n2').children[0], 'Committed');
  } finally { await fixture.cleanup(); }
});
