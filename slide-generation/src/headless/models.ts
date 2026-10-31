import OpenAI from 'openai';
import { AsyncLocalStorage } from 'node:async_hooks';
import { OpenAIDecider, OpenAIModel, OpenAISlowDecider } from '../orchestration/openai.js';
import type { Model, Decider, SlowDecider, Role } from '../orchestration/types.js';
import type { RunRecorder } from '../evaluation/recorder.js';

export type ProviderRole = Role | 'decision' | 'slow-decision';
export type ProviderEndpoint = '/v1/responses' | '/v1/decisions';
export interface ProviderLimits {
  maxCalls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxOutputTokensPerCall: number;
}
export const DEFAULT_PROVIDER_LIMITS: ProviderLimits = {
  maxCalls: 200, maxInputTokens: 2_000_000, maxOutputTokens: 100_000, maxOutputTokensPerCall: 8000,
};
export const DECISIONS_TIER_POLICY = {
  endpoint: '/v1/decisions', requestedTier: 'endpoint-default',
  reason: 'Official Decisions schema does not expose service_tier; no unsupported field or header is sent.',
  reference: 'https://developers.openai.com/api/reference/resources/decisions/methods/create',
} as const;
export interface ProviderRecord {
  /** Host routing metadata, never sent in the model request body. */
  slideId?: string;
  id: string; inferenceId: string; role: ProviderRole; agent: string; provider: 'openai'; model: string;
  endpoint: ProviderEndpoint; requestBody: string; responseBody?: string; startedAtMs: number; finishedAtMs: number;
  providerRequestId?: string; inputTokens?: number; outputTokens?: number; status?: number;
  requestedTier: 'fast' | 'endpoint-default'; returnedTier?: string; responseModel?: string;
  reservedInputTokens: number; reservedOutputTokens: number; dispatched: boolean; aborted: boolean;
  attempt: number; usageMissing: boolean; error?: string; errorCode?: string;
}
export interface ProviderCassette { schemaVersion: 1; provenance: 'recorded-model' | 'synthetic-test'; records: ProviderRecord[] }
export interface ProviderConfiguration {
  models: Record<Role | 'decision', string>;
  limits?: Partial<ProviderLimits>;
  transport?: typeof fetch;
  onEvent?: (event: { type: 'started' | 'finished' | 'blocked'; id: string; role: ProviderRole; atMs: number }) => void;
}
export class ProviderBudgetError extends Error {
  readonly code = 'provider_budget';
}
interface Reservation { input: number; output: number }
/** Concurrent calls reserve capacity synchronously before transport. Unknown usage remains charged. */
export class ProviderBudget {
  readonly limits: ProviderLimits;
  private calls = 0;
  private chargedInputTokens = 0;
  private chargedOutputTokens = 0;
  private observedInputTokens = 0;
  private observedOutputTokens = 0;
  private inFlight = 0;
  private unknownUsageCalls = 0;
  private accountingFailed = false;
  constructor(limits: Partial<ProviderLimits> = {}) {
    this.limits = { ...DEFAULT_PROVIDER_LIMITS, ...limits };
    for (const [key, value] of Object.entries(this.limits))
      if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid finite provider budget: ${key}`);
  }
  reserve(input: number, output: number): Reservation {
    if (this.accountingFailed || this.calls >= this.limits.maxCalls || this.chargedInputTokens + input > this.limits.maxInputTokens
      || this.chargedOutputTokens + output > this.limits.maxOutputTokens) throw new ProviderBudgetError('Provider request exceeds remaining shared call/input/output budget');
    this.calls++; this.inFlight++; this.chargedInputTokens += input; this.chargedOutputTokens += output;
    return { input, output };
  }
  settle(reservation: Reservation, usage?: { input: number; output: number }) {
    this.inFlight--;
    if (!usage) { this.unknownUsageCalls++; return; }
    this.observedInputTokens += usage.input; this.observedOutputTokens += usage.output;
    this.chargedInputTokens += usage.input - reservation.input;
    this.chargedOutputTokens += usage.output - reservation.output;
    if (usage.input > reservation.input || usage.output > reservation.output) {
      this.accountingFailed = true;
      throw new ProviderBudgetError('Provider usage exceeded conservative reservation; subsequent calls are blocked');
    }
  }
  snapshot() {
    return { limits: { ...this.limits }, calls: this.calls, chargedInputTokens: this.chargedInputTokens,
      chargedOutputTokens: this.chargedOutputTokens, observedInputTokens: this.observedInputTokens, observedOutputTokens: this.observedOutputTokens,
      inFlight: this.inFlight, unknownUsageCalls: this.unknownUsageCalls, accountingFailed: this.accountingFailed };
  }
  remaining() { return { calls: Math.max(0, this.limits.maxCalls - this.calls), inputTokens: Math.max(0, this.limits.maxInputTokens - this.chargedInputTokens), outputTokens: Math.max(0, this.limits.maxOutputTokens - this.chargedOutputTokens) }; }
}
function countImages(input: unknown): number {
  if (Array.isArray(input)) return input.reduce((sum, value) => sum + countImages(value), 0);
  if (!input || typeof input !== 'object') return 0;
  const record = input as Record<string, unknown>;
  if (record.type === 'input_image') {
    if (typeof record.image_url !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(record.image_url))
      throw new Error('Recorded providers only accept explicit embedded PNG/JPEG/WebP inputs');
    return 1;
  }
  return Object.values(record).reduce<number>((sum, value) => sum + countImages(value), 0);
}
function usageOf(value: any) {
  const input = value?.usage?.input_tokens, output = value?.usage?.output_tokens;
  return Number.isSafeInteger(input) && input >= 0 && Number.isSafeInteger(output) && output >= 0 ? { input, output } : undefined;
}
interface Context { id: string; role: ProviderRole; agent: string; slideId?: string; attempt: number; transportError?: unknown }
type Recorder = Pick<RunRecorder, 'model'>;
function makeModels(client: OpenAI, recorder: Recorder, configuration: ProviderConfiguration, replay?: ProviderCassette) {
  const budget = new ProviderBudget(configuration.limits), context = new AsyncLocalStorage<Context>();
  const records: ProviderRecord[] = [], consumed = new Set<number>();
  let sequence = 0, requestSequence = 0;
  if (configuration.models.decision !== 'gpt-6-luna') throw new Error('Decisions only supports configured model gpt-6-luna; substitution is forbidden');
  if (replay && (replay.schemaVersion !== 1 || !['recorded-model', 'synthetic-test'].includes(replay.provenance))) throw new Error('Invalid provider cassette provenance/version');
  const signalEvent = (type: 'started' | 'finished' | 'blocked', current: Context) => configuration.onEvent?.({ type, id: current.id, role: current.role, atMs: performance.now() });
  const transport: typeof fetch = async (url, init) => {
    const current = context.getStore();
    if (!current) throw new Error('Provider call outside recorded model boundary');
    const endpoint = new URL(String(url)).pathname as ProviderEndpoint;
    if (!['/v1/responses', '/v1/decisions'].includes(endpoint)) throw new Error('Unbudgeted provider endpoint refused');
    if (typeof init?.body !== 'string') throw new Error('Expected exact serialized JSON request body');
    const requestBody = init.body, request = JSON.parse(requestBody);
    if (request.model !== configuration.models[current.role === 'decision' || current.role === 'slow-decision' ? 'decision' : current.role])
      throw new Error('Configured model changed at transport boundary');
    const requestedTier = endpoint === '/v1/responses' ? 'fast' : 'endpoint-default';
    if (endpoint === '/v1/responses' && (request.service_tier !== 'fast' || request.max_output_tokens !== budget.limits.maxOutputTokensPerCall))
      throw new Error('Responses tier or output cap changed at transport boundary');
    if (endpoint === '/v1/decisions' && ('service_tier' in request || 'max_output_tokens' in request)) throw new Error('Unsupported Decisions parameter');
    // UTF-8 bytes conservatively reserve textual input; image reservation is deliberately generous.
    // Usage above the reservation is an accounting failure that blocks all further inference.
    const reservedInputTokens = Buffer.byteLength(requestBody, 'utf8') + 1024 + countImages(request) * 65_536;
    // Decisions exposes no output-limit parameter, but its usage can still report output tokens.
    // Reserve the local per-call allowance without sending an unsupported API argument.
    const reservedOutputTokens = budget.limits.maxOutputTokensPerCall;
    current.attempt++;
    const record: ProviderRecord = { id: `provider-request-${++requestSequence}`, inferenceId: current.id, role: current.role, agent: current.agent,
      ...(current.slideId ? { slideId: current.slideId } : {}),
      provider: 'openai', model: request.model, endpoint, requestBody, startedAtMs: performance.now(), finishedAtMs: 0,
      requestedTier, reservedInputTokens, reservedOutputTokens, dispatched: false, aborted: false, attempt: current.attempt, usageMissing: true };
    let reservation: Reservation | undefined, settled = false;
    try {
      if (init.signal?.aborted) { record.aborted = true; record.errorCode = 'aborted_before_dispatch'; throw new Error('Request aborted before provider dispatch'); }
      let entry: ProviderRecord | undefined;
      if (replay) {
        const index = replay.records.findIndex((entry, index) => !consumed.has(index) && entry.role === current.role && entry.agent === current.agent && entry.endpoint === endpoint);
        if (index < 0) throw new Error('Provider cassette exhausted; live fallback is forbidden');
        entry = replay.records[index];
        if (current.role === 'decision' && entry.slideId !== current.slideId) throw new Error('Provider cassette routing mismatch');
        if (entry.requestBody !== requestBody) throw new Error('Provider cassette context mismatch; requests must match exactly');
        consumed.add(index);
      }
      reservation = budget.reserve(reservedInputTokens, reservedOutputTokens);
      signalEvent('started', current);
      let response: Response;
      if (entry) {
        await new Promise<void>((resolve, reject) => {
          const done = () => { init.signal?.removeEventListener('abort', abort); resolve(); };
          const timer = setTimeout(done, Math.max(0, entry.finishedAtMs - entry.startedAtMs));
          const abort = () => { clearTimeout(timer); init.signal?.removeEventListener('abort', abort); reject(new Error('Replay aborted')); };
          init.signal?.addEventListener('abort', abort, { once: true });
        });
        if (entry.error && !entry.responseBody) { record.aborted = entry.aborted; record.errorCode = entry.errorCode; throw new Error('Recorded provider transport failure'); }
        if (!entry.responseBody || !entry.status) throw new Error('Recorded provider response unavailable');
        response = new Response(entry.responseBody, { status: entry.status, headers: { 'Content-Type': 'application/json', ...(entry.providerRequestId ? { 'x-request-id': entry.providerRequestId } : {}) } });
      } else {
        record.dispatched = true;
        response = await (configuration.transport ?? fetch)(url, init);
      }
      record.status = response.status; record.providerRequestId = response.headers.get('x-request-id') ?? undefined;
      const raw = await response.clone().text();
      // Authentication error text may echo credential fragments. Preserve status, never raw auth text.
      record.responseBody = [401, 403].includes(response.status) ? JSON.stringify({ error: { type: 'authentication_response_redacted', status: response.status } }) : raw;
      let parsed: any;
      try { parsed = JSON.parse(record.responseBody); } catch { record.errorCode = 'non_json_response'; throw new Error('Provider response is not JSON'); }
      record.returnedTier = typeof parsed.service_tier === 'string' ? parsed.service_tier : undefined;
      record.responseModel = typeof parsed.model === 'string' ? parsed.model : undefined;
      const usage = usageOf(parsed); record.inputTokens = usage?.input; record.outputTokens = usage?.output; record.usageMissing = !usage;
      settled = true; budget.settle(reservation, usage);
      if (!response.ok) { record.errorCode = `http_${response.status}`; record.error = `Provider HTTP ${response.status}`; }
      if (response.ok && endpoint === '/v1/responses' && parsed.status !== 'completed') { record.errorCode = 'incomplete'; record.error = `Provider response status ${String(parsed.status)}`; }
      return [401, 403].includes(response.status) ? new Response(record.responseBody, { status: response.status, headers: { 'Content-Type': 'application/json' } }) : response;
    } catch (error) {
      current.transportError = error;
      record.aborted = !!init.signal?.aborted || record.aborted;
      record.errorCode ??= error instanceof ProviderBudgetError ? 'provider_budget' : record.aborted ? 'aborted' : 'transport';
      // Do not serialize arbitrary transport exception text: it may contain request authentication.
      record.error ??= error instanceof ProviderBudgetError ? error.message : record.errorCode;
      if (reservation && !settled) budget.settle(reservation);
      if (!reservation) signalEvent('blocked', current);
      throw error;
    } finally {
      record.finishedAtMs = performance.now(); records.push(record);
      await recorder.model(record);
      signalEvent('finished', current);
    }
  };
  const recordedClient = client.withOptions({ fetch: transport, maxRetries: 0 });
  const delegate = new OpenAIModel(recordedClient, configuration.models, undefined, { maxOutputTokens: budget.limits.maxOutputTokensPerCall });
  const decision = new OpenAIDecider(recordedClient, configuration.models.decision);
  const slowDecision = new OpenAISlowDecider(recordedClient, configuration.models.decision);
  const run = <T>(role: ProviderRole, agent: string, operation: () => Promise<T>, inferenceId?: string, slideId?: string) => {
    const current: Context = { id: inferenceId ?? `provider-${++sequence}`, role, agent, slideId, attempt: 0 };
    return context.run(current, async () => { try { return await operation(); } catch (error) { throw current.transportError ?? error; } });
  };
  const model: Model = { infer: input => run(input.role, input.agent, () => delegate.infer(input), input.inferenceId) };
  const decider: Decider = { evaluate: (input, signal) => run('decision', 'speech-gate', () => decision.evaluate(input, signal), undefined, input.speech.slideId) };
  const slowDecider: SlowDecider = { evaluate: (input, signal) => run('slow-decision', 'slow-gate', () => slowDecision.evaluate(input, signal)) };
  return { model, decider, slowDecider, budget,
    records: () => structuredClone(records),
    statistics: () => Object.fromEntries((['fast', 'slow', 'specialist', 'decision', 'slow-decision'] as const).map(role => {
      const matching = records.filter(record => record.role === role);
      return [role, { attempts: matching.length, dispatched: matching.filter(record => record.dispatched).length,
        aborted: matching.filter(record => record.aborted).length, errors: matching.filter(record => record.error).length,
        observedInputTokens: matching.reduce((sum, record) => sum + (record.inputTokens ?? 0), 0),
        observedOutputTokens: matching.reduce((sum, record) => sum + (record.outputTokens ?? 0), 0),
        unknownUsageCalls: matching.filter(record => record.dispatched && record.usageMissing).length }];
    })),
    replayCassette: (): ProviderCassette => ({ schemaVersion: 1, provenance: replay?.provenance ?? 'recorded-model', records: structuredClone(records) }),
    assertReplayConsumed: () => { if (replay && consumed.size !== replay.records.length) throw new Error('Provider cassette not fully consumed'); },
  };
}
export function createRecordedModels(client: OpenAI, recorder: Recorder, configuration: ProviderConfiguration) {
  return makeModels(client, recorder, configuration);
}
/** Uses the same SDK serialization and provider adapters, with zero network fallback. */
export function createReplayModels(recorder: Recorder, configuration: Omit<ProviderConfiguration, 'transport'>, cassette: ProviderCassette) {
  return makeModels(new OpenAI({ apiKey: 'offline-provider-replay', maxRetries: 0 }), recorder, configuration, cassette);
}
