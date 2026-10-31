import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { compareRuns, comparisonReport, type RunEvidence } from '../src/evaluation/compare.js';
import { verifyFrozenBaseline, type FrozenBaseline } from '../src/evaluation/freeze.js';
import { disableReplayNetwork } from '../src/evaluation/offline.js';
import { lineHash } from '../src/hashline.js';

const frozen: FrozenBaseline = { schemaVersion: 1, sourceSha: 'a'.repeat(40), createdAt: new Date().toISOString(), archiveSha256: 'b'.repeat(64), files: [] };
function run(candidate: boolean, live = false): RunEvidence {
  return { directory: candidate ? 'candidate' : 'baseline', manifest: {
    schemaVersion: 1, sourceSha: (candidate ? 'c' : 'a').repeat(40), dirty: false, nodeVersion: process.version, platform: process.platform,
    startedAt: new Date().toISOString(), lockSha256: 'b'.repeat(64), promptSha256: 'c'.repeat(64), fixtureSha256: 'd'.repeat(64), dependencies: [], mode: live ? 'live' : 'actor-replay',
    harness: { sourceSha: 'f'.repeat(40), dirty: false, runnerSha256: '1'.repeat(64), evaluatorSha256: '2'.repeat(64), observerSha256: '3'.repeat(64) },
    model: { provider: 'recorded-test', name: 'synthetic', maxCalls: 2, maxTokens: 100 },
  }, metrics: { schemaVersion: 1, fixtureId: 'edit-heavy', repetition: 1, pace: 1, provenance: live ? 'real-system' : 'synthetic-test',
    observations: [{ expectationId: 'e1', utteranceId: 'u1', effect: 'visible', scheduledEndMs: 1, actualUtteranceEndMs: 2, deadlineMs: 100,
      firstCorrectVisibleAtMs: candidate ? 20 : 30, evidence: ['frame.png'] }], inputCount: 1, retainedInputCount: 1,
    termination: 'settled', recordingComplete: true, finalReady: true, modelCalls: 1, inputTokens: 10, outputTokens: 10, costUsd: null } };
}
test('comparison never reports replay timing as a live performance gain or qualifies one repetition', () => {
  const offline = compareRuns([run(false)], [run(true)], frozen);
  assert.equal(offline.pairs[0].kind, 'offline-regression-comparison'); assert.equal(offline.pairs[0].p50ChangeMs, null);
  assert.equal(offline.qualificationComplete, false);
  const live = compareRuns([run(false, true)], [run(true, true)], frozen);
  assert.equal(live.pairs[0].p50ChangeMs, -10); assert.equal(live.qualificationComplete, false);
  assert.match(comparisonReport(offline), /not comparable/);
});
test('comparison refuses changed workload/model or a relabeled baseline, and exposes missing work', () => {
  const baseline = run(false, true), candidate = run(true, true);
  assert.throws(() => compareRuns([baseline], [{ ...candidate, manifest: { ...candidate.manifest, sourceSha: frozen.sourceSha } }], frozen), /distinct committed/);
  assert.throws(() => compareRuns([baseline], [{ ...candidate, manifest: { ...candidate.manifest, fixtureSha256: 'e'.repeat(64) } }], frozen), /common conditions/);
  assert.throws(() => compareRuns([baseline], [{ ...candidate, manifest: { ...candidate.manifest,
    model: { ...candidate.manifest.model!, serviceTier: 'fast' } } }], frozen), /common conditions/);
  const incomplete = { ...candidate, metrics: { ...candidate.metrics, observations: [{ ...candidate.metrics.observations[0], firstCorrectVisibleAtMs: undefined, evidence: [] }] } };
  const compared = compareRuns([baseline], [incomplete], frozen);
  assert.equal(compared.pairs[0].missingOrIncomplete, true); assert.equal(compared.pairs[0].p50ChangeMs, null);
  assert.equal(compareRuns([baseline], [{ ...candidate, metrics: { ...candidate.metrics, observations: [] } }], frozen).pairs[0].missingOrIncomplete, true);
});
test('frozen export verifier detects changed, added and missing source without touching another branch', async () => {
  await mkdir('.artifacts/evaluation-tests', { recursive: true });
  const path = await mkdtemp('.artifacts/evaluation-tests/frozen-');
  try {
    await mkdir(join(path, 'repo')); await writeFile(join(path, 'source.tar'), 'synthetic archive bytes'); await writeFile(join(path, 'repo/source.ts'), 'original');
    const record = { ...frozen, archiveSha256: lineHash('synthetic archive bytes'), files: [{ path: 'source.ts', kind: 'file', sha256: lineHash('original') }] };
    await writeFile(join(path, 'freeze.json'), JSON.stringify(record));
    assert.equal((await verifyFrozenBaseline(path)).sourceSha, frozen.sourceSha);
    await writeFile(join(path, 'repo/source.ts'), 'changed'); await assert.rejects(verifyFrozenBaseline(path), /changed/);
    await writeFile(join(path, 'repo/source.ts'), 'original'); await writeFile(join(path, 'repo/extra.ts'), 'new'); await assert.rejects(verifyFrozenBaseline(path), /changed/);
    await rm(join(path, 'repo/extra.ts')); await rm(join(path, 'repo/source.ts')); await assert.rejects(verifyFrozenBaseline(path), /changed/);
  } finally { await rm(path, { recursive: true, force: true }); }
});
test('offline replay guard blocks fetch/http/TCP and restores methods after use', () => {
  const fetchBefore = globalThis.fetch, guard = disableReplayNetwork();
  try {
    assert.throws(() => globalThis.fetch('https://example.invalid'), /live fallback/);
    assert.throws(() => http.get('http://example.invalid'), /live fallback/);
    assert.throws(() => new net.Socket().connect(443, 'example.invalid'), /live fallback/);
    assert.equal(guard.evidence().blockedAttempts, 3);
    assert.equal(guard.evidence().osNetworkNamespace, false);
  } finally { guard.restore(); }
  assert.equal(globalThis.fetch, fetchBefore);
});


