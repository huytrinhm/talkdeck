import { z } from 'zod';
import { lineHash } from '../hashline.js';
import { SourceError, transactionSchema, type DeckDocument, type SourceRead, type Transaction } from '../contracts.js';
import { utteranceSchema, type InputUtterance } from '../source/ingestion.js';
import { type EvaluationClock } from './clock.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const compatibilitySchema = z.object({
  protocol: z.literal('hashline-replay-v1'), sourceSchema: z.literal(1), toolSchemaSha256: digest, promptSha256: digest,
  dependencies: z.array(z.object({ kind: z.enum(['font', 'asset', 'catalog']), id: z.string(), version: z.string(), sha256: digest }).strict()),
}).strict();
export type ReplayCompatibility = z.infer<typeof compatibilitySchema>;
export function assertReplayCompatible(recorded: ReplayCompatibility, current: ReplayCompatibility, mode: 'transaction' | 'actor') {
  const before = compatibilitySchema.parse(recorded), after = compatibilitySchema.parse(current);
  const ordered = (dependencies: ReplayCompatibility['dependencies']) => [...dependencies].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (before.protocol !== after.protocol || before.sourceSchema !== after.sourceSchema || before.toolSchemaSha256 !== after.toolSchemaSha256
    || JSON.stringify(ordered(before.dependencies)) !== JSON.stringify(ordered(after.dependencies)) || mode === 'actor' && before.promptSha256 !== after.promptSha256)
    throw new SourceError('cassette_incompatible', 'Recorded tools/prompt/dependency contract differs; never repair the response or call a live model');
}
const readSchema = z.object({ snapshotId: z.string(), nodeId: z.string(), revision: digest,
  sourceRange: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict(),
  lines: z.array(z.object({ number: z.number().int().positive(), hash: digest, text: z.string() }).strict()) }).strict();
const outcomeSchema = z.object({ outcome: z.enum(['accepted', 'refused', 'error']), code: z.string().optional(), sourceSha256: digest,
  findingsJson: z.string().optional(), sourceRead: readSchema.optional() }).strict();
