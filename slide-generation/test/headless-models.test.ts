import test from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { createRecordedModels, createReplayModels, ProviderBudgetError, type ProviderRecord } from '../src/headless/models.js';
import type { ModelInput, DecisionInput, SlowDecisionInput } from '../src/orchestration/types.js';
import { clientFromEnv } from '../src/orchestration/config.js';
const models = { decision: 'gpt-6-luna', fast: 'gpt-6-luna', slow: 'gpt-6-sol', specialist: 'gpt-6-sol' };
const modelInput = (role: ModelInput['role'] = 'fast'): ModelInput => ({ agent: role, role, inferenceId: `branch-${role}`, input: [{ role: 'user', content: 'Keep the exact words.' }], tools: [], instructions: 'JSX policy only.', signal: new AbortController().signal });
const decisionInput: DecisionInput = { speech: { revision: 1, text: 'Complete thought.', receivedAt: 0, corrections: [] }, lastDispatched: null, undispatchedAgeMs: 200, context: 'Talk' };
const slowInput: SlowDecisionInput = { current: { id: 'r1', source: '<Deck/>', screenshot: Buffer.alloc(0), geometry: [], diagnostics: [], fastWatermark: 1 }, lastObservedFastWatermark: 0, speech: null, messages: [], context: 'Talk' };
function fixture() {
  const records: ProviderRecord[] = [], requests: { body: any; raw: string; path: string }[] = [];
  const recorder = { model: async (record: unknown) => { records.push(structuredClone(record as ProviderRecord)); } };
  const transport: typeof fetch = async (url, init) => {
    const raw = String(init!.body), body = JSON.parse(raw), path = new URL(String(url)).pathname;
    requests.push({ body, raw, path });
    return new Response(JSON.stringify(path.endsWith('decisions')
      ? { model: body.model, answers: [{ type: 'choice', name: body.questions[0].name, choice: body.questions[0].name === 'speech_dispatch' ? 'dispatch' : 'hold' }], usage: { input_tokens: 11, output_tokens: 0 } }
      : { id: 'response-1', model: body.model, status: 'completed', service_tier: 'priority', output: [], usage: { input_tokens: 12, output_tokens: 5 } }), { headers: { 'Content-Type': 'application/json', 'x-request-id': 'request-1' } });
  };
  return { records, recorder, requests, transport, client: new OpenAI({ apiKey: 'fake-test-key', maxRetries: 0 }) };
}

test('real SDK records all roles and Decisions exactly with one shared budget and no implicit screenshot', async () => {
  const f = fixture(), p = createRecordedModels(f.client, f.recorder, { models, transport: f.transport });
  for (const role of ['fast', 'slow', 'specialist'] as const) await p.model.infer(modelInput(role));
  assert.equal(await p.decider.evaluate(decisionInput, new AbortController().signal), 'dispatch');
  assert.equal(await p.slowDecider.evaluate(slowInput, new AbortController().signal), 'hold');
  assert.deepEqual(f.requests.slice(0, 3).map(r => [r.body.model, r.body.service_tier, r.body.reasoning.effort]), [
    ['gpt-6-luna', 'fast', 'none'], ['gpt-6-sol', 'fast', 'medium'], ['gpt-6-sol', 'fast', 'low'],
  ]);
  for (const request of f.requests.slice(0, 3)) { assert.equal(request.body.instructions, 'JSX policy only.'); assert.equal(request.body.max_output_tokens, 8000); }
  for (const request of f.requests.slice(3)) { assert.equal(request.path, '/v1/decisions'); assert.equal(request.body.service_tier, undefined); assert.equal(request.body.max_output_tokens, undefined); }
  assert.equal(f.requests[4].raw.includes('input_image'), false);
  assert.equal(f.records.length, 5); assert.ok(f.records.every(record => record.dispatched && record.status === 200 && !record.usageMissing));
  assert.deepEqual(f.records.map(r => r.requestBody), f.requests.map(r => r.raw));
  assert.equal(f.records[0].returnedTier, 'priority'); assert.equal(f.records[0].inferenceId, 'branch-fast');
  assert.equal(JSON.stringify(f.records).includes('fake-test-key'), false);
  assert.equal(p.statistics().decision.dispatched, 1); assert.equal(p.statistics().slow.observedOutputTokens, 5);
  assert.equal(p.budget.snapshot().calls, 5); assert.equal(p.budget.snapshot().observedInputTokens, 58); assert.equal(p.budget.snapshot().observedOutputTokens, 15);
  assert.equal(p.budget.snapshot().chargedInputTokens, 58); assert.equal(p.budget.snapshot().chargedOutputTokens, 15);
});

