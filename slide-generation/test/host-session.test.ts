import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createLocalRuntime } from '../src/runtime.js';
import { GenerationSession, type HostEvent } from '../src/host/session.js';
import type { BuildMessage, PublicationMessage } from '../src/viewer/protocol.js';
import { JsxBackend } from '../src/host/jsx-backend.js';

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

test('build commands use increasing sequences and acknowledgments bind the issued build and publication', async () => {
  await mkdir('.artifacts/tests', { recursive: true });
  const directory = await mkdtemp('.artifacts/tests/host-build-');
  const runtime = await createLocalRuntime({ directory: resolve(directory) });
  const publications: PublicationMessage[] = [], builds: BuildMessage[] = [], events: HostEvent[] = [];
  const session = new GenerationSession(runtime.engine, runtime.tools, runtime.renderer, runtime.browser, {
    channel: 'test_build_channel_12345', slideId: 'n10',
    send: m => { publications.push(m); }, sendBuild: m => { builds.push(m); }, record: e => { events.push(e); },
  });
  try {
    await assert.rejects(session.setBuild(1), /valid publication/);
    await session.selectSlide('n10', 'presentation');
    const publication = publications.at(-1)!;
    const first = await session.setBuild(2), second = await session.setBuild(0);
    assert.deepEqual(builds.map(m => m.sequence), [publication.sequence + 1, publication.sequence + 2]);
    const ack = { version: 1, channel: publication.channel, type: 'painted', publicationId: publication.publicationId,
      revision: publication.revision, slideId: publication.slideId, sequence: first.sequence, build: 2,
      monotonicMs: 10, timeOriginMs: 100, visibleNodeIds: [] };
    const clock = { offsetMs: 0, uncertaintyMs: 1 };
    await session.acknowledge(ack, clock);
    await session.acknowledge({ ...ack, sequence: second.sequence, build: 0 }, clock);
    await assert.rejects(session.acknowledge({ ...ack, sequence: second.sequence }, clock), /issued publication/);
    await assert.rejects(session.acknowledge({ ...ack, sequence: 900 }, clock), /issued publication/);
    await assert.rejects(session.acknowledge({ ...ack, publicationId: 'unissued' }, clock), /issued publication/);
    await assert.rejects(session.setBuild(-1));
    await session.selectSlide('n10', 'presentation', 2);
    assert.equal(publications.at(-1)!.build, 2, 'reconnect publication retains explicitly supplied build');
    assert.ok(publications.at(-1)!.sequence > second.sequence);
    assert.equal(events.filter(e => e.type === 'build').length, 2);
  } finally { await session.close(); await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});

test('deleting the selected slide publishes the surviving neighbor at the committed revision', async () => {
  await mkdir('.artifacts/tests', { recursive: true });
  const directory = await mkdtemp('.artifacts/tests/host-deletion-');
  const runtime = await createLocalRuntime({ directory: resolve(directory) });
  const sent: PublicationMessage[] = [], events: HostEvent[] = [];
  const session = new GenerationSession(runtime.engine, runtime.tools, runtime.renderer, runtime.browser,
    { channel: 'test_deletion_channel_12345', slideId: 'n10', send: m => { sent.push(m); }, record: e => { events.push(e); } });
  const backend = new JsxBackend(runtime, { instructions: '', onSelection: id => session.selectSlide(id) });
  try {
    await backend.initialize(runtime.engine.readDocument().source);
    const second = await backend.createSlide('Temporary');
    await backend.deliverUtterance({ id: 'retained-on-delete', slideId: second.id, text: 'Keep this original source.', deliveredAtMs: 1 });
    const removedSource = runtime.engine.readSource(second.id).lines.map(l => l.text).join('\n');
    const read = runtime.engine.readSource('deck');
    const context = backend.generation.context({ agent: 'slow', role: 'slow', inferenceId: 'delete', signal: new AbortController().signal });
    const result = await backend.generation.invoke({ agent: 'slow', role: 'slow', inferenceId: 'delete', context, signal: new AbortController().signal }, 'edit_source', {
      edits: [{ snapshotId: read.snapshotId, nodeId: read.nodeId, op: 'replace', startLine: 1, hashes: read.lines.map(l => l.hash), text: read.lines.map(l => l.text).join('\n').replace(removedSource, '') }],
    });
    assert.equal((result.output as any).accepted, true);
    await session.settle();
    assert.equal(backend.selectedId, 'n10');
    assert.equal(sent.at(-1)?.slideId, backend.selectedId);
    assert.equal(sent.at(-1)?.revision, runtime.engine.state().revision);
    assert.equal(events.filter(event => event.type === 'publication-refused').length, 0);
    assert.match(runtime.engine.readDocument().source, /ArchivedSlide/);
    assert.match(runtime.engine.readDocument().source, /Keep this original source/);
    assert.doesNotMatch(sent.at(-1)!.html, /Keep this original source/);
  } finally { await backend.close(); await session.close(); await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});

test('navigation reuses exact browser evidence but refreshes changed dependencies and never caches failures', async () => {
  await mkdir('.artifacts/tests', { recursive: true });
  const directory = await mkdtemp('.artifacts/tests/navigation-cache-');
  const runtime = await createLocalRuntime({ directory: resolve(directory) });
  const inspect = runtime.browser.inspect.bind(runtime.browser);
  const render = runtime.renderer.render.bind(runtime.renderer);
  let inspections = 0, dependencyVersion = 'one', fail = false;
  runtime.browser.inspect = async artifact => {
    inspections++;
    if (fail) throw new Error('Fixture browser unavailable');
    return inspect(artifact);
  };
  runtime.renderer.render = async (source, slideId) => {
    const artifact = await render(source, slideId);
    artifact.dependencies.push({ kind: 'renderer', id: 'fixture', version: dependencyVersion, sha256: dependencyVersion });
    return artifact;
  };
  const sent: PublicationMessage[] = [];
  const session = new GenerationSession(runtime.engine, runtime.tools, runtime.renderer, runtime.browser,
    { channel: 'navigation_cache_channel', slideId: 'n10', send: m => { sent.push(m); }, record() {} });
  try {
    await session.selectSlide('n10');
    const baseline = inspections;
    await session.selectSlide('n10');
    await session.selectSlide('n10', 'presentation');
    assert.equal(inspections, baseline, 'unchanged navigation and mode reuse measured artifacts');
    assert.equal(sent.length, 3);
    dependencyVersion = 'two';
    await session.selectSlide('n10');
    assert.ok(inspections > baseline, 'dependency-only changes remeasure unchanged source');
    const refreshed = inspections;
    await runtime.browser.check(runtime.engine.readDocument().source);
    assert.ok(inspections > refreshed, 'normal authoring checks remain fresh');
    dependencyVersion = 'failure'; fail = true;
    const published = sent.length;
    await session.selectSlide('n10');
    assert.equal(sent.length, published, 'failed validation cannot publish');
    const failedInspections = inspections;
    fail = false;
    await session.selectSlide('n10');
    assert.ok(inspections > failedInspections, 'failure is retried, never cached as success');
    assert.equal(sent.length, published + 1);
  } finally { await session.close(); await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});

test('structural edits reuse unchanged render evidence and publication reuses candidate checks', async () => {
  await mkdir('.artifacts/tests', { recursive: true });
  const directory = await mkdtemp('.artifacts/tests/edit-evidence-cache-');
  const runtime = await createLocalRuntime({ directory: resolve(directory) });
  const backend = new JsxBackend(runtime, { instructions: '' });
  const session = new GenerationSession(runtime.engine, runtime.tools, runtime.renderer, runtime.browser,
    { channel: 'edit_evidence_cache_channel', slideId: 'n10', send() {}, record() {} });
  const inspect = runtime.browser.inspect.bind(runtime.browser);
  const inspected: string[] = [];
  runtime.browser.inspect = async artifact => { inspected.push(artifact.slideId); return inspect(artifact); };
  try {
    await session.selectSlide('n10');
    inspected.length = 0;
    const created = await backend.createSlide();
    await session.selectSlide(created.id);
    assert.deepEqual(inspected, [created.id], 'only the new slide needs a browser measurement');
    inspected.length = 0;
    await backend.deleteSlide(created.id);
    await session.selectSlide('n10');
    assert.deepEqual(inspected, [], 'deletion without a rendered change reuses exact evidence');
    await runtime.engine.ingest({ id: 'private-only', slideId: 'n10', text: 'New private evidence', deliveredAtMs: 1 });
    await runtime.engine.settledInput();
    const source = runtime.engine.readDocument().source;
    const report = await runtime.browser.check(source, { reusePublicationChecks: true });
    assert.deepEqual(inspected, [], 'private narration does not invalidate pixels');
    const fresh = await runtime.browser.check(source);
    assert.equal(report.evidence[0].sourceDigest, fresh.evidence[0].sourceDigest);
    assert.equal(report.evidence[0].artifactDigest, fresh.evidence[0].artifactDigest);
  } finally { await backend.close(); await session.close(); await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});
