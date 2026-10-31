import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalRuntime } from '../runtime.js';
import { JsxBackend } from '../host/jsx-backend.js';
import { SlideRuntime } from '../orchestration/runtime.js';
import { clientFromEnv, models } from '../orchestration/config.js';
import type { Log } from '../orchestration/types.js';
import { createRecordedModels, type ProviderLimits } from './models.js';
import { HeadlessRecordingSession } from './host.js';
import { writeViewerGallery } from './gallery.js';
import { atomicWrite } from '../storage/files.js';
import { lineHash } from '../hashline.js';
import type { RunRecorder } from '../evaluation/recorder.js';
import type { DeliveredInput } from '../evaluation/driver.js';
import type { EvaluationClock } from '../evaluation/clock.js';
import { nodes, parseSource, textContent } from '../parser.js';
import { childNodes } from '../schema.js';
import { navigationCommand, namedInputTarget, requestedTitle, routingTitles } from './input-routing.js';
export { navigationCommand } from './input-routing.js';

/** Error text is diagnostic, not raw evidence; authentication details never enter logs. */
export function safeHeadlessError(error: unknown): string {
  let message = String(error);
  if (/api[ _-]?key|authentication|authorization|bearer|credential/i.test(message)) return 'Credential-related error details suppressed';
  for (const secret of [process.env.OPENAI_API_KEY, process.env.OPENAI_KEY]) if (secret) message = message.split(secret).join('[REDACTED]');
  return message.replace(/\bsk-[A-Za-z0-9_*.-]{6,}/g, '[REDACTED]');
}
function evidenceJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  if ([process.env.OPENAI_API_KEY, process.env.OPENAI_KEY].some(secret => secret && serialized.includes(secret)))
    throw new Error('Credential value rejected from headless evidence');
  return serialized;
}

