import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { capabilities } from '../src/capabilities.js';
import { createApp } from '../src/app.js';
import { SlideEngine } from '../src/engine.js';
import { createDeck } from '../src/bootstrap.js';
import { createLocalRuntime } from '../src/runtime.js';

test('bare engine availability remains distinct from installed optional implementations', async () => {
  const engine = new SlideEngine(createDeck());
  const bare = await (await createApp(engine).request('/health')).json();
  assert.deepEqual(bare.capabilities, capabilities());
  assert.equal(bare.mutationsReady, false);
  assert.equal(bare.capabilities.browser, false);
  assert.equal(bare.capabilities.assets, false);
  assert.equal(bare.capabilities.liveHost, false);
  const bound = createApp(engine, {
    async checkSlides() { return { complete: false, findings: [], pendingNodeIds: [] }; },
    searchIcons() { return []; },
  });
  const health = await (await bound.request('/health')).json();
  assert.equal(health.capabilities.browser, true); // Bound implementation, not a passing check.
  assert.equal(health.capabilities.icons, false); // Search alone is not complete catalog access.
  assert.equal(health.capabilities.mutationsReady, health.mutationsReady);
});

test('real runtime health reports bound browser/render/catalog and synchronized mutation status', async () => {
  await mkdir('.artifacts/tests', { recursive: true });
  const directory = await mkdtemp('.artifacts/tests/capabilities-');
  const runtime = await createLocalRuntime({ directory: resolve(directory) });
  try {
    const initial = await (await runtime.app.request('/health')).json();
    for (const key of ['renderer', 'browser', 'icons', 'commit']) assert.equal(initial.capabilities[key], true, key);
    assert.equal(initial.capabilities.assets, false);
    assert.equal(initial.capabilities.liveHost, false);
    assert.equal(initial.mutationsReady, false);
    assert.equal(initial.capabilities.mutationsReady, initial.mutationsReady);
    assert.equal((await runtime.engine.readiness()).complete, true); // Actual Chromium.
    const checked = await (await runtime.app.request('/health')).json();
    assert.equal(checked.mutationsReady, true);
    assert.equal(checked.capabilities.mutationsReady, true);
    await runtime.browser.close();
    assert.equal((await runtime.engine.readiness()).complete, false);
    const unavailable = await (await runtime.app.request('/health')).json();
    assert.equal(unavailable.capabilities.browser, true); // Still installed/bound; runtime check failed.
    assert.equal(unavailable.mutationsReady, false);
    assert.equal(unavailable.capabilities.mutationsReady, false);
  } finally { await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});

test('asset availability is advertised only for an injected resolver', async () => {
  await mkdir('.artifacts/tests', { recursive: true });
  const directory = await mkdtemp('.artifacts/tests/asset-capability-');
  const runtime = await createLocalRuntime({ directory: resolve(directory), assets: {
    async resolve() { throw new Error('Specific references remain subject to exact asset resolution'); },
  } });
  try {
    const health = await (await runtime.app.request('/health')).json();
    assert.equal(health.capabilities.assets, true);
    assert.equal(health.capabilities.liveHost, false);
    assert.equal(health.capabilities.mutationsReady, health.mutationsReady);
  } finally { await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});