test('equal success counts for different expectations, utterances or effects cannot claim speed', () => {
  const baseline = run(false, true), candidate = run(true, true);
  for (const mutation of [{ expectationId: 'different' }, { utteranceId: 'different' }, { effect: 'ready' as const, firstCorrectVisibleAtMs: undefined, readyAtMs: 20 }]) {
    const changed = { ...candidate, metrics: { ...candidate.metrics, observations: [{ ...candidate.metrics.observations[0], ...mutation }] } };
    const result = compareRuns([baseline], [changed], frozen);
    assert.equal(result.pairs[0].comparableWork, false); assert.equal(result.pairs[0].p50ChangeMs, null);
  }
  baseline.metrics.observations.push({ ...baseline.metrics.observations[0], expectationId: 'e2', firstCorrectVisibleAtMs: undefined, evidence: [] });
  candidate.metrics.observations = [{ ...candidate.metrics.observations[0], firstCorrectVisibleAtMs: undefined, evidence: [] }, { ...candidate.metrics.observations[0], expectationId: 'e2' }];
  assert.equal(compareRuns([baseline], [candidate], frozen).pairs[0].comparableWork, false);
});

test('complete fifteen-run measurement set still requires explicit higher-priority reviews', () => {
  const before: RunEvidence[] = [], after: RunEvidence[] = [];
  for (const id of ['long-technical', 'numbers-business', 'narrative-keynote', 'edit-heavy', 'style-switch']) for (let repetition = 1; repetition <= 3; repetition++) {
    for (const [candidate, target] of [[false, before], [true, after]] as const) {
      const entry = run(candidate, true); entry.metrics.fixtureId = id; entry.metrics.repetition = repetition; target.push(entry);
    }
  }
  const result = compareRuns(before, after, frozen);
  assert.equal(result.measurementSetComplete, true); assert.equal(result.qualificationComplete, false);
  assert.ok(result.requiredReviews.length > 0);
});


test('comparison requires common evaluator and observer, independently of harness checkout or runner bytes', () => {
  const baseline = run(false, true), candidate = run(true, true);
  candidate.manifest.harness = { ...candidate.manifest.harness!, sourceSha: 'e'.repeat(40), runnerSha256: '4'.repeat(64), dirty: true };
  assert.equal(compareRuns([baseline], [candidate], frozen).pairs[0].p50ChangeMs, -10);
  for (const field of ['evaluatorSha256', 'observerSha256'] as const) {
    const altered = structuredClone(candidate); altered.manifest.harness![field] = '5'.repeat(64);
    assert.throws(() => compareRuns([baseline], [altered], frozen), /common conditions/);
  }
  const absentObserver = structuredClone(candidate); delete absentObserver.manifest.harness!.observerSha256;
  assert.throws(() => compareRuns([baseline], [absentObserver], frozen), /common conditions/);
  delete baseline.manifest.harness; delete candidate.manifest.harness;
  const historical = compareRuns([baseline], [candidate], frozen);
  assert.equal(historical.pairs[0].instrumentationVerified, false);
  assert.equal(historical.pairs[0].p50ChangeMs, null);
  assert.equal(historical.pairs[0].missingOrIncomplete, true);
  assert.equal(historical.measurementSetComplete, false);
});
