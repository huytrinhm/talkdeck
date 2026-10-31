import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const navigationTracingEnabled = () => process.env.TALKDECK_TRACE_NAVIGATION === '1';
const path = resolve(fileURLToPath(new URL('../.data/navigation-trace.jsonl', import.meta.url)));
let writes = Promise.resolve();
export function recordNavigationTrace(event: Record<string, unknown>) {
  if (!navigationTracingEnabled()) return;
  const line = JSON.stringify({ ...event, receivedAt: new Date().toISOString() });
  console.log(`[nav-trace] ${line}`);
  // Logging never delays a command or acknowledgment, and serial writes preserve order.
  writes = writes.then(async () => { await mkdir(dirname(path), { recursive: true }); await appendFile(path, line + '\n'); })
    .catch(error => { console.error('[nav-trace] write failed', error.code); });
}
export function serverNavigationTrace(traceId: string, action: string, projectId: string) {
  const started = performance.now();
  return (phase: string, fields: Record<string, unknown> = {}) => recordNavigationTrace({
    ...fields, source: 'server', traceId, action, projectId, phase,
    elapsedMs: Math.round((performance.now() - started) * 10) / 10,
  });
}
