import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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
  return { status: response.status, body: await response.json() as any };
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
    assert.equal((await state(host, a)).history.canUndo, false);
    assert.match((await host.store.open(a.id)).runtime.local.engine.readDocument().source, /Private raw evidence/);
  } finally { await host.close(); await rm(f.directory, { recursive: true, force: true }); }
});

test('practice seals once, keeps narration private, prepares exact diffs and accepts only the viewed version with Undo', async () => {
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
    const depth = owner.runtime.backend.historyStatus().undoDepth;
    assert.equal((await request(host, accept, { version: proposal.version }, p.session)).body.status, 'accepted');
    assert.equal(owner.runtime.backend.historyStatus().undoDepth, depth);
    assert.equal((await command(host, p, { type: 'undo' })).status, 200);
    assert.match(owner.runtime.local.engine.readDocument().source, />Before</);
    const reloaded = await request(host, route, undefined, p.session);
    assert.equal(reloaded.body.proposals[0].status, 'accepted', 'receipt remains historical after Undo');
  } finally { await host.close(); await rm(f.directory, { recursive: true, force: true }); }
});
