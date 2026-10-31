import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDeck } from '../src/bootstrap.js';
import { FileDeckRepository } from '../src/storage/repository.js';
import { EvidenceInbox } from '../src/storage/inbox.js';
import { ingestCandidate } from '../src/source/ingestion.js';

async function temporary() { await mkdir('.artifacts/tests', { recursive: true }); return mkdtemp('.artifacts/tests/storage-'); }
test('atomic repository persists exact canonical source, no-op and stale CAS semantics across reload', async () => {
  const dir = await temporary();
  try {
    const path = join(dir, 'deck.json'), repo = new FileDeckRepository(path), seed = createDeck();
    const initial = await repo.initialize(seed);
    assert.deepEqual((await new FileDeckRepository(path).load()).document, seed);
    assert.deepEqual(await repo.compareAndSwap(initial.revision, seed), initial);
    const candidate = { ...seed, source: seed.source.replace('<Brief id="n2" />', '<Brief id="n2">Changed</Brief>') };
    const results = await Promise.allSettled([repo.compareAndSwap(initial.revision, candidate), new FileDeckRepository(path).compareAndSwap(initial.revision, seed)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(r => r.status === 'rejected').length, 1);
    const committed = await new FileDeckRepository(path).load();
    assert.deepEqual(committed.document, candidate);
    const bytes = await readFile(path, 'utf8');
    await assert.rejects(repo.compareAndSwap(committed.revision, { ...seed, source: '<Deck />' }), /assigned IDs/);
    assert.equal(await readFile(path, 'utf8'), bytes);
    // A crash before rename may leave a temporary file; load only trusts the canonical path.
    await writeFile(`${path}.interrupted.tmp`, '{unfinished');
    assert.deepEqual((await repo.load()).document, candidate);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('pending input survives restart, acknowledges independently and only clears after exact source retention', async () => {
  const dir = await temporary();
  try {
    const inbox = new EvidenceInbox(join(dir, 'inbox'));
    const input = { id: 'u/1', slideId: 'n10', text: 'Exact input & {braces}', deliveredAtMs: 10 };
    assert.equal((await inbox.retain(input)).duplicate, false);
    assert.equal((await inbox.retain(input)).duplicate, true);
    assert.deepEqual(await new EvidenceInbox(join(dir, 'inbox')).pending(), [input]);
    await assert.rejects(inbox.retain({ ...input, text: 'changed' }), /different data/);
    await assert.rejects(inbox.complete(input.id, createDeck().source), /not in committed source/);
    const source = ingestCandidate(createDeck().source, input).source;
    await inbox.complete(input.id, source);
    assert.deepEqual(await inbox.pending(), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('inbox preserves receipt order when utterance timestamps tie or arrive out of order', async () => {
  const dir = await temporary();
  try {
    const inbox = new EvidenceInbox(dir);
    for (const [id, deliveredAtMs] of [['z', 10], ['a', 10], ['b', 1]] as const)
      await inbox.retain({ id, slideId: 'n10', text: id, deliveredAtMs });
    assert.deepEqual((await inbox.pending()).map(e => e.id), ['z', 'a', 'b']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
