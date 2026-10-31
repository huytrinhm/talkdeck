/** One direct subsystem smoke; deliberately no actor scheduling or qualification claims. */
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createLocalRuntime } from '../src/runtime.js';
import { BoundedResponsesClient } from '../src/host/model-client.js';
import { GenerationSession } from '../src/host/session.js';
import { RunRecorder } from '../src/evaluation/recorder.js';
import { transactionCassetteSchema, responseCassetteSchema } from '../src/evaluation/replay.js';
import { Trace } from '../src/telemetry/trace.js';
import { nodes, parseSource, textContent } from '../src/parser.js';
import { lineHash } from '../src/hashline.js';
import { SourceError } from '../src/contracts.js';
import { createViewerDocument } from '../src/viewer/document.js';
import { acknowledgmentSchema } from '../src/viewer/protocol.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const title = 'Revenue update';
const sentence = 'Revenue grew 42% compared with Q3 last year.';
const utterance = `On the existing slide, show the title “${title}” and the sentence “${sentence}” Preserve this sentence exactly, including its qualifier. Do not add other visible text.`;
const model = process.env.FAST_MODEL ?? 'gpt-6-luna';
const credential = process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY ?? '';
const client = new BoundedResponsesClient(credential, model);
const directory = resolve(root, '.artifacts/runs/subsystem-smoke', new Date().toISOString().replace(/[:.]/g, '-'));
const basePrompt = await readFile(join(root, 'docs/AGENT_PROMPT.md'), 'utf8');
const specification = await readFile(join(root, 'SPEC.md'), 'utf8');
const instructions = `${basePrompt}\n\nSubsystem specification:\n${specification}\n\nThis is one bounded direct subsystem smoke. Use the actual tools to implement the requested single slide. Read its notes and source before editing. Finish with presentation_readiness. You have at most eight inference requests. Do not request render HTML/CSS merely to inspect the slide; request screenshot explicitly if visual feedback is needed.`;
const lock = await readFile(join(root, 'package-lock.json'));
const recorder = await RunRecorder.create(directory, {
  schemaVersion: 1, sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  dirty: execFileSync('git', ['status', '--porcelain', '--', '.'], { cwd: root, encoding: 'utf8' }).trim().length > 0,
  nodeVersion: process.version, platform: `${process.platform}/${process.arch}`, startedAt: new Date().toISOString(),
  lockSha256: hash(lock), promptSha256: hash(instructions), fixtureSha256: hash(utterance), dependencies: [],
  model: { provider: 'openai', name: model, maxCalls: 8, maxTokens: 8000 }, mode: 'live',
}, [credential]);
// Snapshot only explicit credential-free source paths; never copy an environment file.
await mkdir(join(directory, 'source-snapshot'));
for (const file of ['src', 'package.json', 'package-lock.json', 'SPEC.md', 'docs/AGENT_PROMPT.md', 'scripts/generation-smoke.ts'])
  await cp(join(root, file), join(directory, 'source-snapshot', file), { recursive: true });
