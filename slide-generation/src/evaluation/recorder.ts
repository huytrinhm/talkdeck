import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { eventSchema } from '../telemetry/trace.js';
import { acknowledgmentSchema } from '../viewer/protocol.js';
import { serializeManifest, runDirectories } from './manifest.js';

const id = z.string().min(1), ms = z.number().finite().nonnegative();
const span = { startedAtMs: ms, finishedAtMs: ms };
const modelSchema = z.object({ id, inferenceId: id, role: id, provider: id, model: id, ...span,
  requestBody: z.string(), responseBody: z.string().optional(), providerRequestId: id.optional(),
  inputTokens: z.number().int().nonnegative().optional(), outputTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(), error: z.string().optional(), retryOf: id.optional(),
}).strict();
const toolSchema = z.object({ id, inferenceId: id.optional(), name: id, argumentsJson: z.string(), resultJson: z.string().optional(),
  ...span, error: z.object({ code: id, message: z.string() }).strict().optional() }).strict();
const stateSchema = z.object({ revision: id, atMs: ms, source: z.string(), reason: z.enum(['input', 'edit']),
  normalizedDiff: z.string(), checksJson: z.string(), renders: z.array(z.object({ slideId: id, html: z.string(), css: z.string(), dependenciesJson: z.string() }).strict()) }).strict();
const inputSchema = z.object({ id, text: z.string(), scheduledEndMs: ms, scheduledAtMs: ms, deliveredAtMs: ms,
  deliveryDriftMs: z.number().finite(), retainedAtMs: ms.optional(), receiptDelayMs: ms.optional(),
  outcome: z.enum(['pending', 'retained', 'failed']), error: z.string().optional() }).strict();
const driverEventSchema = z.object({ kind: z.enum(['input.delivered', 'input.retained', 'input.failed', 'run.finished']), atMs: ms, utteranceId: id.optional(), code: id.optional() }).strict();
const viewerSchema = z.object({ acknowledgment: acknowledgmentSchema, receivedAtMs: ms, clockOffsetMs: z.number().finite(),
  clockUncertaintyMs: ms, surface: z.enum(['editor', 'audience']), framePath: z.string().optional() }).strict();
const secretKey = /^(?:authorization|proxy-authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|credentials?|cookies?|headers)$/i;
function assertNoSecrets(value: unknown, secrets: readonly string[], depth = 0): void {
  if (depth > 64) throw new Error('Artifact nesting exceeds limit');
  if (typeof value === 'string') {
    if (secrets.some(secret => secret.length > 0 && value.includes(secret))) throw new Error('Credential value rejected from artifact');
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (secretKey.test(key)) throw new Error(`Credential-bearing artifact field rejected: ${key}`);
      assertNoSecrets(child, secrets, depth + 1);
    }
  }
}
export class RunRecorder {
  private tail = Promise.resolve();
  private sequence = 0;
  failures: string[] = [];
  readonly directory: string;
  private constructor(directory: string, private secrets: readonly string[]) { this.directory = directory; }
  static async create(directory: string, manifest: unknown, credentialValues: readonly string[] = []) {
    const path = resolve(directory), root = fileURLToPath(new URL('../../.artifacts/', import.meta.url));
    if (relative(root, path).startsWith('..') || path === resolve(root)) throw new Error('Run output must be a new directory inside slide-generation/.artifacts');
    const recorder = new RunRecorder(path, credentialValues);
    const serialized = serializeManifest(manifest); assertNoSecrets(JSON.parse(serialized), credentialValues);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'manifest.json'), serialized, { flag: 'wx' });
    await Promise.all(runDirectories.map(name => mkdir(join(path, name))));
    return recorder;
  }
  private json(value: unknown) { assertNoSecrets(value, this.secrets); return JSON.stringify(value) + '\n'; }
  private enqueue(action: () => Promise<void>) {
    const result = this.tail.then(action);
    this.tail = result.catch(error => { this.failures.push(String(error)); });
    return result;
  }
  private line(file: string, value: unknown) { const data = this.json({ recordSequence: this.sequence++, ...value as object }); return this.enqueue(() => appendFile(join(this.directory, file), data, { mode: 0o600 })); }
  private record(folder: string, identity: string, value: unknown) {
    const file = createHash('sha256').update(identity).digest('hex') + '.json', data = this.json(value);
    return this.enqueue(() => writeFile(join(this.directory, folder, file), data, { flag: 'wx', mode: 0o600 }));
  }
  input(value: unknown) { return this.line('input.jsonl', inputSchema.parse(value)); }
  event(value: unknown) { return this.line('events.jsonl', eventSchema.parse(value)); }
  driverEvent(value: unknown) { return this.line('events.jsonl', driverEventSchema.parse(value)); }
  model(value: unknown) {
    const data = modelSchema.parse(value);
    assertNoSecrets(JSON.parse(data.requestBody), this.secrets);
    if (data.responseBody !== undefined) assertNoSecrets(JSON.parse(data.responseBody), this.secrets);
    if (data.finishedAtMs < data.startedAtMs) throw new Error('Invalid model span');
    return this.record('model', data.id, data);
  }
  tool(value: unknown) {
    const data = toolSchema.parse(value);
    assertNoSecrets(JSON.parse(data.argumentsJson), this.secrets);
    if (data.resultJson !== undefined) assertNoSecrets(JSON.parse(data.resultJson), this.secrets);
    if (data.finishedAtMs < data.startedAtMs) throw new Error('Invalid tool span');
    return this.record('tools', data.id, data);
  }
  state(value: unknown) { const data = stateSchema.parse(value); return this.record('states', data.revision, data); }
  viewer(value: unknown) { return this.line('viewer/events.jsonl', viewerSchema.parse(value)); }
  /** Evaluator frames stay outside model/tool observations unless the model explicitly requested a screenshot. */
  binary(category: 'viewer' | 'screenshots' | 'final', filename: string, bytes: Uint8Array) {
    if (!/^[a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|webm|mp4)$/.test(filename)) throw new Error('Invalid binary artifact name');
    return this.enqueue(() => writeFile(join(this.directory, category, filename), bytes, { flag: 'wx', mode: 0o600 }));
  }
  summary(filename: 'audit.json' | 'metrics.json' | 'failure.json', value: unknown) {
    const data = this.json(value); return this.enqueue(() => writeFile(join(this.directory, filename), data, { flag: 'wx', mode: 0o600 }));
  }
  async flush() { await this.tail; if (this.failures.length) throw new Error(`Recording incomplete: ${this.failures.join('; ')}`); }
}
