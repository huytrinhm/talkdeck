import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { createDeck } from '../src/bootstrap.js';
import { SlideEngine } from '../src/engine.js';

test('Hono serves anchored reads, notes, and truthful readiness', async () => {
  const app = createApp(new SlideEngine(createDeck()));
  const health = await (await app.request('/health')).json();
  assert.deepEqual(health.canvas, { width: 1920, height: 1080 });
  assert.equal(health.mutationsReady, false);
  const read = await (await app.request('/source/n10')).json();
  assert.match(read.lines[0].hash, /^[a-f0-9]{64}$/);
  const notes = await (await app.request('/slides/n10/speaker-notes')).json();
  assert.equal(notes.notes, ''); assert.match(notes.transcript, /Transcript/);
  const readiness = await (await app.request('/presentation-readiness')).json();
  assert.equal(readiness.ready, false); assert.equal(readiness.complete, false);
  assert.equal((await app.request('/source/missing')).status, 404);
});
test('Hono edit errors never report success', async () => {
  const app = createApp(new SlideEngine(createDeck()));
  const read = await (await app.request('/source/n2')).json();
  const response = await app.request('/edits', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ edits: [{ snapshotId: read.snapshotId, nodeId: 'n2', op: 'replace', startLine: 1, hashes: read.lines.map((line: { hash: string }) => line.hash), text: '<Brief id="n2">Updated</Brief>' }] }) });
  assert.equal(response.status, 503); assert.equal((await response.json()).code, 'validation_unavailable');
  assert.equal((await app.request('/edits', { method: 'POST', body: '{}' })).status, 400);
  assert.equal((await app.request('/edits', { method: 'POST', body: 'invalid json' })).status, 422);
});
