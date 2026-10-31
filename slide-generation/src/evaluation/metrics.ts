import { z } from 'zod';
const ms = z.number().finite().nonnegative();
export const observationSchema = z.object({
  expectationId: z.string(), utteranceId: z.string(), effect: z.enum(['visible', 'ready']),
  scheduledEndMs: ms, actualUtteranceEndMs: ms, deadlineMs: ms,
  firstVisibleAtMs: ms.optional(), firstCorrectVisibleAtMs: ms.optional(), readyAtMs: ms.optional(), settledAtMs: ms.optional(),
  evidence: z.array(z.string()), missingReason: z.enum(['not-observed', 'superseded-before-display', 'offscreen', 'check-unavailable', 'manual-review']).optional(),
}).strict().superRefine((o, ctx) => {
  const end = o.effect === 'visible' ? o.firstCorrectVisibleAtMs : o.readyAtMs;
  if (end !== undefined && (end < o.actualUtteranceEndMs || end > o.deadlineMs || o.evidence.length === 0))
    ctx.addIssue({ code: 'custom', message: 'Success requires bounded timestamps and evidence references' });
});
export type Observation = z.infer<typeof observationSchema>;
export function quantiles(values: readonly number[]) {
  if (!values.length) return { count: 0, p50: null, p90: null, p95: null, max: null };
  if (values.some(n => !Number.isFinite(n) || n < 0)) throw new Error('Latency samples must be finite and nonnegative');
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  return { count: sorted.length, p50: q(0.5), p90: q(0.9), p95: q(0.95), max: sorted.at(-1)! };
}
export function summarizeObservations(input: readonly Observation[]) {
  const observations = input.map(o => observationSchema.parse(o));
  const group = (effect: Observation['effect']) => {
    const all = observations.filter(o => o.effect === effect);
    const results = all.map(o => {
      const time = effect === 'visible' ? o.firstCorrectVisibleAtMs : o.readyAtMs;
      return { expectationId: o.expectationId, utteranceId: o.utteranceId,
        outcome: time === undefined ? 'miss' as const : 'success' as const,
        latencyMs: time === undefined ? null : time - o.actualUtteranceEndMs,
        scheduledLatencyMs: time === undefined ? null : time - o.scheduledEndMs,
        censoredAtMs: time === undefined ? o.deadlineMs - o.actualUtteranceEndMs : null,
        reason: time === undefined ? o.missingReason ?? 'not-observed' : undefined, evidence: o.evidence };
    });
    const successes = results.filter(r => r.outcome === 'success');
    return { expected: all.length, successes: successes.length, misses: all.length - successes.length,
      coverage: all.length ? successes.length / all.length : null,
      latencyMs: quantiles(successes.map(r => r.latencyMs!)), scheduledLatencyMs: quantiles(successes.map(r => r.scheduledLatencyMs!)),
      observedMaximumIsComplete: all.length > 0 && successes.length === all.length,
      results };
  };
  return { visible: group('visible'), ready: group('ready') };
}
export const runMetricsSchema = z.object({
  schemaVersion: z.literal(1), fixtureId: z.string().min(1), repetition: z.number().int().positive(), pace: z.literal(1),
  provenance: z.enum(['real-system', 'recorded-host', 'synthetic-test']),
  observations: z.array(observationSchema), inputCount: z.number().int().nonnegative(), retainedInputCount: z.number().int().nonnegative(),
  termination: z.enum(['settled', 'deadline', 'aborted', 'host-error']),
  recordingComplete: z.boolean(), finalReady: z.boolean().nullable(),
  modelCalls: z.number().int().nonnegative().nullable(), inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(),
  costUsd: z.number().nonnegative().nullable(),
}).strict().superRefine((r, ctx) => {
  if (r.retainedInputCount > r.inputCount) ctx.addIssue({ code: 'custom', message: 'Retained input exceeds delivered input' });
  const ids = r.observations.map(o => o.expectationId);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Duplicate expectation observations' });
});
export type RunMetrics = z.infer<typeof runMetricsSchema>;
