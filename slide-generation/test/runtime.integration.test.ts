import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createLocalRuntime } from '../src/runtime.js';
import { nodeById, parseSource } from '../src/parser.js';

function patch(runtime: Awaited<ReturnType<typeof createLocalRuntime>>, id: string, transform: (source: string) => string) {
  const read = runtime.engine.readSource(id);
  return { edits: [{ snapshotId: read.snapshotId, nodeId: read.nodeId, op: 'replace', startLine: 1, hashes: read.lines.map(l => l.hash), text: transform(read.lines.map(l => l.text).join('\n')) }] };
}
test('real engine commits rendered/browser-validated content, refuses overflow, captures and reloads durable source', async () => {
  await mkdir('.artifacts/tests', { recursive: true });
  const directory = await mkdtemp('.artifacts/tests/live-engine-');
  let runtime = await createLocalRuntime({ directory: resolve(directory) });
  try {
    const receipt = await runtime.engine.ingest({ id: 'u1', slideId: 'n10', text: 'Revenue grew 42%.', deliveredAtMs: 10 });
    assert.equal(receipt.utteranceId, 'u1');
    await runtime.engine.settledInput();
    const result = await runtime.engine.edit(patch(runtime, 'n10', s => s.replace('</Slide>', '<Text role="title">Revenue</Text><Stat value="42%" label="growth" /></Slide>')));
    assert.equal(result.accepted, true, JSON.stringify(result));
    assert.equal(runtime.engine.state().mutationsReady, true);
    const rendered = await runtime.renderer.render(runtime.engine.readDocument().source, 'n10');
    assert.match(rendered.html, /Revenue/);
    assert.doesNotMatch(rendered.html, /Revenue grew 42%|Transcript|SpeakerNotes/);
    assert.equal((await runtime.engine.readiness()).ready, true);
    const captured = await runtime.browser.screenshot(runtime.engine.readDocument().source, ['n10']);
    assert.equal(captured[0].jpeg[0], 0xff); assert.equal(captured[0].jpeg[1], 0xd8);
    const source = runtime.engine.readDocument().source;
    const stat = [...(function* walk(n: any): Generator<any> { yield n; for (const c of n.children) if (typeof c !== 'string') yield* walk(c); })(parseSource(source))].find(n => n.tag === 'Stat');
    const bad = await runtime.engine.edit(patch(runtime, stat.id, s => s.replace('value="42%"', `value="${'1234567890'.repeat(20)}"`)));
    assert.equal(bad.accepted, false);
    assert.equal(runtime.engine.readDocument().source, source);
    assert.equal((await runtime.repository.load()).document.source, source);
    await runtime.close();
    runtime = await createLocalRuntime({ directory: resolve(directory) });
    assert.equal(runtime.engine.readDocument().source, source);
    assert.equal(runtime.engine.readSpeakerNotes('n10').notes, 'Revenue grew 42%.');
    assert.equal((await runtime.engine.readiness()).ready, true);
  } finally { await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});
test('real Hono transaction archives deleted slide evidence atomically and returns success only after checks', async () => {
  await mkdir('.artifacts/tests', { recursive: true });
  const directory = await mkdtemp('.artifacts/tests/live-archive-');
  const runtime = await createLocalRuntime({ directory: resolve(directory) });
  try {
    await runtime.engine.ingest({ id: 'u-archive', slideId: 'n10', text: 'Keep my source after deletion.', deliveredAtMs: 1 });
    await runtime.engine.settledInput();
    const add = patch(runtime, 'deck', s => s.replace('<Archive id="n13" />', '<Slide freeForm={{reason:"Second slide"}}><Transcript/><SpeakerNotes/><Text role="title">Second</Text></Slide><Archive id="n13" />'));
    const response = await runtime.app.request('/edits', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'add-second' }, body: JSON.stringify(add) });
    assert.equal(response.status, 200, await response.clone().text());
    const before = runtime.engine.readDocument().source, first = nodeById(parseSource(before), 'n10');
    const remove = patch(runtime, 'deck', s => s.replace(before.slice(first.start, first.end), ''));
    assert.equal((await runtime.engine.edit(remove)).accepted, true);
    const archived = runtime.engine.readSpeakerNotes('n10');
    assert.equal(archived.archived, true);
    assert.equal(archived.notes, 'Keep my source after deletion.');
    assert.match(archived.transcript, /Keep my source after deletion/);
    assert.equal((await runtime.engine.readiness()).ready, true);
  } finally { await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});
