import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { RunRecorder } from '../src/evaluation/recorder.js';
import { HeadlessViewer } from '../src/headless/viewer.js';
import { writeViewerGallery } from '../src/headless/gallery.js';
import { HeadlessRecordingSession } from '../src/headless/host.js';
import { DEFAULT_MOTION, type PublicationMessage } from '../src/viewer/protocol.js';
import { createLocalRuntime } from '../src/runtime.js';

async function recorder(prefix: string) {
  await mkdir('.artifacts/headless-tests', { recursive: true });
  const dir = await mkdtemp(`.artifacts/headless-tests/${prefix}-`);
  return RunRecorder.create(dir, { schemaVersion: 1, sourceSha: 'a'.repeat(40), dirty: true,
    nodeVersion: process.version, platform: process.platform, startedAt: new Date().toISOString(),
    lockSha256: 'b'.repeat(64), promptSha256: 'c'.repeat(64), fixtureSha256: 'd'.repeat(64), dependencies: [], mode: 'actor-replay' });
}
const css = 'html,body{margin:0} [data-node="slide"]{width:1920px;height:1080px;background:white;color:black;font:48px Arial;padding:80px;box-sizing:border-box}';
const message = (channel: string, sequence: number, value: string, mode: PublicationMessage['mode'] = 'editor'): PublicationMessage => ({
  version: 1, channel, sequence, type: 'publish', publicationId: `p${sequence}`, revision: `r${sequence}`, slideId: 'slide', mode,
  readiness: { revision: `r${sequence}`, ready: true }, build: 0, holdIds: [], motion: { ...DEFAULT_MOTION, durationMs: 0 }, css,
  html: `<div data-node="slide"><p data-node="title" data-primitive="Text" data-content="true" data-role="title">${value}</p><div data-node="stat" data-primitive="Stat"><span data-content="true" data-stat-value="42%">42%</span><span data-content="true" class="td-secondary">Growth</span></div><blockquote data-node="quote" data-primitive="Quote"><p class="td-quote-body" data-content="true">Exact quote.</p><cite data-content="true">Mara</cite></blockquote><p data-node="hidden" data-content="true" data-build="2">Hidden future words</p></div>`,
});

test('headless packaged viewer records actual editor/audience frames, exact content, clocks and video', async () => {
  const record = await recorder('viewer');
  const acknowledgments: string[] = [];
  const viewer = await HeadlessViewer.create({ recorder: record, onAcknowledgment: (ack, clock) => {
    assert.ok(Number.isFinite(clock.offsetMs)); assert.ok(clock.uncertaintyMs >= 0); acknowledgments.push(ack.type);
  } });
  try {
    await viewer.send(message(viewer.channel, 1, 'Editor words')); await viewer.settled();
    await viewer.send(message(viewer.channel, 2, 'Audience words', 'presentation')); await viewer.settled();
    const frames = viewer.frames(); assert.ok(frames.length >= 4);
    const final = frames.at(-1)!;
    assert.equal(final.coherent, true); assert.equal(final.painted, true); assert.equal(final.surface, 'audience'); assert.equal(final.revision, 'r2');
    assert.ok(final.content.some(c => c.kind === 'Stat' && c.text === '42%' && c.label === 'Growth'));
    assert.ok(final.content.some(c => c.kind === 'Quote' && c.text === 'Exact quote.' && c.by === 'Mara'));
    assert.ok(final.content.every(c => !c.text.includes('Hidden future words')));
    assert.ok(final.content.some(c => c.text === 'Audience words' && c.role === 'title'));
    assert.ok(acknowledgments.includes('applied') && acknowledgments.includes('painted') && acknowledgments.includes('settled'));
    await viewer.screenshot();
  } finally { await viewer.close(); }
  const gallery = await writeViewerGallery(record, viewer.frames());
  assert.match(await readFile(gallery, 'utf8'), /Original video/);
  await assert.rejects(writeViewerGallery(record, viewer.frames()), /EEXIST/);
  const files = await readdir(`${record.directory}/viewer`);
  assert.ok(files.some(file => file.endsWith('.webm'))); assert.ok(files.some(file => file.endsWith('.png')));
  const rows = (await readFile(`${record.directory}/viewer/events.jsonl`, 'utf8')).trim().split('\n').map(row => JSON.parse(row));
  assert.ok(rows.some(row => row.surface === 'audience' && row.acknowledgment.type === 'settled'));
});

