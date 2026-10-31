import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry, type ToolObservation } from '../src/tools.js';
import { SlideEngine } from '../src/engine.js';
import { createDeck } from '../src/bootstrap.js';
import { createApp } from '../src/app.js';

test('registry advertises available reads and only the unified mutation tool', async () => {
  const engine = new SlideEngine(createDeck()), registry = new ToolRegistry(engine);
  assert.deepEqual(registry.definitions().map(t => t.name), ['read_source', 'edit_source', 'read_speaker_notes', 'list_library', 'presentation_readiness']);
  for (const name of ['set_text', 'set_props', 'apply_layout', 'screenshot', 'constructor', '__proto__'])
    await assert.rejects(registry.invoke(name, {}), /Unknown or unavailable/);
  const read: any = await registry.invoke('read_source', { nodeId: 'deck' });
  assert.equal(read.nodeId, 'n1');
  assert.match(read.lines[0].hash, /^[a-f0-9]{64}$/);
});
test('explicit screenshot limits and recording preserve successful/rejected tool outcomes', async () => {
  let screenshots = 0;
  const recorded: ToolObservation[] = [];
  const registry = new ToolRegistry(new SlideEngine(createDeck()), {
    async screenshot(_source, slideIds) { screenshots++; return slideIds.map(slideId => ({ slideId, jpeg: new Uint8Array([1, 2, 3]), artifactDigest: 'test-only', sourceDigest: 'test-only' })); },
    searchIcons: query => ({ query, icons: [] }), readIcon: (name, version) => ({ name, version }),
  }, event => recorded.push(event));
  await registry.invoke('read_source', { nodeId: 'n10' });
  assert.equal(screenshots, 0);
  await assert.rejects(registry.invoke('screenshot', { slideIds: ['1','2','3','4','5'] }));
  assert.equal(screenshots, 0);
  const images: any = await registry.invoke('screenshot', { slideIds: ['n10'] });
  assert.equal(images[0].jpeg, 'AQID');
  assert.equal(images[0].mediaType, 'image/jpeg');
  assert.equal(recorded[1].error?.code, 'request');
  assert.ok(recorded.every(e => e.finishedAtMs >= e.startedAtMs));
});
test('Hono exposes discoverable scoped tools and rejects oversized requests', async () => {
  const app = createApp(new SlideEngine(createDeck()));
  const tools = await (await app.request('/tools')).json();
  assert.equal(tools.version, 'hashline-tools-v1');
  const source = await app.request('/tools/read_source', { method: 'POST', body: JSON.stringify({ nodeId: 'n10' }), headers: { 'content-type': 'application/json' } });
  assert.equal(source.status, 200);
  const large = await app.request('/edits', { method: 'POST', body: '{}', headers: { 'content-length': String(9 * 1024 * 1024) } });
  assert.equal(large.status, 413);
});
