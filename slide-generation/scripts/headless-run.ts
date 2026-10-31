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
import { auditHeadless, buildCreationEvidence } from '../src/headless/audit.js';
import { renderMarkdownReport } from '../src/headless/report.js';
import type { models as Models } from '../src/orchestration/config.js';
import { verifyFrozenBaseline, type FrozenBaseline } from '../src/evaluation/freeze.js';
import { atomicWrite } from '../src/storage/files.js';
import { HeadlessViewer } from '../src/headless/viewer.js';
import { createHash } from 'node:crypto';

const { values } = parseArgs({ options: { fixture: { type: 'string' }, out: { type: 'string' }, repetition: { type: 'string' },
  frozen: { type: 'string' }, 'verify-only': { type: 'boolean' }, 'max-calls': { type: 'string' }, 'max-input-tokens': { type: 'string' }, 'max-output-tokens': { type: 'string' } }, strict: true });
if (!values.fixture || !values.out) throw new Error('Usage: headless-run --fixture FILE --out NEW_ARTIFACT_DIR [--repetition N] [--max-calls N] [--frozen DIRECTORY] [--verify-only]');
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
  const facts = await host.finish(), evidence = host.finalEvidence();
  const creationEvidence = buildCreationEvidence(JSON.parse(await readFile(join(recorder.directory, 'initial.json'), 'utf8')),
    JSON.parse(await readFile(join(recorder.directory, 'commits.json'), 'utf8')), JSON.parse(await readFile(join(recorder.directory, 'operations.json'), 'utf8')));
  const audit = auditHeadless({ fixture, run, creationEvidence, frames: evidence.frames, routes: host.routes, source: evidence.source,
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

}