test('shared call cap prevents concurrent extra model or Decision transport, with no automatic retry', async () => {
  const f = fixture(); let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  let dispatched = 0;
  const p = createRecordedModels(f.client, f.recorder, { models, limits: { maxCalls: 1 }, transport: async (...args) => { dispatched++; await wait; return f.transport(...args); } });
  const first = p.model.infer(modelInput());
  while (!dispatched) await new Promise(resolve => setTimeout(resolve, 1));
  await assert.rejects(p.decider.evaluate(decisionInput, new AbortController().signal), ProviderBudgetError);
  assert.equal(dispatched, 1); assert.equal(p.budget.snapshot().inFlight, 1);
  release(); await first;
  assert.equal(p.budget.remaining().calls, 0);
  assert.equal(f.records.find(record => !record.dispatched)?.errorCode, 'provider_budget');
});

test('input/output reservations fail before dispatch and unknown aborted usage remains charged', async () => {
  const f = fixture();
  const tooSmall = createRecordedModels(f.client, f.recorder, { models, limits: { maxInputTokens: 1 }, transport: f.transport });
  await assert.rejects(tooSmall.model.infer(modelInput()), ProviderBudgetError); assert.equal(f.requests.length, 0);
  const outputSmall = createRecordedModels(f.client, f.recorder, { models, limits: { maxOutputTokens: 7 }, transport: f.transport });
  await assert.rejects(outputSmall.model.infer(modelInput()), ProviderBudgetError); assert.equal(f.requests.length, 0);
  const controller = new AbortController(); let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  const p = createRecordedModels(f.client, f.recorder, { models, transport: async (_url, init) => {
    started(); return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('ignored private transport text')), { once: true }));
  } });
  const result = p.model.infer({ ...modelInput(), signal: controller.signal }); await start; controller.abort();
  await assert.rejects(result);
  const record = p.records()[0]; assert.equal(record.aborted, true); assert.equal(record.error, 'aborted');
  assert.equal(p.budget.snapshot().unknownUsageCalls, 1); assert.equal(p.budget.snapshot().chargedInputTokens, record.reservedInputTokens); assert.equal(p.budget.snapshot().chargedOutputTokens, 8000);
});

test('authentication response is redacted and provider errors receive no automatic retry', async () => {
  const f = fixture(); let calls = 0;
  const p = createRecordedModels(f.client, f.recorder, { models, transport: async () => { calls++; return new Response('{"error":{"message":"bad key fake-test-***"}}', { status: 401 }); } });
  await assert.rejects(p.model.infer(modelInput()));
  assert.equal(calls, 1); assert.equal(JSON.stringify(f.records).includes('fake-test-'), false);
  assert.equal(f.records[0].errorCode, 'http_401'); assert.equal(f.records[0].usageMissing, true);
  assert.equal(p.budget.snapshot().unknownUsageCalls, 1);
});

