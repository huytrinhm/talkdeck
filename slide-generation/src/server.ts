import { serve } from '@hono/node-server';
import { resolve } from 'node:path';
import { createLocalRuntime } from './runtime.js';

const port = Number(process.env.SLIDE_GENERATION_PORT ?? 8875);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SLIDE_GENERATION_PORT');
const runtime = await createLocalRuntime({ directory: resolve(process.env.SLIDE_GENERATION_DIRECTORY ?? '.artifacts/decks/default') });
const server = serve({ fetch: runtime.app.fetch, hostname: '127.0.0.1', port });
console.log(`Slide generation: http://127.0.0.1:${port}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  server.close(); void runtime.close().finally(() => process.exit());
});