test('publication transport allows motion retarget and records refused presentation as failure', async () => {
  const record = await recorder('retarget'), viewer = await HeadlessViewer.create({ recorder: record });
  await viewer.send({ ...message(viewer.channel, 1, 'First'), motion: { ...DEFAULT_MOTION, durationMs: 1000 } });
  await viewer.send(message(viewer.channel, 2, 'Latest')); await viewer.settled();
  assert.ok(viewer.frames().some(frame => frame.revision === 'r2' && frame.content.some(c => c.text === 'Latest')));
  await viewer.send({ ...message(viewer.channel, 3, 'Blocked', 'presentation'), readiness: { revision: 'r3', ready: false } });
  await assert.rejects(viewer.settled(), /evidence recording failed/);
  await assert.rejects(viewer.close(), /evidence recording failed/);
  assert.ok(viewer.frames().every(frame => frame.content.every(c => c.text !== 'Blocked')));
});

test('canonical headless recording session records durable source/check/render revisions and audience acknowledgment', async () => {
  const record = await recorder('session');
  const runtime = await createLocalRuntime({ directory: `${record.directory}/runtime` });
  const recording = await HeadlessRecordingSession.create(runtime, record, { slideId: 'n10' });
  try {
    const source = runtime.engine.readSource('n10');
    const edited = await recording.session.editSource({ edits: [{ snapshotId: source.snapshotId, nodeId: source.nodeId, op: 'replace', startLine: 1,
      hashes: source.lines.map(line => line.hash), text: source.lines.map(line => line.text).join('\n').replace('</Slide>', '<Text role="title">Headless canonical title</Text></Slide>') }] });
    assert.equal(edited.accepted, true);
    await recording.settle(); await recording.session.selectSlide('n10', 'presentation'); await recording.settle();
    assert.ok(recording.viewer.frames().some(frame => frame.surface === 'audience' && frame.content.some(c => c.text === 'Headless canonical title')));
    const states = await readdir(`${record.directory}/states`); assert.equal(states.length, 2);
    const values = await Promise.all(states.map(async name => JSON.parse(await readFile(`${record.directory}/states/${name}`, 'utf8'))));
    assert.ok(values.some(value => value.reason === 'input' && JSON.parse(value.checksJson).performed === false && value.renders.length === 0));
    assert.ok(values.some(value => value.reason === 'edit' && value.source.includes('Headless canonical title') && value.renders.length === 1));
  } finally { await recording.close(); await runtime.close(); }
});

test('full native text capture excludes viewport clipping, ancestor clipping and near-transparent words', async () => {
  const record = await recorder('visibility'), viewer = await HeadlessViewer.create({ recorder: record });
  try {
    const html = '<div data-node="slide"><p data-node="ok" data-content="true" style="position:absolute;left:100px;top:100px">Fully visible</p><p data-node="partial" data-content="true" style="position:absolute;left:1900px;top:200px;white-space:nowrap">Partly clipped words</p><div style="position:absolute;left:100px;top:300px;width:70px;height:65px;overflow:hidden"><p data-node="clip" data-content="true" style="width:900px;white-space:nowrap;margin:0">Ancestor clipped words</p></div><p data-node="faint" data-content="true" style="position:absolute;left:100px;top:500px;opacity:.01">Almost transparent</p></div>';
    await viewer.send({ ...message(viewer.channel, 1, ''), html }); await viewer.settled();
    const frame = viewer.frames().findLast(frame => frame.trigger === 'settled')!;
    assert.equal(frame.domEquivalent, true); assert.equal(frame.visibilityVerified, false);
    assert.deepEqual(frame.content.map(content => content.text), ['Fully visible']);
  } finally { await viewer.close(); }
});

test('exit transition samples do not assert exact final DOM before settlement', async () => {
  const record = await recorder('exits'), viewer = await HeadlessViewer.create({ recorder: record });
  try {
    await viewer.send({ ...message(viewer.channel, 1, ''), html: '<div data-node="slide"><p data-node="old" data-content="true">Old visible claim</p></div>' });
    await viewer.settled();
    await viewer.send({ ...message(viewer.channel, 2, ''), motion: { ...DEFAULT_MOTION, durationMs: 500 }, html: '<div data-node="slide"><p data-node="new" data-content="true">Correct replacement</p></div>' });
    await viewer.settled();
    const samples = viewer.frames().filter(frame => frame.publicationId === 'p2');
    assert.equal(samples.find(frame => frame.trigger === 'painted')?.domEquivalent, false);
    const settled = samples.find(frame => frame.trigger === 'settled')!;
    assert.equal(settled.domEquivalent, true); assert.equal(settled.visibilityVerified, true);
    assert.deepEqual(settled.content.map(content => content.text), ['Correct replacement']);
  } finally { await viewer.close(); }
});
