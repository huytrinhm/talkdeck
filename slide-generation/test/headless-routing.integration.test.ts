import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { RunRecorder } from '../src/evaluation/recorder.js';
import { monotonicClock } from '../src/evaluation/clock.js';
import { createEvaluationHost } from '../src/headless/evaluation-host.js';

test('a pending rename routes later original words to the stable slide while another slide is selected', async () => {
  await mkdir('.artifacts/tests', { recursive: true });
  const directory = resolve(await mkdtemp('.artifacts/tests/pending-rename-'));
  const recorder = await RunRecorder.create(directory, { schemaVersion: 1, sourceSha: 'a'.repeat(40), dirty: true,
    nodeVersion: process.version, platform: process.platform, startedAt: new Date().toISOString(),
    lockSha256: 'b'.repeat(64), promptSha256: 'c'.repeat(64), fixtureSha256: 'd'.repeat(64), dependencies: [], mode: 'environment' });
  const originalFetch = globalThis.fetch, originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'synthetic-routing-only';
  // Synthetic Decisions holds isolate routing; no request can reach a provider.
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/decisions$/);
    return new Response(JSON.stringify({ answers: [{ type: 'choice', name: 'speech_dispatch', choice: 'hold' }],
      usage: { input_tokens: 1, output_tokens: 1 } }), { headers: { 'content-type': 'application/json' } });
  };
  let host: Awaited<ReturnType<typeof createEvaluationHost>> | undefined;
  try {
    host = await createEvaluationHost({ recorder, clock: monotonicClock, initialContext: 'Synthetic routing test', budget: { maxCalls: 40, maxTokens: 128 } });
    const texts = ['Create a slide titled Launch checklist.', 'Change its title to Release checklist.',
      'New slide titled Owners.', 'On Release checklist, add exactly this qualification.'];
    for (const [index, text] of texts.entries()) {
      const now = performance.now();
      await host.deliverUtterance({ id: `routing-${index}`, text, scheduledEndMs: now, deliveredAtMs: now }, new AbortController().signal);
    }
    const deadline = performance.now() + 10_000;
    while (host.routes.length < texts.length && !host.errors.length && performance.now() < deadline) await delay(10);
    assert.deepEqual(host.errors, []);
    assert.equal(host.routes.length, 4);
    assert.equal(host.routes[3].slideId, host.routes[0].slideId);
    assert.notEqual(host.backend.selectedId, host.routes[3].slideId);
    assert.match(host.local.engine.readSpeakerNotes(host.routes[0].slideId).notes, /add exactly this qualification/);
    assert.doesNotMatch(host.local.engine.readSpeakerNotes(host.backend.selectedId).notes, /add exactly this qualification/);
    assert.equal(host.local.engine.readDocument().source.includes('<Text'), false);
  } finally {
    try { await host?.close(); } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
      await rm(directory, { recursive: true, force: true });
    }
  }
});
