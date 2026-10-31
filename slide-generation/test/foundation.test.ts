import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { fixtureSchema, loadFixture, spokenInput } from '../src/evaluation/fixtures.js';
import { serializeManifest } from '../src/evaluation/manifest.js';
import { capabilities } from '../src/capabilities.js';
import { Trace, type TraceEvent } from '../src/telemetry/trace.js';
import { SlideEngine } from '../src/engine.js';
import { createDeck } from '../src/bootstrap.js';

test('all five timed talks load without exposing evaluator annotations', async () => {
  const files = (await readdir('fixtures/talks')).filter(f => f.endsWith('.json'));
  assert.equal(files.length, 5);
  for (const file of files) {
    const fixture = await loadFixture(`fixtures/talks/${file}`);
    assert.deepEqual(Object.keys(spokenInput(fixture.events[0])), ['id', 'text', 'scheduledEndMs']);
    for (const change of [
      { schemaVersion: 2 },
      { events: [...fixture.events].reverse() },
      { events: [fixture.events[0], fixture.events[0]] },
      { expectations: [{ ...fixture.expectations[0], triggerEventId: 'missing' }] },
      { expectations: [fixture.expectations[0], fixture.expectations[0]] },
    ]) assert.equal(fixtureSchema.safeParse({ ...fixture, ...change }).success, false);
  }
});
test('strict manifests exclude credentials and unknown environment/settings fields', () => {
  const valid = { schemaVersion: 1, sourceSha: 'a'.repeat(40), dirty: false, nodeVersion: process.version,
    platform: process.platform, startedAt: new Date().toISOString(), lockSha256: 'b'.repeat(64),
    promptSha256: 'c'.repeat(64), fixtureSha256: 'd'.repeat(64), dependencies: [], mode: 'environment' };
  assert.equal(JSON.parse(serializeManifest(valid)).mode, 'environment');
  assert.throws(() => serializeManifest({ ...valid, apiKey: 'secret' }));
  assert.throws(() => serializeManifest({ ...valid, env: { TOKEN: 'secret' } }));
  assert.equal(capabilities().mutationsReady, false);
  assert.equal(capabilities().liveHost, false);
});
test('read and refused transaction have ordered causal telemetry', async () => {
  const events: TraceEvent[] = [];
  const engine = new SlideEngine(createDeck(), undefined, new Trace(e => events.push(e)));
  const read = engine.readSource('n2');
  await assert.rejects(engine.edit({ edits: [{ snapshotId: read.snapshotId, nodeId: 'n2', op: 'replace', startLine: 1,
    hashes: read.lines.map(l => l.hash), text: '<Brief id="n2">Updated</Brief>' }] }));
  assert.deepEqual(events.map(e => e.kind), ['source.read', 'edit.started', 'edit.refused']);
  assert.equal(events[0].cause.toolCallId, read.snapshotId);
  assert.equal(events[1].cause.transactionId, events[2].cause.transactionId);
  assert.equal(events[1].cause.revision, events[2].cause.revision);
  assert.ok(events[2].monotonicMs >= events[1].monotonicMs);
});
