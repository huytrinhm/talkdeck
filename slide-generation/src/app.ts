import { Hono } from 'hono';
import { ZodError } from 'zod';
import { CANVAS, SourceError } from './contracts.js';
import { SlideEngine } from './engine.js';

export function createApp(engine: SlideEngine) {
  const app = new Hono();
  app.get('/health', c => c.json({ status: 'scaffold', canvas: CANVAS, mutationsReady: false }));
  app.get('/source/:nodeId', c => c.json(engine.readSource(c.req.param('nodeId'))));
  app.get('/slides/:slideId/speaker-notes', c => c.json(engine.readSpeakerNotes(c.req.param('slideId'))));
  app.get('/presentation-readiness', async c => c.json(await engine.readiness()));
  app.post('/edits', async c => {
    let input: unknown;
    try { input = await c.req.json(); } catch { throw new SourceError('request', 'Expected a JSON transaction'); }
    const result = await engine.edit(input);
    return c.json(result, 422);
  });
  app.onError((error, c) => {
    if (error instanceof ZodError) return c.json({ accepted: false, code: 'request', issues: error.issues }, 400);
    if (error instanceof SourceError) {
      const status = ['validation_unavailable', 'not_implemented'].includes(error.code) ? 503 : error.code === 'missing_node' ? 404 : 422;
      return c.json({ accepted: false, code: error.code, message: error.message, nodeId: error.nodeId }, status);
    }
    return c.json({ accepted: false, code: 'internal', message: 'Operation failed; source unchanged' }, 500);
  });
  return app;
}
