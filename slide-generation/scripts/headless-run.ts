import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, readdir, lstat, readlink, symlink } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RunRecorder } from '../src/evaluation/recorder.js';
import { loadFixture } from '../src/evaluation/fixtures.js';
import { runTalk } from '../src/evaluation/driver.js';
import { monotonicClock } from '../src/evaluation/clock.js';
import { runMetricsSchema, summarizeObservations } from '../src/evaluation/metrics.js';
import { lineHash } from '../src/hashline.js';
import { safeHeadlessError } from '../src/headless/evaluation-host.js';
import type { createEvaluationHost as CreateEvaluationHost } from '../src/headless/evaluation-host.js';
import { auditHeadless, buildCreationEvidence, type AuditHeadlessInput } from '../src/headless/audit.js';
import { renderMarkdownReport } from '../src/headless/report.js';
import type { models as Models } from '../src/orchestration/config.js';
import { verifyFrozenBaseline, type FrozenBaseline } from '../src/evaluation/freeze.js';
import { atomicWrite } from '../src/storage/files.js';
import { HeadlessViewer } from '../src/headless/viewer.js';
import { createHash } from 'node:crypto';

const { values } = parseArgs({ options: { fixture: { type: 'string' }, out: { type: 'string' }, repetition: { type: 'string' },
  recover: { type: 'boolean' }, frozen: { type: 'string' }, 'verify-only': { type: 'boolean' }, 'max-calls': { type: 'string' }, 'max-input-tokens': { type: 'string' }, 'max-output-tokens': { type: 'string' } }, strict: true });
if (!values.fixture || !values.out) throw new Error('Usage: headless-run --fixture FILE --out NEW_ARTIFACT_DIR [--repetition N] [--max-calls N] [--frozen DIRECTORY] [--verify-only] [--recover]');
const root = fileURLToPath(new URL('../', import.meta.url)), requestedFixture = resolve(values.fixture), outputContainer = resolve(values.out);
const outputRelative = relative(join(root, '.artifacts'), outputContainer);
if (!outputRelative || outputRelative.startsWith('..') || isAbsolute(outputRelative)) throw new Error('Run output must be inside current slide-generation/.artifacts');
const harnessSourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const harnessDirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0;
const evaluatorFiles = ['src/headless/audit.ts', 'src/headless/report.ts', 'src/evaluation/audit.ts', 'src/evaluation/driver.ts',
  'src/evaluation/fixtures.ts', 'src/evaluation/clock.ts', 'src/evaluation/metrics.ts', 'src/evaluation/recorder.ts', 'src/evaluation/manifest.ts',
  'src/headless/viewer.ts', 'src/viewer/document.ts', 'src/viewer/client.js', 'src/hashline.ts', 'src/parser.ts', 'src/schema.ts', 'src/contracts.ts', 'src/viewer/protocol.ts'];
