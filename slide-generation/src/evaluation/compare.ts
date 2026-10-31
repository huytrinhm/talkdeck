import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { manifestSchema } from './manifest.js';
import { runMetricsSchema, summarizeObservations, type RunMetrics } from './metrics.js';
import type { FrozenBaseline } from './freeze.js';
export interface RunEvidence { directory: string; manifest: z.infer<typeof manifestSchema>; metrics: RunMetrics }
export async function loadRun(directory: string): Promise<RunEvidence> {
  return { directory, manifest: manifestSchema.parse(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))),
    metrics: runMetricsSchema.parse(JSON.parse(await readFile(join(directory, 'metrics.json'), 'utf8'))) };
}
export function compareRuns(baselines: RunEvidence[], candidates: RunEvidence[], frozen: FrozenBaseline) {
  if (!baselines.length || !candidates.length) throw new Error('Comparison requires previous and candidate runs');
  const key = (run: RunEvidence) => `${run.metrics.fixtureId}:${run.metrics.repetition}`;
  const before = new Map(baselines.map(run => [key(run), run]));
  if (before.size !== baselines.length || new Set(candidates.map(key)).size !== candidates.length) throw new Error('Duplicate script/repetition comparison pair');
  if (candidates.length !== baselines.length || candidates.some(run => !before.has(key(run)))) throw new Error('Every candidate run needs its matched script/repetition baseline');
  const pairs = candidates.map(candidate => {
    const baseline = before.get(key(candidate))!;
    if (baseline.manifest.sourceSha !== frozen.sourceSha || baseline.manifest.dirty || candidate.manifest.dirty || candidate.manifest.sourceSha === frozen.sourceSha)
      throw new Error('Baseline must be the frozen previous committed source; candidate must be a distinct committed source');
    const conditions = (run: RunEvidence) => JSON.stringify({ fixture: run.manifest.fixtureSha256, model: run.manifest.model, pace: run.metrics.pace,
      evaluator: run.manifest.harness?.evaluatorSha256, observer: run.manifest.harness?.observerSha256,
      dependencies: run.manifest.dependencies.filter(d => /font|asset|lucide/i.test(d.name)).sort((a, b) => a.name.localeCompare(b.name)) });
    if (conditions(baseline) !== conditions(candidate)) throw new Error('Fixture, model, pace, evaluator, observer or resolved assets/fonts changed; rerun both versions under common conditions');
    const instrumentationVerified = !!baseline.manifest.harness?.evaluatorSha256 && !!baseline.manifest.harness?.observerSha256
      && !!candidate.manifest.harness?.evaluatorSha256 && !!candidate.manifest.harness?.observerSha256;
    const a = summarizeObservations(baseline.metrics.observations), b = summarizeObservations(candidate.metrics.observations);
    const live = baseline.manifest.mode === 'live' && candidate.manifest.mode === 'live' && baseline.metrics.provenance === 'real-system' && candidate.metrics.provenance === 'real-system';
    const identities = (run: RunEvidence, successesOnly = false) => JSON.stringify(run.metrics.observations
      .filter(o => !successesOnly || (o.effect === 'visible' ? o.firstCorrectVisibleAtMs : o.readyAtMs) !== undefined)
      .map(o => JSON.stringify([o.expectationId, o.utteranceId, o.effect])).sort());
    const comparableWork = identities(baseline) === identities(candidate) && identities(baseline, true) === identities(candidate, true)
      && baseline.metrics.inputCount === candidate.metrics.inputCount && baseline.metrics.retainedInputCount === candidate.metrics.retainedInputCount;
    return { fixtureId: candidate.metrics.fixtureId, repetition: candidate.metrics.repetition, baselineDirectory: baseline.directory, candidateDirectory: candidate.directory,
      kind: live ? 'live-comparison' as const : 'offline-regression-comparison' as const,
      baseline: a, candidate: b, comparableWork, instrumentationVerified,
      p50ChangeMs: live && instrumentationVerified && comparableWork && a.visible.latencyMs.p50 !== null && b.visible.latencyMs.p50 !== null ? b.visible.latencyMs.p50 - a.visible.latencyMs.p50 : null,
      missingOrIncomplete: !instrumentationVerified || baseline.metrics.termination !== 'settled' || candidate.metrics.termination !== 'settled' || baseline.metrics.inputCount === 0 || candidate.metrics.inputCount === 0 || baseline.metrics.modelCalls === 0 || candidate.metrics.modelCalls === 0 || a.visible.expected === 0 || b.visible.expected === 0 || baseline.metrics.retainedInputCount !== baseline.metrics.inputCount || candidate.metrics.retainedInputCount !== candidate.metrics.inputCount || baseline.metrics.modelCalls === null || candidate.metrics.modelCalls === null || !baseline.metrics.recordingComplete || !candidate.metrics.recordingComplete || a.visible.misses > 0 || b.visible.misses > 0,
      promptChanged: baseline.manifest.promptSha256 !== candidate.manifest.promptSha256,
      baselineCostUsd: baseline.metrics.costUsd, candidateCostUsd: candidate.metrics.costUsd,
      candidateReady: candidate.metrics.finalReady,
    };
  });
  return { schemaVersion: 1, baselineSha: frozen.sourceSha, pairs,
    qualificationComplete: false,
    requiredReviews: ['raw-input and notes faithfulness', 'visible timeline and obsolete-value audit', 'design and visual correctness', 'actual host integration'],
    measurementSetComplete: pairs.every(pair => pair.kind === 'live-comparison' && pair.comparableWork && !pair.missingOrIncomplete && pair.candidateReady === true)
      && ['long-technical', 'numbers-business', 'narrative-keynote', 'edit-heavy', 'style-switch'].every(id => pairs.some(p => p.fixtureId === id)) && [...new Set(pairs.map(p => p.fixtureId))].every(id => pairs.filter(p => p.fixtureId === id).length >= 3),
    caveat: 'Matching evaluator and observer fingerprints are required for performance claims; historical manifests without them remain incomplete. Repetitions are the uncertainty unit. Finite observed maxima exclude censored misses; replay timings do not establish live latency improvements.' };
}
export function comparisonReport(result: ReturnType<typeof compareRuns>) {
  const rows = result.pairs.map(p => `| ${p.fixtureId} | ${p.repetition} | ${p.baseline.visible.successes}/${p.baseline.visible.expected} | ${p.candidate.visible.successes}/${p.candidate.visible.expected} | ${p.baseline.visible.latencyMs.p50 ?? 'undefined'} | ${p.candidate.visible.latencyMs.p50 ?? 'undefined'} | ${p.p50ChangeMs ?? 'not comparable'} | ${p.missingOrIncomplete ? 'incomplete' : p.kind} |`);
  return `Frozen baseline: ${result.baselineSha}\n\n| Talk | Repetition | Before visible coverage | After visible coverage | Before p50 ms | After p50 ms | Change ms | Evidence status |\n|---|---:|---:|---:|---:|---:|---:|---|\n${rows.join('\n')}\n\n${result.caveat}\n\nMeasurement set complete: ${result.measurementSetComplete}. Qualification complete: ${result.qualificationComplete}. Manual faithfulness/design review and visible timelines remain required; this table alone cannot establish them.\n`;
}