export const transactionCassetteSchema = z.object({ schemaVersion: z.literal(1), provenance: z.enum(['recorded-model', 'synthetic-test']),
  compatibility: compatibilitySchema, initial: z.object({ schemaVersion: z.literal(1), source: z.string() }).strict(),
  steps: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('read'), nodeId: z.string(), result: readSchema }).strict(),
    z.object({ kind: z.literal('edit'), transaction: transactionSchema, expected: outcomeSchema }).strict(),
    z.object({ kind: z.literal('input'), input: utteranceSchema, expectedSourceSha256: digest }).strict(),
  ])), finalSourceSha256: digest,
}).strict();
export type TransactionCassette = z.infer<typeof transactionCassetteSchema>;
export interface ReplayTarget {
  readSource(nodeId: string): SourceRead | Promise<SourceRead>;
  readDocument(): DeckDocument;
  edit(input: Transaction): Promise<unknown>;
  ingest?(input: InputUtterance): Promise<unknown>;
  settledInput?(): Promise<unknown>;
}
export class SnapshotReplayMap {
  private recorded = new Map<string, { actual: string; nodeId: string }>();
  private actual = new Set<string>();
  bind(recorded: SourceRead, actual: SourceRead) {
    const withoutHandle = (read: SourceRead) => ({ nodeId: read.nodeId, revision: read.revision, sourceRange: { start: read.sourceRange.start, end: read.sourceRange.end }, lines: read.lines.map(line => ({ number: line.number, hash: line.hash, text: line.text })) });
    if (JSON.stringify(withoutHandle(recorded)) !== JSON.stringify(withoutHandle(actual))) throw new SourceError('replay_read_mismatch', 'Read contents, every hash, revision and scope must match before handle remapping');
    if (this.recorded.has(recorded.snapshotId) || this.actual.has(actual.snapshotId)) throw new SourceError('replay_handle_collision', 'Snapshot remapping must be bijective');
    this.recorded.set(recorded.snapshotId, { actual: actual.snapshotId, nodeId: actual.nodeId }); this.actual.add(actual.snapshotId);
  }
  transaction(transaction: Transaction): Transaction {
    return { edits: transaction.edits.map(edit => {
      const mapped = this.recorded.get(edit.snapshotId);
      if (!mapped || mapped.nodeId !== edit.nodeId) throw new SourceError('replay_unseen_snapshot', 'Recorded edit uses an unseen or wrong-scope read');
      return { ...edit, hashes: [...edit.hashes], snapshotId: mapped.actual };
    }) };
  }
  entries() { return [...this.recorded].map(([recorded, value]) => ({ recorded, ...value })); }
}
export async function replayTransactions(input: TransactionCassette, target: ReplayTarget, compatibility: ReplayCompatibility) {
  const cassette = transactionCassetteSchema.parse(input); assertReplayCompatible(cassette.compatibility, compatibility, 'transaction');
  if (target.readDocument().source !== cassette.initial.source) throw new SourceError('replay_initial_mismatch', 'Replay must initialize the exact recorded canonical source');
  const snapshots = new SnapshotReplayMap(), outcomes: unknown[] = [];
  for (const [index, step] of cassette.steps.entries()) {
    if (step.kind === 'read') snapshots.bind(step.result, await target.readSource(step.nodeId));
    else if (step.kind === 'input') {
      if (!target.ingest || !target.settledInput) throw new SourceError('replay_ingestion_unavailable', 'Cassette requires trusted durable ingestion');
      await target.ingest(step.input); await target.settledInput();
      if (lineHash(target.readDocument().source) !== step.expectedSourceSha256) throw new SourceError('replay_source_mismatch', `Input step ${index} differs from recorded source`);
    } else {
      let result: any, outcome: 'accepted' | 'refused' | 'error', code: string | undefined;
      const transaction = snapshots.transaction(step.transaction);
      try { result = await target.edit(transaction); outcome = result?.accepted === true ? 'accepted' : 'refused'; }
      catch (error) { outcome = 'error'; code = error instanceof SourceError ? error.code : 'internal'; }
      if (step.expected.sourceRead) snapshots.bind(step.expected.sourceRead, readSchema.parse(result?.source));
      const observed = { outcome, code, sourceSha256: lineHash(target.readDocument().source), findingsJson: result?.findings === undefined ? undefined : JSON.stringify(result.findings) };
      if (observed.outcome !== step.expected.outcome || observed.code !== step.expected.code || observed.sourceSha256 !== step.expected.sourceSha256
        || step.expected.findingsJson !== undefined && observed.findingsJson !== step.expected.findingsJson)
        throw new SourceError('replay_outcome_mismatch', `Edit step ${index}: expected ${JSON.stringify(step.expected)}, observed ${JSON.stringify(observed)}`);
      outcomes.push(observed);
    }
  }
  if (lineHash(target.readDocument().source) !== cassette.finalSourceSha256) throw new SourceError('replay_final_mismatch', 'Final source differs');
  return { mode: 'transaction-replay' as const, provenance: cassette.provenance, outcomes, snapshots: snapshots.entries(), sourceSha256: cassette.finalSourceSha256 };
}
export const responseCassetteSchema = z.object({ schemaVersion: z.literal(1), provenance: z.enum(['recorded-model', 'synthetic-test']), compatibility: compatibilitySchema,
  responses: z.array(z.object({ id: z.string(), role: z.string(), requestBody: z.string(), responseBody: z.string(), latencyMs: z.number().finite().nonnegative() }).strict()),
}).strict();
/** Inject this into the actual host model port. It has no provider client and no network fallback. */
export class RecordedResponses {
  private readonly cassette: z.infer<typeof responseCassetteSchema>;
  private readonly used = new Set<number>();
  constructor(input: unknown, compatibility: ReplayCompatibility, private clock: EvaluationClock) {
    this.cassette = responseCassetteSchema.parse(input); assertReplayCompatible(this.cassette.compatibility, compatibility, 'actor');
  }
  async respond(role: string, requestBody: string) {
    const index = this.cassette.responses.findIndex((r, i) => r.role === role && !this.used.has(i));
    if (index < 0) throw new SourceError('cassette_exhausted', `No recorded response for role ${role}; live fallback is forbidden`);
    const record = this.cassette.responses[index];
    if (record.requestBody !== requestBody) throw new SourceError('cassette_context_mismatch', 'Recorded model request differs from actual host context');
    this.used.add(index); await this.clock.until(this.clock.now() + record.latencyMs);
    return { id: record.id, responseBody: record.responseBody, provenance: this.cassette.provenance };
  }
  assertConsumed() { if (this.used.size !== this.cassette.responses.length) throw new SourceError('cassette_unconsumed', 'Host did not consume every recorded response'); }
}

