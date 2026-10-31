import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createLocalRuntime } from '../src/runtime.js';
import { GenerationSession, type HostEvent } from '../src/host/session.js';
import type { PublicationMessage } from '../src/viewer/protocol.js';

test('host adapter publishes private-evidence-free artifacts and correlates explicit viewer acknowledgments', async () => {
  await mkdir('.artifacts/tests', { recursive: true });
  const directory = await mkdtemp('.artifacts/tests/host-session-');
  const runtime = await createLocalRuntime({ directory: resolve(directory) });
  const sent: PublicationMessage[] = [], events: HostEvent[] = [];
  const session = new GenerationSession(runtime.engine, runtime.tools, runtime.renderer, runtime.browser,
    { channel: 'test_host_channel_12345', slideId: 'n10', send: m => { sent.push(m); }, record: e => { events.push(e); } });
  try {
    await session.deliverUtterance({ id: 'private-input', slideId: 'n10', text: 'Private original utterance.', deliveredAtMs: 1 });
    await runtime.engine.settledInput(); await session.settle();
    assert.equal(sent.length, 0);
    await session.selectSlide('n10');
    assert.equal(sent.length, 1);
    assert.doesNotMatch(JSON.stringify(sent[0]), /Private original utterance|SpeakerNotes|Transcript/);
    const ack = { version: 1, channel: sent[0].channel, type: 'painted', publicationId: sent[0].publicationId,
      revision: sent[0].revision, slideId: sent[0].slideId, sequence: sent[0].sequence, monotonicMs: 10, timeOriginMs: 100, visibleNodeIds: [] };
    await assert.rejects(session.acknowledge({ ...ack, revision: 'forged' }, { offsetMs: 0, uncertaintyMs: 1 }), /issued publication/);
    await session.acknowledge(ack, { offsetMs: 5, uncertaintyMs: 1 });
    assert.equal(events.at(-1)?.type, 'viewer');
    const read = runtime.engine.readSource('n10');
    const result = await session.editSource({ edits: [{ snapshotId: read.snapshotId, nodeId: 'n10', op: 'replace', startLine: 1,
      hashes: read.lines.map(l => l.hash), text: read.lines.map(l => l.text).join('\n').replace('</Slide>', '<Pending kind="headline"/></Slide>') }] });
    assert.equal(result.accepted, true);
    await session.settle();
    const count = sent.length;
    await session.selectSlide('n10', 'presentation');
    assert.equal(sent.length, count);
    assert.equal(events.at(-1)?.type, 'publication-refused');
  } finally { await session.close(); await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});
