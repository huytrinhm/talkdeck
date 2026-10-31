import { fixtureSchema, type TalkFixture } from './fixtures.js';
import { beforeDeadline, monotonicClock, type EvaluationClock } from './clock.js';

export interface DeliveredInput { id: string; text: string; scheduledEndMs: number; deliveredAtMs: number }
export interface EvaluationHost {
  readonly provenance: 'real-system' | 'recorded-host' | 'synthetic-test';
  /** Receipt must mean durable retention. No fixture target aliases or assertions are passed. */
  deliverUtterance(input: DeliveredInput, signal: AbortSignal): Promise<{ utteranceId: string; retainedAtMs: number }>;
  settled(): Promise<boolean>;
}
export interface InputRecord extends DeliveredInput {
  scheduledAtMs: number; deliveryDriftMs: number; retainedAtMs?: number; receiptDelayMs?: number;
  outcome: 'pending' | 'retained' | 'failed'; error?: string;
}
export interface DriverEvent { kind: 'input.delivered' | 'input.retained' | 'input.failed' | 'run.finished'; atMs: number; utteranceId?: string; code?: string }
export interface TalkRun {
  fixtureId: string; provenance: EvaluationHost['provenance']; startMs: number; finishedAtMs: number;
  observationUntilMs: number; deadlineMs: number; inputs: InputRecord[];
  recordingComplete: boolean; settled: boolean; termination: 'settled' | 'deadline' | 'aborted' | 'host-error'; pendingInputIds: string[]; undeliveredInputIds: string[]; errors: string[];
}
export interface DriverOptions {
  clock?: EvaluationClock; signal?: AbortSignal; pollMs?: number;
  onInput?: (record: InputRecord) => void | Promise<void>; onEvent?: (event: DriverEvent) => void | Promise<void>;
}
export async function runTalk(input: TalkFixture, host: EvaluationHost, options: DriverOptions = {}): Promise<TalkRun> {
  const fixture = fixtureSchema.parse(input), clock = options.clock ?? monotonicClock, pollMs = options.pollMs ?? 50;
  if (!Number.isFinite(pollMs) || pollMs <= 0) throw new Error('Polling interval must be positive');
  const startMs = clock.now(), last = fixture.events.at(-1)!;
  const observationUntilMs = startMs + last.endMs + last.silenceAfterMs + fixture.timing.postTalkObservationMs;
  const deadlineMs = observationUntilMs + fixture.timing.maxDrainMs;
  const controller = new AbortController(), records: InputRecord[] = [], errors: string[] = [];
  let finished = false, settled = false, termination: TalkRun['termination'] = 'deadline';
  const abort = () => controller.abort(options.signal?.reason ?? new Error('Run aborted'));
  if (options.signal?.aborted) abort(); else options.signal?.addEventListener('abort', abort, { once: true });
  const pendingRecording = new Set<Promise<void>>();
  let recordingComplete = true;
  const observe = (kind: string, callback: () => void | Promise<void>) => {
    const failed = (error: unknown) => { recordingComplete = false; errors.push(`${kind} recording failed: ${String(error)}`); };
    try {
      const result = callback();
      if (result) {
        const pending = Promise.resolve(result).catch(failed).finally(() => pendingRecording.delete(pending));
        pendingRecording.add(pending);
      }
    } catch (error) { failed(error); }
  };
  const emit = (event: DriverEvent) => observe('event', () => options.onEvent?.(event));
  const record = (value: InputRecord) => observe('input', () => options.onInput?.({ ...value }));
  try {
    // Every utterance gets an independent absolute deadline. Model/ingestion promises never serialize delivery.
    const deliveries = fixture.events.map(async event => {
      await clock.until(startMs + event.endMs, controller.signal);
      const deliveredAtMs = clock.now();
      const entry: InputRecord = { id: event.id, text: event.text, scheduledEndMs: event.endMs,
        scheduledAtMs: startMs + event.endMs, deliveredAtMs, deliveryDriftMs: deliveredAtMs - startMs - event.endMs, outcome: 'pending' };
      records.push(entry); record(entry); emit({ kind: 'input.delivered', atMs: deliveredAtMs, utteranceId: event.id });
      try {
        // Calling the host is synchronous only until its receipt promise is returned. Any blocking is visible as drift.
        const receipt = host.deliverUtterance({ id: event.id, text: event.text, scheduledEndMs: event.endMs, deliveredAtMs }, controller.signal);
        Promise.resolve(receipt).then(value => {
          if (finished) return;
          if (value.utteranceId !== event.id || !Number.isFinite(value.retainedAtMs) || value.retainedAtMs < deliveredAtMs) throw new Error('Invalid durable receipt or clock domain');
          entry.outcome = 'retained'; entry.retainedAtMs = value.retainedAtMs; entry.receiptDelayMs = value.retainedAtMs - deliveredAtMs;
          record(entry); emit({ kind: 'input.retained', atMs: clock.now(), utteranceId: event.id });
        }).catch(error => {
          if (finished) return;
          entry.outcome = 'failed'; entry.error = String(error); record(entry);
          emit({ kind: 'input.failed', atMs: clock.now(), utteranceId: event.id, code: 'receipt_failed' });
        });
      } catch (error) {
        entry.outcome = 'failed'; entry.error = String(error); record(entry);
        emit({ kind: 'input.failed', atMs: clock.now(), utteranceId: event.id, code: 'delivery_failed' });
      }
    });
    await Promise.all(deliveries);
    await clock.until(observationUntilMs, controller.signal);
    while (!controller.signal.aborted && clock.now() < deadlineMs) {
      const status = await beforeDeadline(host.settled(), deadlineMs, clock);
      if (!status.completed) break;
      if (status.value && records.every(r => r.outcome !== 'pending')) { settled = true; termination = 'settled'; break; }
      await clock.until(Math.min(deadlineMs, clock.now() + pollMs), controller.signal);
    }
    if (controller.signal.aborted) termination = 'aborted';
  } catch (error) { termination = controller.signal.aborted ? 'aborted' : 'host-error'; errors.push(String(error)); }
  finally { finished = true; controller.abort(); options.signal?.removeEventListener('abort', abort); }
  const finishedAtMs = clock.now();
  emit({ kind: 'run.finished', atMs: finishedAtMs, code: termination });
  if (pendingRecording.size && !(await beforeDeadline(Promise.all([...pendingRecording]), deadlineMs, clock)).completed) {
    recordingComplete = false; errors.push('Recording did not complete before the drain deadline');
  }
  return { recordingComplete, fixtureId: fixture.id, provenance: host.provenance, startMs, finishedAtMs, observationUntilMs, deadlineMs,
    inputs: records, settled, termination, pendingInputIds: records.filter(r => r.outcome === 'pending').map(r => r.id), undeliveredInputIds: fixture.events.filter(e => !records.some(r => r.id === e.id)).map(e => e.id), errors };
}
