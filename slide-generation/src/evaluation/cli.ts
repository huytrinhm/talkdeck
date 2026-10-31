import { parseArgs } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { loadFixture } from './fixtures.js';
import { manifestSchema } from './manifest.js';
import { RunRecorder } from './recorder.js';
import { beforeDeadline, monotonicClock } from './clock.js';
import { disableReplayNetwork } from './offline.js';
import { runTalk, type EvaluationHost } from './driver.js';
import { observationSchema, runMetricsSchema, summarizeObservations } from './metrics.js';
import { replayTransactions, transactionCassetteSchema, responseCassetteSchema, toolCassetteSchema, RecordedResponses, RecordedTools, type ReplayCompatibility } from './replay.js';
import { freezeBaseline, verifyFrozenBaseline } from './freeze.js';
import { compareRuns, comparisonReport, loadRun } from './compare.js';
import { createLocalRuntime } from '../runtime.js';
import { FileDeckRepository } from '../storage/repository.js';
import { lineHash } from '../hashline.js';
import { childNodes } from '../schema.js';
import { parseSource } from '../parser.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const usage = `Evaluation commands (run from slide-generation/):
  talks --host MODULE --fixture FILE --manifest FILE --out NEW_RUN_DIR [--repetition N] [--audit OBSERVATIONS_JSON]
  replay --cassette FILE --out NEW_RUN_DIR [--mode transaction|actor] [--host ACTUAL_HOST_MODULE --fixture FILE]
  compare --baseline RUN_DIR [--baseline RUN_DIR...] --candidate RUN_DIR [--candidate RUN_DIR...] --frozen BASELINE_EXPORT --out NEW_REPORT_DIR
  report --run RUN_DIR --out NEW_REPORT_DIR
  freeze --out NEW_BASELINE_DIR

