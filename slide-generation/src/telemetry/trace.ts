import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const id = z.string().min(1);
export const causeSchema = z.object({
  deckId: id, revision: id, utteranceId: id.optional(), transactionId: id.optional(),
  inferenceId: id.optional(), toolCallId: id.optional(), publicationId: id.optional(),
}).strict();
export type Cause = z.infer<typeof causeSchema>;
export const eventSchema = z.object({
  schemaVersion: z.literal(1), id, sequence: z.number().int().nonnegative(),
  monotonicMs: z.number().finite().nonnegative(), wallStart: z.string().datetime(),
  kind: z.enum(['source.read', 'edit.started', 'edit.refused', 'edit.committed', 'input.retained',
    'model.started', 'model.finished', 'render.finished', 'publication.sent', 'viewer.painted', 'viewer.settled']),
  cause: causeSchema, code: id.optional(),
}).strict();
export type TraceEvent = z.infer<typeof eventSchema>;
/** Only typed causal metadata enters this log; never environment variables or credentials. */
export class Trace {
  private sequence = 0;
  failures = 0;
  private readonly start = performance.now();
  private readonly wallStart = new Date().toISOString();
  constructor(private readonly sink: (event: TraceEvent) => void = () => {}) {}
  emit(kind: TraceEvent['kind'], cause: Cause, code?: string) {
    const event = eventSchema.parse({ schemaVersion: 1, id: randomUUID(), sequence: this.sequence++,
      monotonicMs: performance.now() - this.start, wallStart: this.wallStart, kind, cause, code });
    try { Promise.resolve(this.sink(event)).catch(() => { this.failures++; }); } catch { this.failures++; }
    return event;
  }
}