test('recorded Responses and Decisions replay exact requests without a live fallback', async () => {
  const f = fixture(), p = createRecordedModels(f.client, f.recorder, { models, transport: f.transport });
  await p.model.infer(modelInput()); await p.decider.evaluate(decisionInput, new AbortController().signal);
  const cassette = { ...p.replayCassette(), provenance: 'synthetic-test' as const };
  const replayRecords: ProviderRecord[] = [], replay = createReplayModels({ model: async r => { replayRecords.push(r as ProviderRecord); } }, { models }, cassette);
  await replay.model.infer(modelInput()); assert.equal(await replay.decider.evaluate(decisionInput, new AbortController().signal), 'dispatch');
  replay.assertReplayConsumed(); assert.equal(replayRecords.every(record => !record.dispatched), true);
  await assert.rejects(replay.model.infer(modelInput()), /exhausted/);
  const mismatch = createReplayModels(f.recorder, { models }, cassette);
  await assert.rejects(mismatch.model.infer({ ...modelInput(), instructions: 'different policy' }), /context mismatch/);
  assert.throws(() => mismatch.assertReplayConsumed(), /not fully consumed/);
});

test('provider refuses unsupported Decision model and environment config never reads a dotenv fallback', () => {
  const f = fixture();
  assert.throws(() => createRecordedModels(f.client, f.recorder, { models: { ...models, decision: 'gpt-6-sol' } }), /only supports/);
  const before = process.env.OPENAI_API_KEY, alias = process.env.OPENAI_KEY;
  try { delete process.env.OPENAI_API_KEY; delete process.env.OPENAI_KEY; assert.throws(clientFromEnv, /process environment/); }
  finally { if (before !== undefined) process.env.OPENAI_API_KEY = before; if (alias !== undefined) process.env.OPENAI_KEY = alias; }
});

test('rich provider metadata passes the real artifact recorder credential boundary', async () => {
  const { mkdtemp, readFile, readdir, rm } = await import('node:fs/promises');
  const { RunRecorder } = await import('../src/evaluation/recorder.js');
  const directory = await mkdtemp('.artifacts/provider-recorder-');
  try {
    const recorder = await RunRecorder.create(directory, { schemaVersion: 1, sourceSha: 'a'.repeat(40), dirty: true,
      nodeVersion: process.version, platform: process.platform, startedAt: new Date().toISOString(), lockSha256: 'b'.repeat(64),
      promptSha256: 'c'.repeat(64), fixtureSha256: 'd'.repeat(64), dependencies: [], mode: 'environment' }, ['fake-test-key']);
    const f = fixture(), p = createRecordedModels(f.client, recorder, { models, transport: f.transport });
    await p.model.infer(modelInput()); await recorder.flush();
    const files = await readdir(`${directory}/model`);
    const record = JSON.parse(await readFile(`${directory}/model/${files[0]}`, 'utf8'));
    assert.equal(record.endpoint, '/v1/responses'); assert.equal(record.requestedTier, 'fast');
    assert.equal(record.returnedTier, 'priority'); assert.equal(record.attempt, 1); assert.equal(record.dispatched, true);
    assert.equal(record.requestBody, f.requests[0].raw);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Decisions may report nonzero output usage without unsupported API output arguments', async () => {
  const f = fixture();
  const p = createRecordedModels(f.client, f.recorder, { models, limits: { maxOutputTokensPerCall: 100 }, transport: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); assert.equal(body.max_output_tokens, undefined); assert.equal(body.service_tier, undefined);
    return new Response(JSON.stringify({ answers: [{ type: 'choice', name: 'speech_dispatch', choice: 'dispatch' }], usage: { input_tokens: 12, output_tokens: 5 } }), { headers: { 'Content-Type': 'application/json' } });
  } });
  assert.equal(await p.decider.evaluate(decisionInput, new AbortController().signal), 'dispatch');
  assert.equal(p.records()[0].reservedOutputTokens, 100);
  assert.equal(p.budget.snapshot().observedOutputTokens, 5); assert.equal(p.budget.snapshot().accountingFailed, false);
  assert.equal(p.budget.snapshot().chargedOutputTokens, 5);
});
