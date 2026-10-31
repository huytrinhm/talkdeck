import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { loadFixture } from '../src/evaluation/fixtures.js';
import { runTalk, type EvaluationHost, type DeliveredInput } from '../src/evaluation/driver.js';
import { type EvaluationClock } from '../src/evaluation/clock.js';
import { RunRecorder } from '../src/evaluation/recorder.js';
import { summarizeObservations, quantiles, type Observation } from '../src/evaluation/metrics.js';
import { auditVisible } from '../src/evaluation/audit.js';
import { RecordedResponses, SnapshotReplayMap, assertReplayCompatible, type ReplayCompatibility } from '../src/evaluation/replay.js';
import { SnapshotStore } from '../src/hashline.js';
import { createDeck } from '../src/bootstrap.js';

class Clock implements EvaluationClock {
  time = 0; waiting: { at: number; done: () => void }[] = [];
  now() { return this.time; }
  until(at: number, signal?: AbortSignal): Promise<void> {
    if (at <= this.time) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const entry = { at, done: () => { signal?.removeEventListener('abort', cancel); resolve(); } };
      const cancel = () => { this.waiting = this.waiting.filter(e => e !== entry); reject(new Error('aborted')); };
      this.waiting.push(entry); signal?.addEventListener('abort', cancel, { once: true });
    });
  }
  async advance(at: number) {
    this.time = at;
    const due = this.waiting.filter(e => e.at <= at); this.waiting = this.waiting.filter(e => e.at > at); due.forEach(e => e.done());
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }
}
async function shortFixture() {
  const fixture = await loadFixture('fixtures/talks/edit-heavy.json');
  return { ...fixture, events: fixture.events.slice(0, 2).map((e, i) => ({ ...e, startMs: i * 10, endMs: i * 10 + 5, silenceAfterMs: i ? 10 : 0 })),
    expectations: [], timing: { ...fixture.timing, postTalkObservationMs: 5, maxDrainMs: 20 } };
}
const compatibility: ReplayCompatibility = { protocol: 'hashline-replay-v1', sourceSchema: 1, toolSchemaSha256: 'a'.repeat(64), promptSha256: 'b'.repeat(64), dependencies: [] };
const manifest = { schemaVersion: 1, sourceSha: 'a'.repeat(40), dirty: false, nodeVersion: process.version, platform: process.platform,
  startedAt: new Date().toISOString(), lockSha256: 'b'.repeat(64), promptSha256: 'c'.repeat(64), fixtureSha256: 'd'.repeat(64), dependencies: [], mode: 'actor-replay' };

test('absolute paced inputs continue while a durable receipt is blocked and final silence is honored', async () => {
  const clock = new Clock(), delivered: DeliveredInput[] = [];
  const host: EvaluationHost = { provenance: 'synthetic-test', deliverUtterance(input) {
    delivered.push(input);
    return input.id.endsWith('001') ? new Promise(() => {}) : Promise.resolve({ utteranceId: input.id, retainedAtMs: clock.now() });
  }, settled: async () => true };
  const fixture = await shortFixture(), running = runTalk(fixture, host, { clock, pollMs: 5 });
  await clock.advance(5); await clock.advance(15);
  assert.equal(delivered.length, 2);
  assert.deepEqual(delivered.map(d => d.deliveredAtMs), [5, 15]);
  assert.deepEqual(Object.keys(delivered[0]).sort(), ['deliveredAtMs', 'id', 'scheduledEndMs', 'text']);
  await clock.advance(29); assert.equal(clock.waiting.some(e => e.at === 30), true);
  await clock.advance(30); await clock.advance(35); await clock.advance(50);
  const result = await running;
  assert.equal(result.termination, 'deadline'); assert.equal(result.observationUntilMs, 30); assert.equal(result.deadlineMs, 50);
  assert.deepEqual(result.pendingInputIds, [fixture.events[0].id]); assert.equal(result.inputs[1].outcome, 'retained');
});