await writeFile(join(directory, 'instructions.txt'), instructions);
await writeFile(join(directory, 'input.txt'), utterance);
const trace = new Trace(event => recorder.event(event));
const runtime = await createLocalRuntime({ directory: join(directory, 'runtime'), trace });
const initial = runtime.engine.readDocument();
const slideId = [...nodes(parseSource(initial.source))].find(node => node.tag === 'Slide')!.id!;
const channel = randomUUID().replaceAll('-', '_');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: join(directory, 'viewer'), size: { width: 1920, height: 1080 } } });
const page = await context.newPage();
const pageErrors: string[] = [];
page.on('pageerror', error => pageErrors.push(error.message));
await page.setContent('<style>html,body{margin:0;width:100%;height:100%}iframe{border:0;width:100%;height:100%}</style><iframe sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>');
await page.evaluate(({ source, channel }) => {
  (window as any).smokeAcks = [];
  addEventListener('message', event => {
    if (event.source === document.querySelector('iframe')!.contentWindow && event.origin === 'null' && event.data.channel === channel)
      (window as any).smokeAcks.push(event.data);
  });
  document.querySelector('iframe')!.srcdoc = source;
}, { source: createViewerDocument(channel), channel });
await page.waitForFunction(() => (window as any).smokeAcks.some((a: any) => a.type === 'ready'));
const beforeSync = performance.now();
const browserNow = await page.evaluate(() => performance.timeOrigin + performance.now());
const afterSync = performance.now();
const clock = { offsetMs: (beforeSync + afterSync) / 2 - (browserNow - performance.timeOrigin), uncertaintyMs: (afterSync - beforeSync) / 2 };
const publicationSurfaces = new Map<string, 'editor' | 'audience'>();
let recordedAcks = 0, publicationCount = 0, stateTail = Promise.resolve(), previousSource = initial.source;
const publications: unknown[] = [], sessionEvents: unknown[] = [], steps: any[] = [], responseRecords: any[] = [], toolOutcomes: any[] = [];
let finalAck: any, inferenceId: string | undefined;
const drainAcks = async () => {
  const acks = await page.evaluate(start => (window as any).smokeAcks.slice(start), recordedAcks);
  for (const raw of acks) {
    const ack = acknowledgmentSchema.parse(raw); recordedAcks++;
    // Ack clocks carry their own iframe time origin; map to this process's monotonic clock.
    const offsetMs = clock.offsetMs + ack.timeOriginMs - performance.timeOrigin;
    await session.acknowledge(ack, { offsetMs, uncertaintyMs: clock.uncertaintyMs });
  }
};
const session = new GenerationSession(runtime.engine, runtime.tools, runtime.renderer, runtime.browser, {
  channel, slideId,
  record: async event => {
    sessionEvents.push(event);
    if (event.type === 'publication') { publications.push(event); publicationCount++; publicationSurfaces.set(event.message.publicationId, event.message.mode === 'presentation' ? 'audience' : 'editor'); }
    if (event.type === 'publication-refused') throw new Error(`Publication refused: ${event.code}`);
    if (event.type === 'viewer') await recorder.viewer({ acknowledgment: event.acknowledgment, receivedAtMs: event.atMs,
      clockOffsetMs: event.clockOffsetMs, clockUncertaintyMs: event.clockUncertaintyMs, surface: event.acknowledgment.publicationId ? publicationSurfaces.get(event.acknowledgment.publicationId)! : 'editor' });
  },
  send: async message => {
    trace.emit('publication.sent', { deckId: 'smoke', revision: message.revision, inferenceId, publicationId: message.publicationId });
    await page.evaluate(data => document.querySelector('iframe')!.contentWindow!.postMessage(data, '*'), message);
    await page.waitForFunction(sequence => (window as any).smokeAcks.some((a: any) => a.sequence === sequence && ['settled', 'refused'].includes(a.type)), message.sequence);
    finalAck = await page.evaluate(sequence => (window as any).smokeAcks.findLast((a: any) => a.sequence === sequence && ['settled', 'refused'].includes(a.type)), message.sequence);
    await drainAcks();
    if (finalAck.type === 'refused' || !finalAck.domEquivalent) throw new Error(`Viewer refused or inexact: ${JSON.stringify(finalAck)}`);
    await recorder.binary('viewer', `publication-${message.sequence}.jpg`, await page.screenshot({ type: 'jpeg', quality: 90 }));
  },
});
const unsubscribe = runtime.engine.subscribe(event => {
  stateTail = stateTail.then(async () => {
    const artifact = await runtime.renderer.render(event.document.source, slideId), checks = await runtime.browser.check(event.document.source);
    await recorder.state({ revision: event.revision, atMs: performance.now(), source: event.document.source, reason: event.reason,
      normalizedDiff: JSON.stringify({ beforeSha256: hash(previousSource), afterSource: event.document.source }), checksJson: JSON.stringify(checks),
      renders: [{ slideId, html: artifact.html, css: artifact.css, dependenciesJson: JSON.stringify(artifact.dependencies) }] });
    previousSource = event.document.source;
  });
});
let acceptedEdits = 0, failure: string | undefined, terminalText = '', inputTokens = 0, outputTokens = 0;
const artifact = await runtime.renderer.render(initial.source, slideId);
const toolDefinitions = runtime.tools.definitions();
const compatibility = { protocol: 'hashline-replay-v1' as const, sourceSchema: 1 as const, toolSchemaSha256: hash(JSON.stringify(toolDefinitions)), promptSha256: hash(instructions),
  dependencies: artifact.dependencies.filter(d => ['font', 'asset', 'catalog'].includes(d.kind)) };
