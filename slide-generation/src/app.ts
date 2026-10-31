import { bodyLimit } from 'hono/body-limit';
import { ToolRegistry, type ToolServices } from './tools.js';
import { capabilities } from './capabilities.js';
import { Hono } from 'hono';
import { ZodError } from 'zod';
import { CANVAS, SourceError } from './contracts.js';
import { SlideEngine } from './engine.js';

export function createApp(engine: SlideEngine, services: ToolServices = {}, availability: { assets?: boolean } = {}) {
  const app = new Hono();
  const registry = new ToolRegistry(engine, services);
  app.use('*', bodyLimit({ maxSize: 8 * 1024 * 1024, onError: c => c.json({ accepted: false, code: 'request_limit', message: 'Request exceeds 8 MiB' }, 413) }));
  app.get('/health', c => {
    const state = engine.state();
    return c.json({ status: 'ok', canvas: CANVAS, capabilities: capabilities({
      renderer: !!services.render, browser: !!services.checkSlides,
      icons: !!services.searchIcons && !!services.readIcon, assets: availability.assets === true,
      commit: state.commitConfigured, mutationsReady: state.mutationsReady,
    }), ...state });
  });
  app.get('/deck', c => c.json(engine.readDocument()));
  app.get('/tools', c => c.json({ version: registry.version, tools: registry.definitions() }));
  app.post('/tools/:name', async c => c.json(await registry.invoke(c.req.param('name'), await c.req.json()) as any));
  app.get('/library', c => c.json(engine.listLibrary()));
  app.get('/source/:nodeId', c => c.json(engine.readSource(c.req.param('nodeId'))));
  app.get('/slides/:slideId/speaker-notes', c => c.json(engine.readSpeakerNotes(c.req.param('slideId'))));
  app.get('/presentation-readiness', async c => c.json(await engine.readiness()));
  app.post('/edits', async c => {
    let input: unknown;
    try { input = await c.req.json(); } catch { throw new SourceError('request', 'Expected a JSON transaction'); }
    const result = await engine.edit(input, c.req.header('Idempotency-Key'));
    return c.json(result, result.accepted ? 200 : 422);
  });
  app.onError((error, c) => {
    if (error instanceof ZodError) return c.json({ accepted: false, code: 'request', issues: error.issues }, 400);
    if (error instanceof SourceError) {
      const status = ['validation_unavailable', 'not_implemented', 'ingestion_unavailable', 'tool_unavailable', 'durability_uncertain'].includes(error.code) ? 503 : error.code === 'missing_node' ? 404 : 422;
      return c.json({ accepted: false, code: error.code, message: error.message, nodeId: error.nodeId, span: error.span }, status);
    }
    return c.json({ accepted: false, code: 'internal', message: 'Operation failed; read current source before retrying' }, 500);
  });
  return app;
}