test('late driver wakeup records drift; unavailable host status cannot hang beyond drain deadline', async () => {
  const clock = new Clock(), fixture = await shortFixture();
  const host: EvaluationHost = { provenance: 'synthetic-test', deliverUtterance: async input => ({ utteranceId: input.id, retainedAtMs: clock.now() }), settled: () => new Promise(() => {}) };
  const running = runTalk(fixture, host, { clock });
  await clock.advance(8); await clock.advance(19); await clock.advance(30); await clock.advance(50);
  const result = await running;
  assert.deepEqual(result.inputs.map(i => i.deliveryDriftMs), [3, 4]);
  assert.equal(result.termination, 'deadline');
});

test('misses remain censored denominator entries and zero observations remain undefined', () => {
  const base: Observation = { expectationId: 'e1', utteranceId: 'u1', effect: 'visible', scheduledEndMs: 10, actualUtteranceEndMs: 15, deadlineMs: 100, evidence: [] };
  const result = summarizeObservations([base, { ...base, expectationId: 'e2', firstCorrectVisibleAtMs: 40, evidence: ['frame-40.png'] }]);
  assert.equal(result.visible.coverage, 0.5); assert.equal(result.visible.misses, 1);
  assert.equal(result.visible.latencyMs.max, 25); assert.equal(result.visible.scheduledLatencyMs.max, 30);
  assert.equal(result.visible.observedMaximumIsComplete, false);
  assert.equal(result.visible.results[0].latencyMs, null); assert.equal(result.visible.results[0].censoredAtMs, 85);
  assert.equal(quantiles([]).max, null); assert.equal(summarizeObservations([]).visible.coverage, null);
  assert.throws(() => summarizeObservations([{ ...base, firstCorrectVisibleAtMs: 20 }]), /evidence/);
});

test('visible audits reject wrong labels, offscreen/ Pending frames and unresolved target bindings', () => {
  const frame = { revision: 'r1', slideId: 's1', atMs: 20, painted: true, pending: false, evidence: 'frame.png', content: [{ nodeId: 'n1', text: '12.4%', kind: 'Stat', label: 'Growth' }] };
  const expected = { kind: 'number_exact', targetAlias: 'overview', value: '12.4%', label: 'Revenue' };
  const bindings = new Map([['overview', 's1']]);
  assert.equal(auditVisible(expected, frame, bindings).outcome, 'fail');
  assert.equal(auditVisible({ ...expected, label: 'Growth' }, frame, bindings).outcome, 'pass');
  assert.equal(auditVisible(expected, frame, new Map()).outcome, 'manual-review');
  assert.equal(auditVisible({ ...expected, label: 'Growth' }, { ...frame, pending: true }, bindings).outcome, 'fail');
  assert.equal(auditVisible({ ...expected, label: 'Growth' }, { ...frame, slideId: 'offscreen' }, bindings).outcome, 'fail');
  assert.equal(auditVisible({ kind: 'sparse_design', targetAlias: 'overview' }, frame, bindings).outcome, 'manual-review');
});

