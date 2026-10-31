import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createProductApp } from '../server/app.js';
import { createPracticeRuntime } from '../../slide-generation/src/practice/runtime.js';
import type { Reviewer } from '../../slide-generation/src/practice/contracts.js';
import type { Session, Snapshot } from '../shared/protocol.js';

// Provider stubs are explicit. Canonical source, persistence, validation and previews use real Chromium.
const reviewer: Reviewer = { async review({ context }) {
  const read = context.baseline.reads.find(r => r.nodeId === 'n10')!;
  const target = read.lines.find(l => l.text.includes('Before'))!;
  return { summary: 'Fixture feedback', feedback: [{ id: 'f1', observation: 'Fixture title change', suggestion: 'Use After', evidenceIds: ['n10'] }],
    proposals: [{ id: 'p1', title: 'Fixture change', rationale: 'Explicit test proposal', feedbackIds: ['f1'], evidenceIds: ['n10'], alternativeTo: [],
      edits: [{ snapshotId: read.snapshotId, nodeId: read.nodeId, op: 'replace', startLine: target.number, hashes: [target.hash], text: target.text.replace('Before', 'After') }] }] };
} };
async function setup() {
  process.env.OPENAI_API_KEY ||= 'fixture-only-no-network';
  await mkdir('.artifacts/tests', { recursive: true });
  const directory = resolve(await mkdtemp('.artifacts/tests/product-'));
  const make = () => createProductApp({ directory, runtimeFactory: options => createPracticeRuntime({ ...options, reviewer,
    actors: { autoTick: false, model: { async infer() { throw new Error('Unexpected paid-generation path in deterministic test'); } },
      decider: { async evaluate() { return 'hold'; } }, slowDecider: { async evaluate() { return 'hold'; } } } }) });
  return { directory, make, host: await make() };
}
type Host = Awaited<ReturnType<typeof createProductApp>>;
async function request(host: Host, path: string, body?: unknown, session?: Session, method = body === undefined ? 'GET' : 'POST') {
  const response = await host.app.request(path, { method, headers: { 'Content-Type': 'application/json',
    ...(session ? { 'X-Session-Id': session.id, 'X-Session-Token': session.token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json().catch(() => ({})) as any };
}
async function project(host: Host, name: string) {
  const created = await request(host, '/api/projects', { name, context: 'Private project context' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const base = `/api/projects/${created.body.id}`;
  const attached = await request(host, `${base}/sessions`, { role: 'editor' });
  assert.equal(attached.status, 201, JSON.stringify(attached.body));
  return { id: created.body.id as string, base, session: attached.body as Session };
}
async function state(host: Host, p: Awaited<ReturnType<typeof project>>) {
  const response = await request(host, `${p.base}/state`, undefined, p.session);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body as Snapshot;
}
async function command(host: Host, p: Awaited<ReturnType<typeof project>>, fields: Record<string, unknown>, id = crypto.randomUUID()) {
  return request(host, `${p.base}/commands`, { id, epoch: (await state(host, p)).epoch, ...fields }, p.session);
}
async function seed(host: Host, id: string) {
  const owner = await host.store.open(id);
  const read = owner.runtime.local.engine.readSource('n10');
  const result = await owner.runtime.local.engine.edit({ edits: [{ snapshotId: read.snapshotId, nodeId: read.nodeId, op: 'replace', startLine: 1,
    hashes: read.lines.map(l => l.hash), text: read.lines.map(l => l.text).join('\n').replace('</Slide>', '<Text role="title">Before</Text><Text role="body" build={2}>Built detail</Text></Slide>') }] });
  assert.equal(result.accepted, true, JSON.stringify(result));
  return owner;
}

test('product projects, receipts, epochs, Present privacy and restart recovery use one canonical owner', async () => {
  const f = await setup(); let host = f.host;
  try {
    const a = await project(host, 'Project A'), b = await project(host, 'Project B');
    const owner = await seed(host, a.id);
    assert.equal(owner, await host.store.open(a.id));
    const changed = await command(host, a, { type: 'mode', mode: 'talk' });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    const current = await state(host, a);
    const input = { id: 'same-utterance', epoch: current.epoch, slideId: current.selectedId, text: 'Private raw evidence.', startMs: 0, endMs: 1000 };
    const first = await request(host, `${a.base}/input`, input, a.session);
    assert.equal(first.status, 202, JSON.stringify(first.body));
    const duplicate = await request(host, `${a.base}/input`, input, a.session);
    assert.equal(duplicate.body.duplicate, true);
    assert.notEqual((await request(host, `${a.base}/input`, { ...input, text: 'Conflicting retry' }, a.session)).status, 200);
    await owner.runtime.local.engine.settledInput();
    assert.equal((owner.runtime.local.engine.readDocument().source.match(/Private raw evidence\./g) ?? []).length, 2, 'one raw prompt and one cleaned note, never duplicated');
    assert.doesNotMatch((await host.store.open(b.id)).runtime.local.engine.readDocument().source, /Private raw evidence/);
    assert.notEqual((await request(host, `${b.base}/state`, undefined, a.session)).status, 200);
    const entering = await command(host, a, { type: 'mode', mode: 'present' });
    assert.equal(entering.status, 200, JSON.stringify(entering.body));
    assert.notEqual((await request(host, `${a.base}/input`, { ...input, id: 'late-input' }, a.session)).status, 200);
    const reopened = await request(host, `${a.base}/sessions`, { role: 'editor' });
    a.session = reopened.body;
    assert.equal((await state(host, a)).mode, 'talk', 'reopening starts in Talk');
    const persisted = JSON.parse(await readFile(`${owner.directory}/project.json`, 'utf8'));
    assert.equal('mode' in persisted, false, 'previous mode is never saved');
    assert.equal((await request(host, `${a.base}/pdf`, undefined, a.session)).status, 404);
    assert.equal((await request(host, `${a.base}/practice`, undefined, a.session)).status, 404);
    assert.equal((await command(host, a, { type: 'mode', mode: 'present' })).status, 200);
    const before = owner.runtime.local.engine.readDocument().source;
    const present = await state(host, a);
    assert.equal((await request(host, `${a.base}/input`, { ...input, id: 'narration', epoch: present.epoch, text: 'Delete this slide.' }, a.session)).status, 202);
    assert.equal(owner.runtime.local.engine.readDocument().source, before);
    const audienceResult = await request(host, `${a.base}/sessions`, { role: 'audience' });
    const audience = audienceResult.body as Session;
    assert.equal(audience.snapshot, undefined);
    assert.notEqual((await request(host, `${a.base}/state`, undefined, audience)).status, 200);
    assert.notEqual((await request(host, `${a.base}/commands`, { id: 'audience-write', epoch: present.epoch, type: 'add' }, audience)).status, 200);
    const view = await request(host, `${a.base}/viewer`, undefined, audience);
    assert.equal(view.status, 200, JSON.stringify(view.body));
    assert.doesNotMatch(JSON.stringify(view.body), /Private raw evidence|Private project context|SpeakerNotes|Transcript/);
    await command(host, a, { type: 'next' }); await command(host, a, { type: 'next' });
    assert.equal((await state(host, a)).slides.length, 1, 'final Next never creates a slide');
    await host.close(); host = await f.make();
    const reattached = await request(host, `${a.base}/sessions`, { role: 'editor' }); a.session = reattached.body;
    assert.equal((await state(host, a)).slides.length, 1);
    assert.equal((await state(host, a)).mode, 'talk');
    assert.equal('history' in await state(host, a), false);
    assert.match((await host.store.open(a.id)).runtime.local.engine.readDocument().source, /Private raw evidence/);
  } finally { await host.close(); await rm(f.directory, { recursive: true, force: true }); }
});

test('practice seals once, keeps narration private, prepares exact diffs and accepts only the viewed version without history controls', async () => {
  const f = await setup(), host = f.host;
  try {
    const p = await project(host, 'Review journey'), owner = await seed(host, p.id);
    assert.equal((await command(host, p, { type: 'mode', mode: 'practice', input: 'transcript' })).status, 200);
    const s = await state(host, p), before = owner.runtime.local.engine.readDocument().source;
    assert.equal((await request(host, `${p.base}/input`, { id: 'rehearsal', epoch: s.epoch, slideId: s.selectedId, text: 'Delete this slide. After is the clearer title.', startMs: 0, endMs: 1000 }, p.session)).status, 202);
    assert.equal(owner.runtime.local.engine.readDocument().source, before);
    const route = `${p.base}/practice/${s.practiceId}`;
    assert.equal((await request(host, `${route}/finish`, {}, p.session)).status, 202);
    const record = await owner.runtime.practice.wait(s.practiceId!);
    assert.equal(record.status, 'ready', record.error ?? '');
    assert.equal(record.proposals[0].status, 'ready', record.proposals[0].error ?? '');
    assert.equal(owner.runtime.local.engine.readDocument().source, before);
    const proposal = record.proposals[0], preview = proposal.previews[0];
    assert.equal(preview.visualDiff?.proposalVersion, proposal.version);
    assert.ok(preview.visualDiff?.changes.some(c => c.kind === 'text'));
    assert.ok(preview.before?.capture?.imageDigest);
    const accept = `${route}/proposals/${proposal.id}/accept`;
    assert.notEqual((await request(host, accept, { version: proposal.version + 1 }, p.session)).status, 200);
    const accepted = await request(host, accept, { version: proposal.version }, p.session);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.status, 'accepted');
    assert.match(owner.runtime.local.engine.readDocument().source, />After</);
    assert.equal((await request(host, accept, { version: proposal.version }, p.session)).body.status, 'accepted');
    assert.equal((await command(host, p, { type: 'undo' })).status, 400);
    assert.match(owner.runtime.local.engine.readDocument().source, />After</);
    const reloaded = await request(host, route, undefined, p.session);
    assert.equal(reloaded.body.proposals[0].status, 'accepted', 'acceptance receipt remains available for the current review');
  } finally { await host.close(); await rm(f.directory, { recursive: true, force: true }); }
});

test('Add slide selects and publishes the created slide; subsequent navigation reuses browser evidence', async () => {
  const f = await setup();
  try {
    const p = await project(f.host, 'Navigation');
    const before = await state(f.host, p);
    const added = await command(f.host, p, { type: 'add' });
    assert.equal(added.status, 200, JSON.stringify(added.body));
    const snapshot = added.body.snapshot as Snapshot;
    assert.equal(snapshot.slides.length, before.slides.length + 1);
    assert.equal(snapshot.selectedId, snapshot.slides.at(-1)!.id);
    const view = await request(f.host, `${p.base}/viewer`, undefined, p.session);
    assert.equal(view.body.message.slideId, snapshot.selectedId, 'new slide is the actual viewer publication');
    const owner = await f.host.store.open(p.id);
    const inspect = owner.runtime.local.browser.inspect.bind(owner.runtime.local.browser);
    let checks = 0;
    owner.runtime.local.browser.inspect = async artifact => { checks++; return inspect(artifact); };
    const start = performance.now();
    await command(f.host, p, { type: 'previous' });
    assert.equal((await state(f.host, p)).selectedId, before.selectedId);
    await command(f.host, p, { type: 'next' });
    assert.equal((await state(f.host, p)).selectedId, snapshot.selectedId);
    assert.equal(checks, 0, 'navigation must not reopen Chromium for the unchanged deck');
    console.log(`Unchanged previous + next: ${Math.round(performance.now() - start)}ms (local API)`);
  } finally { await f.host.close(); await rm(f.directory, { recursive: true, force: true }); }
});

test('prepared navigation contains canonical public renderer output and build order without changing selection', async () => {
  const f = await setup();
  try {
    const p = await project(f.host, 'Prepared navigation');
    const owner = await seed(f.host, p.id);
    const before = await state(f.host, p);
    const prepared = await request(f.host, `${p.base}/navigation`, undefined, p.session);
    assert.equal(prepared.status, 200);
    assert.equal(prepared.body.revision, before.revision);
    assert.equal(prepared.body.epoch, before.epoch);
    assert.deepEqual(prepared.body.slides[0].builds, [0, 2]);
    assert.match(prepared.body.slides[0].html, /Before/);
    assert.doesNotMatch(JSON.stringify(prepared.body), /Private project context|SpeakerNotes|Transcript/);
    assert.equal(owner.runtime.backend.selectedId, before.selectedId);
    await command(f.host, p, {type:'mode', mode:'present'});
    const audience = (await request(f.host, `${p.base}/sessions`, {role:'audience'})).body;
    assert.equal((await request(f.host, `${p.base}/navigation`, undefined, audience)).status, 403);
    const next = await request(f.host, `${p.base}/navigation`, undefined, p.session);
    assert.equal(next.body.mode, 'presentation');
    assert.equal(next.body.slides[0].readiness.ready, true);
  } finally { await f.host.close(); await rm(f.directory, {recursive:true,force:true}); }
});

test('explicit slide deletion selects a neighbor, retains evidence, deduplicates and survives reload', async () => {
  const f = await setup(); let host = f.host;
  try {
    const p = await project(host, 'Delete slides');
    const original = (await state(host, p)).selectedId;
    const added = await command(host, p, {type:'add'});
    const middle = added.body.snapshot.selectedId;
    const third = (await command(host, p, {type:'add'})).body.snapshot.selectedId;
    const owner = await host.store.open(p.id);
    await owner.runtime.backend.deliverUtterance({id:'deleted-evidence',slideId:middle,text:'Retain these private notes.',deliveredAtMs:1});
    await owner.runtime.local.engine.settledInput();
    await command(host, p, {type:'select',slideId:middle});
    const commandId = crypto.randomUUID();
    const removed = await command(host, p, {type:'delete',slideId:middle}, commandId);
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.equal(removed.body.snapshot.selectedId, third);
    assert.deepEqual(removed.body.snapshot.slides.map((s:any)=>s.id), [original, third]);
    assert.equal(removed.body.viewer.slideId, third);
    assert.match(owner.runtime.local.engine.readDocument().source, /ArchivedSlide/);
    assert.match(owner.runtime.local.engine.readDocument().source, /Retain these private notes/);
    assert.doesNotMatch(removed.body.viewer.html, /Retain these private notes/);
    const duplicate = await command(host, p, {type:'delete',slideId:middle}, commandId);
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.snapshot.slides.length, 2);
    await command(host, p, {type:'mode',mode:'present'});
    assert.equal((await command(host, p, {type:'delete',slideId:third})).status, 409);
    await command(host, p, {type:'mode',mode:'talk'});
    assert.equal((await command(host, p, {type:'delete',slideId:third})).body.snapshot.selectedId, original);
    assert.equal((await command(host, p, {type:'delete',slideId:original})).status, 409);
    assert.equal((await state(host, p)).slides.length, 1);
    await host.close(); host = await f.make();
    p.session = (await request(host, `${p.base}/sessions`, {role:'editor'})).body;
    const reloaded = await state(host, p);
    assert.deepEqual(reloaded.slides.map(s=>s.id), [original]);
    assert.equal(reloaded.selectedId, original);
  } finally { await host.close(); await rm(f.directory, {recursive:true,force:true}); }
});