All output must remain inside slide-generation/.artifacts/. Live talks require an explicit actual-host adapter;
no internal imitation scheduler or live-model fallback exists. Source credentials in the shell before invocation;
these commands never open .env. Replays preserve recorded literal responses and refuse incompatible context.
`;
function outputPath(input: string) {
  const path = resolve(input), artifacts = resolve(root, '.artifacts');
  if (relative(artifacts, path).startsWith('..') || path === artifacts) throw new Error('Output must be a new directory under slide-generation/.artifacts');
  return path;
}
const credentialValues = () => Object.entries(process.env).filter(([key, value]) => value && /(?:API_?KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/i.test(key)).map(([, value]) => value!);
const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const factsSchema = z.object({ recordingComplete: z.boolean(), finalReady: z.boolean().nullable(),
  modelCalls: z.number().int().nonnegative().nullable(), inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(), costUsd: z.number().nonnegative().nullable() }).strict();
interface LiveHost extends EvaluationHost {
  integration: { actualOrchestration: boolean; viewerConnected: boolean; mandatoryChecks: boolean; freshSession: boolean };
  finish(): Promise<z.infer<typeof factsSchema>>;
  close(): Promise<void>;
}
async function compatibility(runtime: Awaited<ReturnType<typeof createLocalRuntime>>): Promise<ReplayCompatibility> {
  const source = runtime.engine.readDocument().source, dependencies = new Map<string, ReplayCompatibility['dependencies'][number]>();
  for (const slide of childNodes(parseSource(source)).filter(n => n.tag === 'Slide')) {
    const artifact = await runtime.renderer.render(source, slide.id!);
    for (const dep of artifact.dependencies) if (dep.kind === 'font' || dep.kind === 'asset' || dep.kind === 'catalog')
      dependencies.set(`${dep.kind}:${dep.id}:${dep.version}`, { ...dep, kind: dep.kind });
  }
  return { protocol: 'hashline-replay-v1', sourceSchema: 1, toolSchemaSha256: lineHash(JSON.stringify(runtime.tools.definitions())),
    promptSha256: lineHash(await readFile(join(root, 'docs/AGENT_PROMPT.md'), 'utf8')), dependencies: [...dependencies.values()] };
}
async function replayManifest(mode: 'transaction-replay' | 'actor-replay', cassetteBytes: string, current: ReplayCompatibility) {
  const repo = resolve(root, '..');
  return { schemaVersion: 1, sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim().length > 0,
    nodeVersion: process.version, platform: process.platform, startedAt: new Date().toISOString(),
    lockSha256: lineHash(await readFile(join(root, 'package-lock.json'), 'utf8')), promptSha256: current.promptSha256,
    fixtureSha256: lineHash(cassetteBytes), dependencies: current.dependencies.map(d => ({ name: `${d.kind}:${d.id}`, version: d.version, sha256: d.sha256 })), mode };
}
export async function main(argv: string[]) {
  const command = argv[0];
  const { values } = parseArgs({ args: argv.slice(1), options: {
    help: { type: 'boolean' }, host: { type: 'string' }, fixture: { type: 'string' }, manifest: { type: 'string' }, out: { type: 'string' }, repetition: { type: 'string' }, audit: { type: 'string' },
    cassette: { type: 'string' }, mode: { type: 'string' }, baseline: { type: 'string', multiple: true }, candidate: { type: 'string', multiple: true }, frozen: { type: 'string' }, run: { type: 'string' },
  }, strict: true });
  if (values.help || !command || command === '--help') { process.stdout.write(usage); return; }
  const required = (key: keyof typeof values) => { const value = values[key]; if (typeof value !== 'string' || !value) throw new Error(`Missing --${key}\n${usage}`); return value; };
  if (command === 'talks') {
    const hostFile = required('host'), fixture = await loadFixture(required('fixture')), manifest = manifestSchema.parse(await json(required('manifest')));
    if (manifest.mode !== 'live' || !manifest.model) throw new Error('Live runs require a model/budget manifest and mode=live');
    if (manifest.model.serviceTier !== 'fast') throw new Error('Live runs require model.serviceTier=fast; the host must request Fast mode');
    if (manifest.fixtureSha256 !== lineHash(await readFile(required('fixture'), 'utf8'))) throw new Error('Fixture bytes differ from manifest');
    const repetition = Number(values.repetition ?? '1'); if (!Number.isSafeInteger(repetition) || repetition < 1) throw new Error('Repetition must be positive');
    const module = await import(pathToFileURL(resolve(hostFile)).href);
    if (typeof module.createEvaluationHost !== 'function') throw new Error('Host module must export createEvaluationHost; the old HTML runtime is not a JSX host adapter');
    const recorder = await RunRecorder.create(outputPath(required('out')), manifest, credentialValues());
    let host: LiveHost | undefined;
    try {
      host = await module.createEvaluationHost({ recorder, clock: monotonicClock, initialContext: fixture.initialContext, budget: manifest.model }) as LiveHost;
      if (host.provenance !== 'real-system' || !host.integration?.actualOrchestration || !host.integration.viewerConnected || !host.integration.mandatoryChecks || !host.integration.freshSession)
        throw new Error('Actual orchestration, viewer, mandatory checks and a fresh session must all be connected before live evaluation');
      const result = await runTalk(fixture, host, { onInput: value => recorder.input(value), onEvent: value => recorder.driverEvent(value) });
      const finished = await beforeDeadline(host.finish(), monotonicClock.now() + 10_000, monotonicClock);
      if (!finished.completed) throw new Error('Host final evidence exceeded the 10 second deadline');
      const facts = factsSchema.parse(finished.value);
      await recorder.flush();
      const audits = values.audit ? z.array(observationSchema).parse(await json(values.audit)) : [];
      const byId = new Map(audits.map(a => [a.expectationId, a]));
      if (byId.size !== audits.length || audits.some(a => !fixture.expectations.some(e => e.id === a.expectationId))) throw new Error('Audit contains duplicate or unknown expectation IDs');
      const observations = fixture.expectations.map(expectation => {
        const event = fixture.events.find(e => e.id === expectation.triggerEventId)!;
        const input = result.inputs.find(i => i.id === event.id);
        const observed = byId.get(expectation.id);
        if (observed && observed.utteranceId !== event.id) throw new Error('Audit expectation is associated with the wrong utterance');
        return observed ?? { expectationId: expectation.id, utteranceId: event.id, effect: 'visible' as const,
          scheduledEndMs: result.startMs + event.endMs, actualUtteranceEndMs: input?.deliveredAtMs ?? result.startMs + event.endMs,
          deadlineMs: result.finishedAtMs, evidence: [], missingReason: 'manual-review' as const };
      });
      const metrics = runMetricsSchema.parse({ schemaVersion: 1, fixtureId: fixture.id, repetition, pace: 1, provenance: host.provenance,
        observations, inputCount: fixture.events.length, retainedInputCount: result.inputs.filter(i => i.outcome === 'retained').length,
        termination: result.termination, ...facts, recordingComplete: facts.recordingComplete && result.recordingComplete && recorder.failures.length === 0 });
      await recorder.summary('metrics.json', metrics); await recorder.summary('audit.json', { observations, summary: summarizeObservations(observations) });
      if (result.termination !== 'settled' || result.undeliveredInputIds.length || result.pendingInputIds.length)
        await recorder.summary('failure.json', { reason: result.termination, pendingInputIds: result.pendingInputIds, undeliveredInputIds: result.undeliveredInputIds, errors: result.errors });
      await recorder.flush(); process.stdout.write(JSON.stringify({ directory: recorder.directory, termination: result.termination, visible: summarizeObservations(observations).visible }) + '\n');
    } catch (error) { await recorder.summary('failure.json', { reason: 'host-or-harness-failure', error: String(error) }).catch(() => {}); await recorder.flush().catch(() => {}); throw error; }
    finally { if (host && !(await beforeDeadline(host.close(), monotonicClock.now() + 5_000, monotonicClock)).completed) throw new Error('Host close exceeded the 5 second deadline'); }
    return;
  }
  if (command === 'replay') {
    const bytes = await readFile(required('cassette'), 'utf8'), mode = values.mode ?? 'transaction', out = outputPath(required('out'));
    if (!['transaction', 'actor'].includes(mode)) throw new Error('Replay mode must be transaction or actor');
    const actorSchema = responseCassetteSchema.extend({ initial: z.object({ schemaVersion: z.literal(1), source: z.string() }).strict(), tools: toolCassetteSchema });
    const cassette = mode === 'transaction' ? transactionCassetteSchema.parse(JSON.parse(bytes)) : actorSchema.parse(JSON.parse(bytes));
    if (mode === 'actor' && (!values.host || !values.fixture)) throw new Error('Actor replay requires the actual host adapter and fixture; no imitation scheduler is provided');
    await mkdir(out, { recursive: false });
    await new FileDeckRepository(join(out, 'runtime/deck.json')).initialize(cassette.initial);
    const runtime = await createLocalRuntime({ directory: join(out, 'runtime') });
    let host: EvaluationHost & { close(): Promise<void> } | undefined;
    const network = disableReplayNetwork();
    let recorder: RunRecorder | undefined;
    try {
      const current = await compatibility(runtime);
      recorder = await RunRecorder.create(out, await replayManifest(mode === 'transaction' ? 'transaction-replay' : 'actor-replay', bytes, current), credentialValues());
      const recording = recorder;
      let result: unknown;
      if (mode === 'transaction') result = await replayTransactions(transactionCassetteSchema.parse(cassette), runtime.engine, current);
      else {
        const actor = actorSchema.parse(cassette), fixture = await loadFixture(required('fixture'));
        const model = new RecordedResponses({ schemaVersion: actor.schemaVersion, provenance: actor.provenance, compatibility: actor.compatibility, responses: actor.responses }, current, monotonicClock);
        const tools = new RecordedTools(actor.tools, (name, args) => runtime.tools.invoke(name, args));
        const module = await import(pathToFileURL(resolve(required('host'))).href);
        if (typeof module.createReplayHost !== 'function') throw new Error('Host module must export createReplayHost using the actual scheduler');
        host = await module.createReplayHost({ model, tools, runtime, clock: monotonicClock, initialContext: fixture.initialContext });
        if (!host || host.provenance !== 'recorded-host') throw new Error('Replay host must identify recorded-host provenance');
        const run = await runTalk(fixture, host, { onInput: value => recording.input(value), onEvent: value => recording.driverEvent(value) });
        model.assertConsumed(); tools.assertConsumed();
        result = { ...run, snapshots: tools.snapshots.entries(), transactions: tools.transactions() };
      }
      const readiness = await runtime.engine.readiness();
      await recorder.summary('audit.json', { result, readiness, offline: network.evidence() }); await recorder.flush();
      process.stdout.write(JSON.stringify({ directory: out, result, readiness, offline: network.evidence() }) + '\n');
    } catch (error) {
      await recorder?.summary('failure.json', { reason: 'replay-failure', error: String(error), offline: network.evidence() }).catch(() => {});
      await recorder?.flush().catch(() => {}); throw error;
    } finally { try { if (host) await beforeDeadline(host.close(), monotonicClock.now() + 5_000, monotonicClock); await runtime.close(); } finally { network.restore(); } }
    return;
  }
  if (command === 'freeze') { const record = await freezeBaseline(resolve(root, '..'), outputPath(required('out'))); process.stdout.write(JSON.stringify(record) + '\n'); return; }
  if (command === 'compare') {
    const frozen = await verifyFrozenBaseline(required('frozen'));
    const baseline = await Promise.all((values.baseline ?? []).map(loadRun)), candidate = await Promise.all((values.candidate ?? []).map(loadRun));
    const result = compareRuns(baseline, candidate, frozen), out = outputPath(required('out'));
    await mkdir(out, { recursive: false });
    await writeFile(join(out, 'comparison.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    await writeFile(join(out, 'report.md'), comparisonReport(result), { flag: 'wx' }); process.stdout.write(comparisonReport(result)); return;
  }
  if (command === 'report') {
    const run = await loadRun(required('run')), out = outputPath(required('out'));
    await mkdir(out, { recursive: false });
    const summary = summarizeObservations(run.metrics.observations);
    await writeFile(join(out, 'summary.json'), JSON.stringify({ directory: run.directory, manifest: run.manifest, metrics: run.metrics, summary }, null, 2) + '\n', { flag: 'wx' });
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n'); return;
  }
  throw new Error(`Unknown evaluation command ${command}\n${usage}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });
