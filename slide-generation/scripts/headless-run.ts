import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RunRecorder } from '../src/evaluation/recorder.js';
import { loadFixture } from '../src/evaluation/fixtures.js';
import { runTalk } from '../src/evaluation/driver.js';
import { monotonicClock } from '../src/evaluation/clock.js';
import { runMetricsSchema, summarizeObservations } from '../src/evaluation/metrics.js';
import { lineHash } from '../src/hashline.js';
import { createEvaluationHost, safeHeadlessError } from '../src/headless/evaluation-host.js';
import { auditHeadless } from '../src/headless/audit.js';
import { renderMarkdownReport } from '../src/headless/report.js';
import { models } from '../src/orchestration/config.js';
import { atomicWrite } from '../src/storage/files.js';

const { values } = parseArgs({ options: { fixture: { type: 'string' }, out: { type: 'string' }, repetition: { type: 'string' },
  'max-calls': { type: 'string' }, 'max-input-tokens': { type: 'string' }, 'max-output-tokens': { type: 'string' } }, strict: true });
if (!values.fixture || !values.out) throw new Error('Usage: headless-run --fixture FILE --out NEW_ARTIFACT_DIR [--repetition N] [--max-calls N]');
const root = fileURLToPath(new URL('../', import.meta.url)), fixturePath = resolve(values.fixture), fixture = await loadFixture(fixturePath);
const selectedModels = models(), limits = { maxCalls: Number(values['max-calls'] ?? 200), maxInputTokens: Number(values['max-input-tokens'] ?? 2_000_000),
  maxOutputTokens: Number(values['max-output-tokens'] ?? 100_000), maxOutputTokensPerCall: 8000 };
const prompt = await readFile(join(root, 'docs/AGENT_PROMPT.md'), 'utf8') + await readFile(join(root, 'SPEC.md'), 'utf8') + await readFile(join(root, 'src/host/jsx-backend.ts'), 'utf8');
const recorder = await RunRecorder.create(resolve(values.out), { schemaVersion: 1,
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  dirty: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0,
  nodeVersion: process.version, platform: `${process.platform}/${process.arch}`, startedAt: new Date().toISOString(),
  lockSha256: lineHash(await readFile(join(root, 'package-lock.json'), 'utf8')), promptSha256: lineHash(prompt),
  fixtureSha256: lineHash(await readFile(fixturePath, 'utf8')), dependencies: [],
  model: { provider: 'openai', name: selectedModels.fast, roles: selectedModels, serviceTier: 'fast',
    settingsSha256: lineHash(JSON.stringify({ models: selectedModels, limits, reasoning: { fast: 'none', slow: 'medium', specialist: 'low' }, decisionsTier: 'endpoint-default' })),
    maxCalls: limits.maxCalls, maxTokens: limits.maxOutputTokensPerCall }, mode: 'live',
}, [process.env.OPENAI_API_KEY, process.env.OPENAI_KEY].filter((value): value is string => !!value));
let host: Awaited<ReturnType<typeof createEvaluationHost>> | undefined;
const failures: { phase: string; error: string }[] = [];
const failed = (phase: string, error: unknown) => {
  const message = safeHeadlessError(error); failures.push({ phase, error: message });
  console.error(`${phase}: ${message}`); process.exitCode = 1;
};
try {
  host = await createEvaluationHost({ recorder, clock: monotonicClock, initialContext: fixture.initialContext,
    budget: { maxCalls: limits.maxCalls, maxTokens: limits.maxOutputTokensPerCall, serviceTier: 'fast' }, limits });
  console.log(JSON.stringify({ event: 'started', directory: recorder.directory, fixture: fixture.id, limits }));
  const run = await runTalk(fixture, host, { onInput: input => recorder.input({ ...input, ...(input.error ? { error: safeHeadlessError(input.error) } : {}) }), onEvent: event => {
    if (event.kind === 'input.delivered' || event.kind === 'run.finished') console.log(JSON.stringify(event));
    return recorder.driverEvent(event);
  } });
  // Preserve paced-delivery evidence before readiness or screenshot exports can fail.
  await atomicWrite(join(recorder.directory, 'driver-result.json'), JSON.stringify({ ...run,
    errors: run.errors.map(safeHeadlessError), inputs: run.inputs.map(input => ({ ...input, ...(input.error ? { error: safeHeadlessError(input.error) } : {}) })) }, null, 2));
  const facts = await host.finish(), evidence = host.finalEvidence();
  const audit = auditHeadless({ fixture, run, frames: evidence.frames, routes: host.routes, source: evidence.source,
    readiness: evidence.readiness!, readinessAtMs: evidence.readinessAtMs, readinessEvidence: evidence.readinessEvidence });
  const metrics = runMetricsSchema.parse({ schemaVersion: 1, fixtureId: fixture.id, repetition: Number(values.repetition ?? 1), pace: 1,
    provenance: 'real-system', observations: audit.observations, inputCount: fixture.events.length,
    retainedInputCount: run.inputs.filter(input => input.outcome === 'retained').length, termination: run.termination, ...facts,
    recordingComplete: facts.recordingComplete && run.recordingComplete });
  await recorder.summary('metrics.json', metrics); await recorder.summary('audit.json', audit.audit);
  await writeFile(join(recorder.directory, 'review.md'), renderMarkdownReport({ fixture, run, observations: audit.observations,
    audit: audit.audit, model: { calls: facts.modelCalls, inputTokens: facts.inputTokens, outputTokens: facts.outputTokens, costUsd: null,
      servedTiers: [...new Set(host.providers.records().map(r => r.returnedTier ?? 'unknown'))] }, finalSlides: host.finalSlides, viewerGalleryPath: 'viewer-gallery.html' }));
  if (run.termination !== 'settled') failed('driver', `Run terminated: ${run.termination}`);
  if (!metrics.recordingComplete || !facts.finalReady) failed('final checks', `Recording complete: ${metrics.recordingComplete}; ready: ${facts.finalReady}`);
  for (const error of host.errors) failed('host', error);
  console.log(JSON.stringify({ event: 'finished', directory: recorder.directory, termination: run.termination, ...facts,
    visible: summarizeObservations(audit.observations).visible }));
} catch (error) {
  failed('run', error);
} finally {
  try { await host?.close(); } catch (error) { failed('cleanup', error); }
  try { await recorder.flush(); } catch (error) { failed('recorder flush', error); }
  if (failures.length) {
    try { await recorder.summary('failure.json', { failures, hostErrors: (host?.errors ?? []).map(safeHeadlessError) }); }
    catch (error) { failed('failure artifact', error); }
  }
  try { await recorder.flush(); } catch (error) { failed('final recorder flush', error); }
}