const evaluatorSha256 = lineHash(JSON.stringify(await Promise.all(evaluatorFiles.sort().map(async file => [file, lineHash(await readFile(join(root, file), 'utf8'))]))));
const observerSha256 = lineHash(await readFile(join(root, 'src/headless/viewer.ts'), 'utf8'));
const harness = { observerSha256, sourceSha: harnessSourceSha, dirty: harnessDirty, runnerSha256: lineHash(await readFile(fileURLToPath(import.meta.url), 'utf8')), evaluatorSha256 };
// Recovery only reads completed evidence; it never constructs a host or calls a provider.
if (values.recover) {
  if (values.frozen || values['verify-only']) throw new Error('--recover cannot be combined with --frozen or --verify-only');
  await recoverReports(outputContainer, requestedFixture);
} else {
let generationRoot = root, runDirectory = outputContainer, fixturePath = requestedFixture, frozen: FrozenBaseline | undefined;
async function executionInventory(directory: string, prefix = ''): Promise<FrozenBaseline['files']> {
  const files: FrozenBaseline['files'] = [];
  for (const name of (await readdir(join(directory, prefix))).sort()) {
    const path = join(prefix, name), full = join(directory, path), stat = await lstat(full);
    if (stat.isSymbolicLink()) files.push({ path, kind: 'symlink', sha256: lineHash(await readlink(full)) });
    else if (stat.isDirectory()) files.push(...await executionInventory(directory, path));
    else if (stat.isFile()) files.push({ path, kind: 'file', sha256: createHash('sha256').update(await readFile(full)).digest('hex') });
    else throw new Error('Unsupported execution-export entry');
  }
  return files;
}
if (values.frozen) {
  const frozenDirectory = resolve(values.frozen);
  frozen = await verifyFrozenBaseline(frozenDirectory);
  if (frozen.files.some(file => /(^|\/)\.env(?:$|\.)/.test(file.path))) throw new Error('Frozen export contains an environment file; refusing to copy credentials');
  const fixtureRelative = relative(root, requestedFixture);
  if (fixtureRelative.startsWith('..') || isAbsolute(fixtureRelative)) throw new Error('Frozen runs require a tracked fixture inside slide-generation');
  const frozenPackage = join(frozenDirectory, 'repo/slide-generation');
  const frozenLock = await readFile(join(frozenPackage, 'package-lock.json'));
  if (!frozenLock.equals(await readFile(join(root, 'package-lock.json')))) throw new Error('Frozen lock differs from the shared installed dependency lock');
  if (!(await readFile(requestedFixture)).equals(await readFile(join(frozenPackage, fixtureRelative)))) throw new Error('Fixture differs from frozen source; comparison requires unchanged fixture bytes');
  await mkdir(dirname(outputContainer), { recursive: true });
  await mkdir(outputContainer, { recursive: false });
  const execution = join(outputContainer, 'execution'); await mkdir(execution);
  execFileSync('tar', ['-xf', join(frozenDirectory, 'source.tar'), '-C', execution]);
  if (JSON.stringify(await executionInventory(execution)) !== JSON.stringify(frozen.files)) throw new Error('Execution source copy differs from the verified frozen inventory');
  // Shared dependencies sit outside package source. Never add files to the immutable baseline.
  await symlink(join(root, 'node_modules'), join(execution, 'node_modules'), 'dir');
  generationRoot = join(execution, 'slide-generation'); runDirectory = join(generationRoot, '.artifacts/run');
  fixturePath = join(generationRoot, fixtureRelative);
  for (const file of ['src/viewer/client.js', 'src/viewer/document.ts', 'src/viewer/protocol.ts'])
    if (!(await readFile(join(generationRoot, file))).equals(await readFile(join(root, file)))) throw new Error(`Frozen viewer behavior differs: ${file}; common observation cannot silently change presentation semantics`);
  const frozenObserver = await import(pathToFileURL(join(generationRoot, 'src/headless/viewer.ts')).href) as { HeadlessViewer: { create: typeof HeadlessViewer.create } };
  frozenObserver.HeadlessViewer.create = HeadlessViewer.create.bind(HeadlessViewer);
  await writeFile(join(outputContainer, 'run-location.json'), JSON.stringify({ runDirectory: relative(outputContainer, runDirectory),
    frozenSourceSha: frozen.sourceSha, archiveSha256: frozen.archiveSha256, evaluatorSha256, observerSha256, harness, sourceCopyVerified: true,
    observationBridge: 'Current HeadlessViewer factory; frozen RecordingSession/GenerationSession/generator unchanged; viewer client/document/protocol byte-identical' }, null, 2), { flag: 'wx' });
}
// The generator comes from the selected source; evaluation stays common for both versions.
const { createEvaluationHost } = await import(pathToFileURL(join(generationRoot, 'src/headless/evaluation-host.ts')).href) as { createEvaluationHost: typeof CreateEvaluationHost };
const { models } = await import(pathToFileURL(join(generationRoot, 'src/orchestration/config.ts')).href) as { models: typeof Models };
const fixture = await loadFixture(fixturePath);
const selectedModels = models(), limits = { maxCalls: Number(values['max-calls'] ?? 200), maxInputTokens: Number(values['max-input-tokens'] ?? 2_000_000),
  maxOutputTokens: Number(values['max-output-tokens'] ?? 100_000), maxOutputTokensPerCall: 8000 };
const prompt = await readFile(join(generationRoot, 'docs/AGENT_PROMPT.md'), 'utf8') + await readFile(join(generationRoot, 'SPEC.md'), 'utf8') + await readFile(join(generationRoot, 'src/host/jsx-backend.ts'), 'utf8');
const manifest = { schemaVersion: 1, sourceSha: frozen?.sourceSha ?? harnessSourceSha, dirty: frozen ? false : harnessDirty, harness,
  nodeVersion: process.version, platform: `${process.platform}/${process.arch}`, startedAt: new Date().toISOString(),
  lockSha256: lineHash(await readFile(join(generationRoot, 'package-lock.json'), 'utf8')), promptSha256: lineHash(prompt),
  fixtureSha256: lineHash(await readFile(fixturePath, 'utf8')), dependencies: [],
  model: { provider: 'openai', name: selectedModels.fast, roles: selectedModels, serviceTier: 'fast',
    settingsSha256: lineHash(JSON.stringify({ models: selectedModels, limits, reasoning: { fast: 'none', slow: 'medium', specialist: 'low' }, decisionsTier: 'endpoint-default' })),
    maxCalls: limits.maxCalls, maxTokens: limits.maxOutputTokensPerCall }, mode: 'live',
};
if (values['verify-only']) {
  console.log(JSON.stringify({ event: 'verified', directory: runDirectory, generationRoot, fixture: fixture.id, manifest, paidCalls: 0 }));
} else {
const recorder = await RunRecorder.create(runDirectory, manifest, [process.env.OPENAI_API_KEY, process.env.OPENAI_KEY].filter((value): value is string => !!value));
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
  let finishFailure: ReturnType<typeof errorEvidence> | undefined;
  try { await host.finish(); } catch (error) {
    finishFailure = errorEvidence(error); failed('finalization', error);
    try { await atomicWrite(join(recorder.directory, 'finalization-error.json'), JSON.stringify(finishFailure, null, 2)); }
    catch (exportError) { failed('finalization error export', exportError); }
  }
  const evidence = host.finalEvidence(), budget = host.providers.budget.snapshot();
  const facts = { recordingComplete: !finishFailure && !host.errors.length && !recorder.failures.length && !host.backend.recordingFailures.length,
    finalReady: evidence.readiness?.complete ? evidence.readiness.ready : null,
    modelCalls: budget.calls, inputTokens: budget.observedInputTokens, outputTokens: budget.observedOutputTokens, costUsd: null };
  const { audit, metrics } = await produceReports({ directory: recorder.directory, fixture, run,
    evidence, routes: host.routes, facts, finalSlides: host.finalSlides,
    servedTiers: [...new Set(host.providers.records().map(r => r.returnedTier ?? 'unknown'))],
    failures: finishFailure ? [finishFailure] : [], writeJson: (name, data) => recorder.summary(name, data) });
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

}

}

