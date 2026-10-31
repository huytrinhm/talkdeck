import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeck } from '../src/bootstrap.js';
import { SlideEngine } from '../src/engine.js';
import { introducedErrors, ready } from '../src/validation.js';
import type { Finding, ValidationPipeline } from '../src/contracts.js';

function change(engine: SlideEngine, nodeId: string, text: string) {
  const read = engine.readSource(nodeId);
  return { edits: [{ snapshotId: read.snapshotId, nodeId, startLine: 1, hashes: read.lines.map(line => line.hash), op: 'replace', text }] };
}
test('default missing browser pipeline refuses without changing source', async () => {
  const engine = new SlideEngine(createDeck()), before = engine.readDocument();
  await assert.rejects(engine.edit(change(engine, 'n2', '<Brief id="n2">Updated</Brief>')), /validation stages/);
  assert.deepEqual(engine.readDocument(), before);
});
test('system versions and raw transcripts cannot be modified', async () => {
  const engine = new SlideEngine(createDeck());
  const read = engine.readSource('n10');
  await assert.rejects(engine.edit({ edits: [{ snapshotId: read.snapshotId, nodeId: 'n10', startLine: 1, hashes: [read.lines[0].hash], op: 'replace', text: read.lines[0].text.replace('version={1}', 'version={2}') }] }), /system-managed version/);
  await assert.rejects(engine.edit(change(engine, 'n11', '<Transcript id="n11">Forged</Transcript>')), /system-owned/);
});
test('forged IDs refuse and new-node candidates still require real validation', async () => {
  const engine = new SlideEngine(createDeck());
  await assert.rejects(engine.edit(change(engine, 'n2', '<Brief id="n2"><Text id="t99">New</Text></Brief>')), /omit system-assigned/);
  await assert.rejects(engine.edit(change(engine, 'n10', engine.readSource('n10').lines.map(l => l.text).join('\n').replace('</Slide>', '<Text>New</Text></Slide>'))), /validation stages/);
});
test('browser crash leaves source unchanged and releases transaction queue', async () => {
  const validation: ValidationPipeline = { async check() { throw new Error('browser crashed'); } };
  const engine = new SlideEngine(createDeck(), validation), before = engine.readDocument();
  await assert.rejects(engine.edit(change(engine, 'n2', '<Brief id="n2">A</Brief>')), /browser crashed/);
  await assert.rejects(engine.edit(change(engine, 'n2', '<Brief id="n2">B</Brief>')), /browser crashed/);
  assert.deepEqual(engine.readDocument(), before);
});
test('even a successful test validator cannot enable unfinished commit logic', async () => {
  const engine = new SlideEngine(createDeck(), { async check() { return { complete: true, findings: [], pendingNodeIds: [] }; } });
  const before = engine.readDocument();
  await assert.rejects(engine.edit(change(engine, 'n2', '<Brief id="n2">A</Brief>')), /commit is not wired/);
  assert.deepEqual(engine.readDocument(), before);
});
test('relative findings allow unchanged errors but reject worsening and new errors', () => {
  const finding: Finding = { check: 'overflow', slideId: 'n10', nodeId: 't1', severity: 'error', magnitude: 10, message: 'Overflow' };
  assert.deepEqual(introducedErrors([finding], [{ ...finding, magnitude: 5 }]), []);
  assert.deepEqual(introducedErrors([finding], [finding]), []);
  assert.equal(introducedErrors([finding], [{ ...finding, magnitude: 11 }]).length, 1);
  assert.equal(introducedErrors([finding], [{ ...finding, nodeId: 't2' }]).length, 1);
  assert.equal(ready({ complete: true, pendingNodeIds: [], findings: [finding] }), false);
  assert.equal(ready({ complete: true, pendingNodeIds: ['n15'], findings: [] }), false);
  assert.equal(ready({ complete: false, pendingNodeIds: [], findings: [] }), false);
  assert.equal(ready({ complete: true, pendingNodeIds: [], findings: [] }), true);
});

test('one improving violation cannot mask a new or worsening independent measurement', () => {
  const finding: Finding = { check: 'overlap', slideId: 'n10', nodeId: 't1', severity: 'error', magnitude: 100, message: 'Overlap', subject: 'pair:t2' };
  const next = [{ ...finding, magnitude: 50 }, { ...finding, subject: 'pair:t3', magnitude: 2 }];
  assert.deepEqual(introducedErrors([finding], next), [next[1]]);
  assert.deepEqual(introducedErrors([finding, { ...finding, subject: 'pair:t3', magnitude: 1 }], next), [next[1]]);
});