export interface HeadlessHostOptions {
  recorder: RunRecorder;
  clock: EvaluationClock;
  initialContext: string;
  budget: { maxCalls: number; maxTokens: number; serviceTier?: string };
  limits?: Partial<ProviderLimits>;
}
export async function createEvaluationHost(options: HeadlessHostOptions) {
  const { recorder } = options, root = fileURLToPath(new URL('../../', import.meta.url));
  const basePrompt = await readFile(join(root, 'docs/AGENT_PROMPT.md'), 'utf8');
  const specification = await readFile(join(root, 'SPEC.md'), 'utf8');
  const instructions = `${basePrompt}\n\n${specification}`;
  const local = await createLocalRuntime({ directory: join(recorder.directory, 'runtime') });
  let cleanupRecording: HeadlessRecordingSession | undefined, cleanupActors: SlideRuntime | undefined;
  let cleanupSubscription = () => {};
  try {
  const initial = local.engine.readDocument();
  await writeFile(join(recorder.directory, 'initial.json'), JSON.stringify(initial, null, 2));
  const commits: unknown[] = [];
  let previousSourceSha = local.engine.state().revision;
  const unsubscribeCommits = local.engine.subscribe(event => {
    commits.push({ kind: 'commit', sequence: commits.length, atMs: performance.now(), beforeSourceSha: previousSourceSha,
      afterSourceSha: event.revision, reason: event.reason, transactionId: event.transactionId, source: event.document.source });
    previousSourceSha = event.revision;
  });
  cleanupSubscription = unsubscribeCommits;
  const firstSlideId = childNodes(parseSource(local.engine.readDocument().source)).find(n => n.tag === 'Slide')!.id!;
  const recording = await HeadlessRecordingSession.create(local, recorder, { slideId: firstSlideId });
  cleanupRecording = recording;
  const selectedModels = models();
  const providers = createRecordedModels(clientFromEnv(), recorder, { models: selectedModels,
    limits: { maxCalls: options.budget.maxCalls, maxOutputTokensPerCall: options.budget.maxTokens, ...options.limits } });
  const routes: { utteranceId: string; slideId: string; retainedAtMs: number }[] = [];
  const pendingTitles = new Map<string, string>();
  const errors: string[] = [], operations: unknown[] = [];
  let recordTail: Promise<void> = Promise.resolve();
  const log: Log = {
    write(type, data) {
      appendFileSync(join(recorder.directory, 'scheduler.jsonl'), evidenceJson({ type, atMs: performance.now(), ...data, ...(type.includes('error') || type.includes('fail') ? Object.fromEntries(Object.entries(data).map(([key, value]) => [key, key === 'error' || key === 'message' ? safeHeadlessError(value) : value])) : {}) }).replace(/\n/g, '') + '\n', { mode: 0o600 });
      if (type === 'tool_result') recordTail = recordTail.then(() => recorder.tool({ id: `${data.inference}:${data.callId}`,
        inferenceId: data.inference, name: data.name, argumentsJson: data.argumentsJson,
        resultJson: JSON.stringify(data.output), startedAtMs: data.startedAtMs, finishedAtMs: data.finishedAtMs })).catch(error => { errors.push(safeHeadlessError(error)); });
    },
    observation() { /* Canonical state and actual viewer evidence are recorded by HeadlessRecordingSession. */ },
  };
  const backend = new JsxBackend(local, { instructions,
    onSelection: slideId => recording.session.selectSlide(slideId),
    onTool: event => { operations.push({ kind: 'tool', ...event, sourceSha256: local.engine.state().revision }); },
  });
  const actors = await SlideRuntime.create({ backend, ...providers, log, initialSource: local.engine.readDocument().source,
    context: options.initialContext, maxSteps: 32 });
  cleanupActors = actors;
  await recording.session.selectSlide(backend.selectedId);
  await recording.settle();
  const inputDirectory = join(recorder.directory, 'pending-input'); await mkdir(inputDirectory);
  const initialArtifact = await local.renderer.render(initial.source, firstSlideId);
  await writeFile(join(recorder.directory, 'configuration.json'), evidenceJson({ source: 'real-actor-jsx-headless', models: selectedModels,
    toolSchemaSha256: lineHash(JSON.stringify(local.tools.definitions())), initialDependencies: initialArtifact.dependencies,
    providerLimits: providers.budget.snapshot().limits, promptSha256: lineHash(instructions), instructions,
    navigation: 'Explicit new/create-slide, return/go-back navigation, and On <live title>, editing targets in actual words; no evaluator metadata.' }));
  let arrivalSequence = 0, routingPending = 0, routingTail: Promise<void> = Promise.resolve(), closed = false, finishing: Promise<any> | undefined;
  let finalReadiness: Awaited<ReturnType<typeof local.engine.readiness>> | undefined, readinessAtMs: number | undefined;
  const finalSlides: { slideId: string; path: string }[] = [];
  const persistEvidence = async () => {
    const source = local.engine.readDocument().source;
    const files: [string, () => unknown][] = [
      ['operations.json', () => operations], ['commits.json', () => commits], ['routes.json', () => routes],
      ['provider-cassette.json', () => providers.replayCassette()],
      ['provider-statistics.json', () => ({ ...providers.budget.snapshot(), roles: providers.statistics() })],
      ['final/deck.json', () => local.engine.readDocument()],
      ['final/evidence.json', () => [...nodes(parseSource(source))].filter(n => n.tag === 'Slide' || n.tag === 'ArchivedSlide')
        .map(n => ({ slideId: n.tag === 'Slide' ? n.id : n.props.slideId, archived: n.tag === 'ArchivedSlide',
          notes: childNodes(n).filter(c => c.tag === 'SpeakerNotes').map(textContent).join(''),
          prompts: [...nodes(n)].filter(c => c.tag === 'Prompt').map(c => ({ id: c.props.utteranceId, text: textContent(c) })) }))],
    ];
    // Independent writes all get a chance even when one export or its disk path fails.
    const results = await Promise.allSettled([
      ...files.map(async ([name, value]) => atomicWrite(join(recorder.directory, name), evidenceJson(value()))),
      (async () => { evidenceJson(source); await atomicWrite(join(recorder.directory, 'final/deck.jsx'), source); })(),
    ]);
    const failed = results.flatMap((result, index) => result.status === 'rejected' ? [`${files[index]?.[0] ?? 'final/deck.jsx'}: ${safeHeadlessError(result.reason)}`] : []);
    if (failed.length) throw new AggregateError(failed, 'Partial headless evidence export failed');
  };
  const host = {
    provenance: 'real-system' as const,
    integration: { actualOrchestration: true, viewerConnected: true, mandatoryChecks: true, freshSession: true },
    local, actors, backend, recording, providers, routes, errors, finalSlides,
    async deliverUtterance(input: DeliveredInput, signal: AbortSignal) {
      signal.throwIfAborted(); if (closed) throw new Error('Headless host closed');
      const sequence = ++arrivalSequence;
      // Retain first, independently of model/browser/route work. This is not a second editable deck.
      const retained = atomicWrite(join(inputDirectory, `${String(sequence).padStart(6, '0')}-${lineHash(input.id)}.json`), JSON.stringify({ sequence, ...input }) + '\n')
        .then(() => ({ utteranceId: input.id, retainedAtMs: performance.now() }));
      routingPending++;
      routingTail = routingTail.then(async () => {
        const receipt = await retained;
        const command = navigationCommand(input.text);
        if (command?.type === 'new') {
          const slides = backend.list();
          const seed = slides.length === 1 && ![...nodes(parseSource(local.engine.readDocument().source))].some(n => n.tag === 'Prompt');
          if (seed) backend.requestedTitles.set(backend.selectedId, command.title);
          else { const created = await backend.createSlide(command.title); operations.push({ kind: 'create', title: command.title, slideId: created.id, sourceSha256: local.engine.state().revision }); }
        } else if (command?.type === 'select') {
          const matching = [...new Set(routingTitles(backend.list(), pendingTitles).filter(s => s.title.toLowerCase() === command.title.toLowerCase()).map(s => s.id))];
          if (matching.length !== 1) throw new Error(`Explicit navigation target is not unique: ${command.title}`);
          await actors.selectSlide(matching[0]);
          operations.push({ kind: 'navigate', slideId: backend.selectedId, sourceSha256: local.engine.state().revision });
        }
        const targetId = command ? backend.selectedId : namedInputTarget(input.text, routingTitles(backend.list(), pendingTitles)) ?? backend.selectedId;
        const utterance = { id: input.id, text: input.text, deliveredAtMs: input.deliveredAtMs, slideId: targetId };
        await actors.deliverUtterance(utterance);
        const rename = requestedTitle(input.text, routingTitles(backend.list(), pendingTitles));
        if (rename) pendingTitles.set(targetId, rename);
        routes.push({ utteranceId: input.id, slideId: utterance.slideId, retainedAtMs: receipt.retainedAtMs });
        operations.push({ kind: 'input', input: utterance, sourceSha256: local.engine.state().revision });
      }).catch(error => { errors.push(`Routing ${input.id}: ${safeHeadlessError(error)}`); }).finally(() => { routingPending--; });
      return retained;
    },
    async settled() {
      if (errors.length) throw new AggregateError(errors, 'Headless input/recording failed');
      if (routingPending || providers.budget.snapshot().inFlight) return false;
      if ([...actors.gates.values()].some(g => g.latest && g.lastEvaluatedRevision < g.latest.revision)) return false;
      try {
        await actors.settle(1);
        await recordTail; await recording.settle();
        // A terminal actor state is not yet visible evidence. Wait for the real
        // viewer, then recheck work that may have arrived during that wait.
        if (routingPending || providers.budget.snapshot().inFlight
          || [...actors.gates.values()].some(g => g.latest && g.lastEvaluatedRevision < g.latest.revision)) return false;
        await actors.settle(1);
        return !routingPending && !providers.budget.snapshot().inFlight;
      }
      catch (error) { if (String(error).includes('did not settle before deadline')) return false; throw error; }
    },
    finish() {
      finishing ??= (async () => {
        const failures: string[] = [];
        try {
          await routingTail;
          // Stop inference before exports; evaluator captures never become model feedback.
          await actors.close(); await recordTail;
          await persistEvidence();
          await recording.settle();
          const source = local.engine.readDocument().source;
          finalReadiness = await local.engine.readiness(); readinessAtMs = performance.now();
          await atomicWrite(join(recorder.directory, 'final/readiness.json'), evidenceJson({ atMs: readinessAtMs, ...finalReadiness }));
          const ids = backend.list().map(s => s.id);
          for (let i = 0; i < ids.length; i += 4) for (const frame of await local.browser.screenshot(source, ids.slice(i, i + 4))) {
            const path = `slide-${frame.slideId}.jpg`; await recorder.binary('final', path, frame.jpeg); finalSlides.push({ slideId: frame.slideId, path: `final/${path}` });
          }
        } catch (error) { failures.push(safeHeadlessError(error)); }
        const preserved = await Promise.allSettled([persistEvidence(), recorder.flush()]);
        for (const result of preserved) if (result.status === 'rejected') failures.push(safeHeadlessError(result.reason));
        if (failures.length) { errors.push(...failures); throw new AggregateError(failures, 'Headless finalization failed; partial evidence retained'); }
        const budget = providers.budget.snapshot();
        return { recordingComplete: !errors.length && !recorder.failures.length && !backend.recordingFailures.length,
          finalReady: finalReadiness!.ready, modelCalls: budget.calls, inputTokens: budget.observedInputTokens,
          outputTokens: budget.observedOutputTokens, costUsd: null };
      })(); return finishing;
    },
    finalEvidence() { return { source: local.engine.readDocument().source, readiness: finalReadiness, readinessAtMs, readinessEvidence: 'final/readiness.json', frames: recording.viewer.frames() }; },
    async close() {
      if (closed) return; closed = true;
      const failures: string[] = [];
      const attempt = async (label: string, action: () => Promise<unknown>) => {
        try { await action(); } catch (error) { failures.push(`${label}: ${safeHeadlessError(error)}`); }
      };
      await attempt('actors', () => actors.close());
      await attempt('routing', () => routingTail); await attempt('tool recording', () => recordTail);
      await attempt('partial evidence', persistEvidence);
      await attempt('viewer', () => recording.close());
      await attempt('gallery', () => writeViewerGallery(recorder, recording.viewer.frames()));
      unsubscribeCommits();
      await attempt('canonical runtime', () => local.close());
      await attempt('recorder flush', () => recorder.flush());
      if (failures.length) { errors.push(...failures); throw new AggregateError(failures, 'Headless cleanup failed; all cleanup stages attempted'); }
    },
  };
  return host;
  } catch (error) {
    // The caller cannot close a host whose factory did not return.
    await Promise.allSettled([cleanupActors?.close(), cleanupRecording?.close()]);
    cleanupSubscription();
    await Promise.allSettled([local.close(), recorder.flush()]);
    throw new Error(`Headless startup failed: ${safeHeadlessError(error)}`);
  }
}