const stable = (value: unknown): string => JSON.stringify(value, (_, nested) => nested && typeof nested === 'object' && !Array.isArray(nested)
  ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => a.localeCompare(b))) : nested);
export const toolCassetteSchema = z.array(z.object({ name: z.string(), argumentsJson: z.string(), resultJson: z.string().optional(), errorCode: z.string().optional() }).strict());
/** Runs actual tools, verifies their result, then returns original recorded handles to the host context. */
export class RecordedTools {
  private index = 0;
  private readonly records: z.infer<typeof toolCassetteSchema>;
  readonly snapshots = new SnapshotReplayMap();
  private readonly transactionIds = new Map<string, string>();
  private readonly actualTransactionIds = new Set<string>();
  constructor(records: unknown, private invokeActual: (name: string, args: unknown) => Promise<unknown>) { this.records = toolCassetteSchema.parse(records); }
  async invoke(name: string, argumentsJson: string) {
    const record = this.records[this.index++];
    if (!record || record.name !== name || record.argumentsJson !== argumentsJson) throw new SourceError('cassette_tool_mismatch', 'Actual host tool sequence or literal arguments differ from cassette');
    let args = JSON.parse(argumentsJson);
    if (name === 'edit_source') args = this.snapshots.transaction(transactionSchema.parse(args));
    let actual: unknown;
    try { actual = await this.invokeActual(name, args); }
    catch (error) {
      const code = error instanceof SourceError ? error.code : 'internal';
      if (record.errorCode !== code || record.resultJson !== undefined) throw new SourceError('cassette_tool_mismatch', 'Actual tool error differs from recorded error');
      throw error;
    }
    if (record.errorCode !== undefined || record.resultJson === undefined) throw new SourceError('cassette_tool_mismatch', 'Actual tool succeeded without a matching recorded success');
    const expected = JSON.parse(record.resultJson);
    const remap = (old: unknown, fresh: unknown): unknown => {
      const read = readSchema.safeParse(old);
      if (read.success) { this.snapshots.bind(read.data, readSchema.parse(fresh)); return old; }
      if (Array.isArray(old) && Array.isArray(fresh)) return fresh.map((value, i) => remap(old[i], value));
      if (old && fresh && typeof old === 'object' && typeof fresh === 'object')
        return Object.fromEntries(Object.entries(fresh).map(([key, value]) => [key, remap((old as Record<string, unknown>)[key], value)]));
      return fresh;
    };
    const normalized = remap(expected, actual) as Record<string, unknown> | null;
    // Only the engine's top-level edit transaction UUID is ephemeral. Compare every
    // other field (including revisions, source, versions and findings) before binding it.
    let transactionPair: { recorded: string; actual: string } | undefined;
    if (name === 'edit_source' && expected && typeof expected === 'object' && 'transactionId' in expected) {
      const recordedId = z.string().uuid().parse(expected.transactionId);
      const actualId = z.string().uuid().parse(normalized?.transactionId);
      transactionPair = { recorded: recordedId, actual: actualId };
      normalized!.transactionId = recordedId;
    }
    if (stable(expected) !== stable(normalized)) throw new SourceError('cassette_tool_result_mismatch', 'Actual tool result differs beyond verified ephemeral snapshot and transaction handles');
    if (transactionPair) {
      if (this.transactionIds.has(transactionPair.recorded) || this.actualTransactionIds.has(transactionPair.actual))
        throw new SourceError('replay_handle_collision', 'Transaction remapping must be bijective');
      this.transactionIds.set(transactionPair.recorded, transactionPair.actual); this.actualTransactionIds.add(transactionPair.actual);
    }
    return expected;
  }
  transactions() { return [...this.transactionIds].map(([recorded, actual]) => ({ recorded, actual })); }
  assertConsumed() { if (this.index !== this.records.length) throw new SourceError('cassette_unconsumed', 'Host did not consume every recorded tool call'); }
}