test('recorder preserves exact inference/tool bodies and rejects runtime credentials before writing', async () => {
  await mkdir('.artifacts/evaluation-tests', { recursive: true });
  const directory = await mkdtemp('.artifacts/evaluation-tests/record-');
  try {
    const recorder = await RunRecorder.create(directory, manifest, ['secret-runtime-key']);
    const requestBody = '{ "messages": [{ "role": "user", "content": "Exact & words" }] }';
    await recorder.model({ id: 'm1', inferenceId: 'i1', role: 'fast', provider: 'test', model: 'synthetic', startedAtMs: 1, finishedAtMs: 3, requestBody, responseBody: '{"output":"OK"}' });
    await recorder.tool({ id: 't1', name: 'read_source', argumentsJson: '{"nodeId":"n1"}', resultJson: '{"snapshotId":"issued"}', startedAtMs: 2, finishedAtMs: 3 });
    assert.throws(() => recorder.model({ id: 'm2', inferenceId: 'i2', role: 'fast', provider: 'test', model: 'synthetic', startedAtMs: 3, finishedAtMs: 4, requestBody: '{"headers":{"Authorization":"bad"}}' }), /Credential-bearing/);
    assert.throws(() => recorder.model({ id: 'm3', inferenceId: 'i3', role: 'fast', provider: 'test', model: 'synthetic', startedAtMs: 3, finishedAtMs: 4, requestBody: '{"messages":["secret-runtime-key"]}' }), /Credential value/);
    await recorder.flush();
    const files = await readdir(`${directory}/model`); assert.equal(files.length, 1);
    assert.equal(JSON.parse(await readFile(`${directory}/model/${files[0]}`, 'utf8')).requestBody, requestBody);
    await assert.rejects(RunRecorder.create(directory, manifest), /EEXIST/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('snapshot remapping checks every byte/hash/context and stays bijective', () => {
  const source = createDeck().source, a = new SnapshotStore().read(source, 'n10'), b = new SnapshotStore().read(source, 'n10');
  const map = new SnapshotReplayMap(); map.bind(a, b);
  assert.equal(map.transaction({ edits: [{ nodeId: 'n10', snapshotId: a.snapshotId, op: 'replace', startLine: 1, hashes: [a.lines[0].hash], text: a.lines[0].text }] }).edits[0].snapshotId, b.snapshotId);
  assert.throws(() => map.bind(a, b), /bijective/);
  assert.throws(() => new SnapshotReplayMap().bind(a, { ...b, lines: b.lines.map((l, i) => i ? l : { ...l, text: 'changed interior' }) }), /every hash/);
  assert.throws(() => assertReplayCompatible(compatibility, { ...compatibility, promptSha256: 'c'.repeat(64) }, 'actor'), /differs/);
  assert.doesNotThrow(() => assertReplayCompatible(compatibility, { ...compatibility, promptSha256: 'c'.repeat(64) }, 'transaction'));
});

test('actor model replay waits recorded latency and never repairs context or calls live fallback', async () => {
  const clock = new Clock();
  const model = new RecordedResponses({ schemaVersion: 1, provenance: 'synthetic-test', compatibility, responses: [{ id: 'r1', role: 'fast', requestBody: '{"exact":1}', responseBody: '{malformed literal response}', latencyMs: 25 }] }, compatibility, clock);
  await assert.rejects(model.respond('fast', '{"different":1}'), /request differs/);
  const promise = model.respond('fast', '{"exact":1}');
  await clock.advance(24); assert.equal(clock.waiting.length, 1);
  await clock.advance(25); assert.equal((await promise).responseBody, '{malformed literal response}');
  model.assertConsumed(); await assert.rejects(model.respond('fast', '{}'), /fallback is forbidden/);
});


test('async recorder failures are observed without delaying input delivery; hanging writes are bounded', async () => {
  for (const hangs of [false, true]) {
    const clock = new Clock(), fixture = await shortFixture();
    const delivered: string[] = [];
    const host: EvaluationHost = { provenance: 'synthetic-test', deliverUtterance: async input => { delivered.push(input.id); return { utteranceId: input.id, retainedAtMs: clock.now() }; }, settled: async () => true };
    const running = runTalk(fixture, host, { clock, onInput: async () => { if (hangs) await new Promise(() => {}); else throw new Error('disk failure'); }, onEvent: async () => { if (!hangs) throw new Error('event disk failure'); } });
    await clock.advance(5); await clock.advance(15); assert.equal(delivered.length, 2);
    await clock.advance(30); await clock.advance(50);
    const result = await running; assert.equal(result.recordingComplete, false);
    assert.match(result.errors.join(' '), hangs ? /drain deadline/ : /recording failed/);
  }
});