try {
  await drainAcks();
  await session.selectSlide(slideId);
  const deliveredAtMs = performance.now(), input = { id: 'smoke-utterance-1', slideId, text: utterance, deliveredAtMs };
  await recorder.driverEvent({ kind: 'input.delivered', atMs: deliveredAtMs, utteranceId: input.id });
  const receipt = await session.deliverUtterance(input);
  await runtime.engine.settledInput(); await session.settle(); await stateTail;
  await recorder.input({ id: input.id, text: utterance, scheduledEndMs: 0, scheduledAtMs: deliveredAtMs, deliveredAtMs, deliveryDriftMs: 0,
    retainedAtMs: receipt.retainedAtMs, receiptDelayMs: receipt.retainedAtMs - deliveredAtMs, outcome: 'retained' });
  await recorder.driverEvent({ kind: 'input.retained', atMs: receipt.retainedAtMs, utteranceId: input.id });
  steps.push({ kind: 'input', input, expectedSourceSha256: lineHash(runtime.engine.readDocument().source) });
  const inputItems: any[] = [{ role: 'user', content: `The active slide is ${slideId}. Trusted input has already been retained in its raw transcript and notes. Apply this request:\n${utterance}` }];
  const tools = toolDefinitions.map(definition => ({ type: 'function', ...definition, strict: false }));
  while (client.calls < client.maxCalls) {
    inferenceId = `inference-${client.calls + 1}`;
    const requestBody = client.requestBody(instructions, inputItems, tools), startedAtMs = performance.now();
    trace.emit('model.started', { deckId: 'smoke', revision: runtime.engine.state().revision, inferenceId });
    let response;
    try { response = await client.respond(requestBody); }
    catch (error) {
      await recorder.model({ id: inferenceId, inferenceId, role: 'fast', provider: 'openai', model, startedAtMs, finishedAtMs: performance.now(), requestBody, error: String(error) });
      throw error;
    }
    const finishedAtMs = performance.now(), data = JSON.parse(response.responseBody);
    await recorder.model({ id: inferenceId, inferenceId, role: 'fast', provider: 'openai', model, startedAtMs, finishedAtMs,
      requestBody, responseBody: response.responseBody, providerRequestId: response.providerRequestId,
      inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens,
      ...(response.ok ? {} : { error: `HTTP ${response.status}` }) });
    responseRecords.push({ id: inferenceId, role: 'fast', requestBody, responseBody: response.responseBody, latencyMs: finishedAtMs - startedAtMs });
    trace.emit('model.finished', { deckId: 'smoke', revision: runtime.engine.state().revision, inferenceId }, response.ok ? undefined : `http_${response.status}`);
    inputTokens += data.usage?.input_tokens ?? 0; outputTokens += data.usage?.output_tokens ?? 0;
    console.log(JSON.stringify({ event: 'model', inferenceId, status: response.status, outputTokens: data.usage?.output_tokens }));
    if (!response.ok) throw new Error(`Responses HTTP ${response.status}: ${data.error?.message ?? 'unknown error'}`);
    if (data.status !== 'completed') throw new Error(`Responses incomplete: ${data.status}`);
    inputItems.push(...data.output);
    const calls = data.output.filter((item: any) => item.type === 'function_call');
    if (!calls.length) {
      terminalText = data.output.flatMap((item: any) => item.content ?? []).filter((part: any) => part.type === 'output_text').map((part: any) => part.text).join('\n');
      if (data.output.some((item: any) => item.content?.some((part: any) => part.type === 'refusal'))) throw new Error('Model refused the request');
      break;
    }
    for (const call of calls) {
      const startedAtMs = performance.now(); let result: any, error: { code: string; message: string } | undefined;
      try { result = await runtime.tools.invoke(call.name, JSON.parse(call.arguments)); }
      catch (caught) { error = { code: caught instanceof SourceError ? caught.code : 'internal', message: String(caught) }; result = { error }; }
      await recorder.tool({ id: call.call_id, inferenceId, name: call.name, argumentsJson: call.arguments, resultJson: JSON.stringify(result), startedAtMs, finishedAtMs: performance.now(), error });
      toolOutcomes.push({ inferenceId, name: call.name, callId: call.call_id, sourceSha256: lineHash(runtime.engine.readDocument().source), accepted: result?.accepted, error });
      if (call.name === 'read_source' && !error) steps.push({ kind: 'read', nodeId: JSON.parse(call.arguments).nodeId, result });
      if (call.name === 'edit_source') {
        steps.push({ kind: 'edit', transaction: JSON.parse(call.arguments), expected: { outcome: error ? 'error' : result.accepted ? 'accepted' : 'refused', code: error?.code,
          sourceSha256: lineHash(runtime.engine.readDocument().source), findingsJson: result.findings === undefined ? undefined : JSON.stringify(result.findings) } });
        if (result.accepted) acceptedEdits++;
      }
      await session.settle(); await stateTail;
      console.log(JSON.stringify({ event: 'tool', name: call.name, accepted: result?.accepted, error: error?.code }));
      if (error || result?.accepted === false) throw new Error(`First divergent tool outcome: ${call.name}: ${JSON.stringify(result)}`);
      const output = call.name === 'screenshot'
        ? result.flatMap((image: any) => [{ type: 'input_text', text: JSON.stringify({ slideId: image.slideId, artifactDigest: image.artifactDigest, sourceDigest: image.sourceDigest }) }, { type: 'input_image', image_url: `data:image/jpeg;base64,${image.jpeg}`, detail: 'high' }])
        : JSON.stringify(result);
      inputItems.push({ type: 'function_call_output', call_id: call.call_id, output });
    }
  }
  if (!terminalText) throw new Error('Inference budget exhausted without a terminal model response');
  const readiness = await runtime.engine.readiness();
  if (!readiness.ready) throw new Error(`Final presentation not ready: ${JSON.stringify(readiness)}`);
  await session.selectSlide(slideId, 'presentation');
  const frame = page.frames().find(frame => frame.parentFrame() === page.mainFrame())!;
  const visibleTexts = await frame.locator('[data-content]').evaluateAll(elements => elements.filter(element => {
    const style = getComputedStyle(element); return style.visibility === 'visible' && style.display !== 'none' && Number(style.opacity) > 0;
  }).map(element => element.textContent));
  const source = runtime.engine.readDocument().source;
  const prompts = [...nodes(parseSource(source))].filter(node => node.tag === 'Prompt').map(textContent);
  const notes = runtime.engine.readSpeakerNotes(slideId);
  const audit = { scope: 'direct-subsystem-live-smoke', actorHostIntegration: false, fiveTalkQualification: false, acceptedEdits,
    visibleTexts, exactVisible: JSON.stringify(visibleTexts) === JSON.stringify([title, sentence]), rawInputExact: prompts.length === 1 && prompts[0] === utterance,
    notesPreserved: notes.notes.includes(utterance), ready: readiness.ready, domEquivalent: finalAck.domEquivalent, pageErrors, terminalText };
  await recorder.summary('audit.json', audit);
  await recorder.binary('final', 'viewer.jpg', await page.screenshot({ type: 'jpeg', quality: 95 }));
  if (!audit.exactVisible || !audit.rawInputExact || !audit.notesPreserved || !acceptedEdits || pageErrors.length) throw new Error(`Final smoke audit failed: ${JSON.stringify(audit)}`);
} catch (error) {
  failure = String(error);
  await recorder.summary('failure.json', { scope: 'direct-subsystem-live-smoke', firstDivergence: failure, calls: client.calls });
} finally {
  unsubscribe(); await session.settle(); await stateTail; await drainAcks(); await session.close();
  const finalSource = runtime.engine.readDocument().source;
  await writeFile(join(directory, 'transaction-cassette.json'), JSON.stringify(transactionCassetteSchema.parse({ schemaVersion: 1, provenance: 'recorded-model', compatibility, initial, steps, finalSourceSha256: lineHash(finalSource) }), null, 2));
  await writeFile(join(directory, 'response-cassette.json'), JSON.stringify(responseCassetteSchema.parse({ schemaVersion: 1, provenance: 'recorded-model', compatibility, responses: responseRecords }), null, 2));
  await writeFile(join(directory, 'session-events.json'), JSON.stringify(sessionEvents, null, 2));
  await writeFile(join(directory, 'tool-outcomes.json'), JSON.stringify(toolOutcomes, null, 2));
  await writeFile(join(directory, 'final/deck.jsx'), finalSource);
  await writeFile(join(directory, 'final/notes.txt'), runtime.engine.readSpeakerNotes(slideId).notes);
  await recorder.summary('metrics.json', { scope: 'direct-subsystem-live-smoke', model, calls: client.calls, inputTokens, outputTokens, costUsd: null,
    costReason: 'No pinned price table supplied; usage is actual provider usage.', acceptedEdits, publicationCount, failure, clock, traceRecordingFailures: trace.failures });
  await recorder.driverEvent({ kind: 'run.finished', atMs: performance.now(), code: failure ? 'failed' : 'passed' });
  await recorder.flush(); await context.close(); await browser.close(); await runtime.close();
}
console.log(JSON.stringify({ directory, scope: 'direct-subsystem-live-smoke', model, calls: client.calls, inputTokens, outputTokens, acceptedEdits, publicationCount, passed: !failure, failure }));
if (failure) process.exitCode = 1;