function errorEvidence(error: unknown): { name: string; message: string; stack?: string; causes?: unknown[] } {
  return { name: error instanceof Error ? error.name : typeof error, message: safeHeadlessError(error),
    ...(error instanceof Error && error.stack ? { stack: safeHeadlessError(error.stack) } : {}),
    ...(error instanceof AggregateError ? { causes: error.errors.map(errorEvidence) } : {}),
    ...(error instanceof Error && error.cause ? { causes: [errorEvidence(error.cause)] } : {}) };
}
type Facts = Pick<ReturnType<typeof runMetricsSchema.parse>, 'recordingComplete' | 'finalReady' | 'modelCalls' | 'inputTokens' | 'outputTokens' | 'costUsd'>;
async function produceReports(input: {
  directory: string; fixture: AuditHeadlessInput['fixture']; run: AuditHeadlessInput['run'];
  evidence: { source: string; frames: AuditHeadlessInput['frames']; readiness?: AuditHeadlessInput['readiness']; readinessAtMs?: number; readinessEvidence?: string };
  routes: AuditHeadlessInput['routes']; facts: Facts; finalSlides: { slideId: string; path: string }[]; servedTiers: string[]; failures: unknown[];
  writeJson: (name: 'metrics.json' | 'audit.json', data: unknown) => Promise<void>;
}) {
  const limitations: string[] = [];
  let creationEvidence: ReturnType<typeof buildCreationEvidence> = [];
  try {
    creationEvidence = buildCreationEvidence(JSON.parse(await readFile(join(input.directory, 'initial.json'), 'utf8')),
      JSON.parse(await readFile(join(input.directory, 'commits.json'), 'utf8')), JSON.parse(await readFile(join(input.directory, 'operations.json'), 'utf8')));
  } catch (error) { limitations.push(`Creation evidence unavailable: ${safeHeadlessError(error)}`); }
  const { evidence, facts, fixture, run } = input;
  const audit = auditHeadless({ fixture, run, creationEvidence, frames: evidence.frames, routes: input.routes, source: evidence.source,
    readiness: evidence.readiness ?? { complete: false, ready: false },
    readinessAtMs: evidence.readinessAtMs, readinessEvidence: evidence.readinessEvidence });
  if (!evidence.readiness) {
    limitations.push('Final readiness was not measured; finalReady is unknown. No readiness or screenshot evidence was synthesized.');
    audit.audit.finalChecks.presentationReady = { outcome: 'manual-review', reason: 'Final readiness unavailable after finalization failure', evidence: [] };
  }
  audit.audit.limitations.push(...limitations);
  const metrics = runMetricsSchema.parse({ schemaVersion: 1, fixtureId: fixture.id, repetition: Number(values.repetition ?? 1), pace: 1,
    provenance: 'real-system', observations: audit.observations, inputCount: fixture.events.length,
    retainedInputCount: run.inputs.filter(record => record.outcome === 'retained').length, termination: run.termination, ...facts,
    recordingComplete: facts.recordingComplete && run.recordingComplete && limitations.length === 0 });
  const review = renderMarkdownReport({ fixture, run: { ...run, recordingComplete: metrics.recordingComplete }, observations: audit.observations,
    audit: audit.audit, model: { calls: facts.modelCalls, inputTokens: facts.inputTokens, outputTokens: facts.outputTokens, costUsd: facts.costUsd,
      servedTiers: input.servedTiers }, finalSlides: input.finalSlides, viewerGalleryPath: 'viewer-gallery.html' })
    + `\nFinal readiness: ${facts.finalReady === null ? 'unknown' : facts.finalReady}.\n`
    + (input.failures.length ? `\nFinalization/recovery errors (original evidence retained):\n\n\`\`\`json\n${JSON.stringify(input.failures, null, 2)}\n\`\`\`\n` : '')
    + limitations.map(text => `\n- ${text}\n`).join('');
  // A failed audit/review write must not prevent independent metrics from surviving.
  const written = await Promise.allSettled([input.writeJson('metrics.json', metrics), input.writeJson('audit.json', audit.audit),
    writeFile(join(input.directory, 'review.md'), review, { flag: 'wx' })]);
  const errors = written.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
  if (errors.length) throw new AggregateError(errors, 'Partial run report export failed');
  return { audit, metrics };
}
async function recoverReports(directory: string, fixtureFile: string) {
  const readJson = async (name: string) => JSON.parse(await readFile(join(directory, name), 'utf8'));
  for (const name of ['metrics.json', 'audit.json', 'review.md', 'recovery.json']) {
    try { await lstat(join(directory, name)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error;
    }
    throw new Error(`Recovery refuses to replace existing ${name}; retain the original report`);
  }
  const originalManifest = await readJson('manifest.json');
  if (originalManifest.fixtureSha256 !== lineHash(await readFile(fixtureFile, 'utf8'))) throw new Error('Recovery fixture differs from recorded fixture');
  const fixture = await loadFixture(fixtureFile), run = await readJson('driver-result.json') as AuditHeadlessInput['run'];
  // Require the original runner to have finished cleanup; do not race an active recorder.
  const originalFailure = await readJson('failure.json');
  const optional = async (name: string) => { try { return await readJson(name); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error;
  } };
  const budget = await optional('provider-statistics.json'), readiness = await optional('final/readiness.json');
  const source = await readFile(join(directory, 'final/deck.jsx'), 'utf8');
  const frames: AuditHeadlessInput['frames'][number][] = [];
  for (const name of await readdir(join(directory, 'viewer'))) if (name.endsWith('.json')) {
    const value = await readJson(`viewer/${name}`); if ('content' in value && 'evidence' in value && 'atMs' in value) frames.push(value);
  }
  frames.sort((a, b) => a.atMs - b.atMs);
  const finalSlides = (await readdir(join(directory, 'final'))).filter(name => /^slide-.+\.jpg$/.test(name))
    .map(name => ({ slideId: name.slice(6, -4), path: `final/${name}` }));
  const modelRecords = await Promise.all((await readdir(join(directory, 'model'))).filter(name => name.endsWith('.json')).map(name => readJson(`model/${name}`)));
  const facts: Facts = { recordingComplete: false, finalReady: readiness?.complete ? readiness.ready : null,
    modelCalls: budget?.calls ?? null, inputTokens: budget?.observedInputTokens ?? null, outputTokens: budget?.observedOutputTokens ?? null, costUsd: null };
  const recovery = { recoveredAt: new Date().toISOString(), harness, originalManifestSha256: lineHash(await readFile(join(directory, 'manifest.json'), 'utf8')),
    mode: 'offline-evidence-only', paidCalls: 0, originalFailure };
  await writeFile(join(directory, 'recovery.json'), JSON.stringify(recovery, null, 2), { flag: 'wx' });
  await produceReports({ directory, fixture, run, evidence: { source, frames, readiness, readinessAtMs: readiness?.atMs,
    readinessEvidence: readiness ? 'final/readiness.json' : undefined }, routes: await readJson('routes.json'), facts, finalSlides,
    servedTiers: [...new Set(modelRecords.map(record => String(record.returnedTier ?? 'unknown')))], failures: [originalFailure],
    writeJson: (name, data) => writeFile(join(directory, name), JSON.stringify(data, null, 2), { flag: 'wx' }) });
  console.log(JSON.stringify({ event: 'recovered-failed-run', directory, ...facts, paidCalls: 0 }));
  process.exitCode = 1; // Producing a report never turns this failed trial into a successful run.
}
