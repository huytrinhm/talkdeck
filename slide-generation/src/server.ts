import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createDeck } from './bootstrap.js';
import { SlideEngine } from './engine.js';

const port = Number(process.env.SLIDE_GENERATION_PORT ?? 8875);
serve({ fetch: createApp(new SlideEngine(createDeck())).fetch, hostname: '127.0.0.1', port });
console.log(`Slide generation scaffold: http://127.0.0.1:${port}`);
