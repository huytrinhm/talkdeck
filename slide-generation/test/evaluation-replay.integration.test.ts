import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createLocalRuntime } from '../src/runtime.js';
import { lineHash, SnapshotStore } from '../src/hashline.js';
import { nodes, parseSource } from '../src/parser.js';
import { RecordedTools, replayTransactions, type TransactionCassette, type ReplayCompatibility } from '../src/evaluation/replay.js';
import type { Transaction, SourceRead } from '../src/contracts.js';

const change = (read: SourceRead, text: string): Transaction => ({ edits: [{ snapshotId: read.snapshotId, nodeId: read.nodeId, op: 'replace', startLine: 1, hashes: read.lines.map(l => l.hash), text }] });
test('synthetic recorded tool cassette replays accepted and refused edits through real Chromium and durable engine', async () => {
  await mkdir('.artifacts/evaluation-tests', { recursive: true });
  const dir = await mkdtemp('.artifacts/evaluation-tests/replay-');
  const original = await createLocalRuntime({ directory: `${dir}/original` });
  let replay: Awaited<ReturnType<typeof createLocalRuntime>> | undefined;
  try {
    const initial = original.engine.readDocument();
    const compatibility: ReplayCompatibility = { protocol: 'hashline-replay-v1', sourceSchema: 1,
      toolSchemaSha256: lineHash(JSON.stringify(original.tools.definitions())), promptSha256: 'b'.repeat(64), dependencies: [] };
    const firstRead = original.engine.readSource('n10');
    const transaction = change(firstRead, firstRead.lines.map(l => l.text).join('\n').replace('</Slide>', '<Text role="title">Exact retained claim</Text></Slide>'));
    const accepted = await original.engine.edit(transaction); assert.equal(accepted.accepted, true);
    const afterAccepted = original.engine.readDocument().source;
    const textId = [...nodes(parseSource(afterAccepted))].find(n => n.tag === 'Text')!.id!;
    const secondRead = original.engine.readSource(textId);
    const overflow = change(secondRead, `<Text id="${textId}" role="title">${'W'.repeat(400)}</Text>`);
    const refused = await original.engine.edit(overflow); assert.equal(refused.accepted, false);
    const cassette: TransactionCassette = { schemaVersion: 1, provenance: 'synthetic-test', compatibility, initial,
      steps: [
        { kind: 'read', nodeId: 'n10', result: firstRead },
        { kind: 'edit', transaction, expected: { outcome: 'accepted', sourceSha256: lineHash(afterAccepted) } },
        { kind: 'read', nodeId: textId, result: secondRead },
        { kind: 'edit', transaction: overflow, expected: { outcome: 'refused', sourceSha256: lineHash(afterAccepted) } },
      ], finalSourceSha256: lineHash(afterAccepted) };
    await writeFile(`${dir}/cassette.json`, JSON.stringify(cassette, null, 2));
    replay = await createLocalRuntime({ directory: `${dir}/replayed` });
    const result = await replayTransactions(cassette, replay.engine, compatibility);
    assert.equal(result.outcomes.length, 2);
    assert.equal(result.snapshots.length, 2);
    assert.ok(result.snapshots.every(pair => pair.recorded !== pair.actual));
    assert.equal(replay.engine.readDocument().source, afterAccepted);
    assert.equal((await replay.engine.readiness()).ready, true);
    const refusalReads = new SnapshotStore();
    await assert.rejects(replayTransactions(cassette, {
      readDocument: () => initial, readSource: nodeId => refusalReads.read(initial.source, nodeId), edit: async () => ({ accepted: false }),
    }, compatibility), /Edit step/);
  } finally { await original.close(); await replay?.close(); await rm(`${dir}/original`, { recursive: true, force: true }); await rm(`${dir}/replayed`, { recursive: true, force: true }); }
});


test('actual accepted edit tool replay verifies source and maps only fresh snapshot and transaction UUIDs', async () => {
  await mkdir('.artifacts/evaluation-tests', { recursive: true });
  const dir = await mkdtemp('.artifacts/evaluation-tests/tool-sequence-');
  const original = await createLocalRuntime({ directory: `${dir}/original` });
  const replay = await createLocalRuntime({ directory: `${dir}/replayed` });
  try {
    const readArgs = JSON.stringify({ nodeId: 'n10' });
    const read = await original.tools.invoke('read_source', JSON.parse(readArgs)) as SourceRead;
    const editArgs = JSON.stringify(change(read, read.lines.map(l => l.text).join('\n').replace('</Slide>', '<Text role="title">Exact actor replay</Text></Slide>')));
    const accepted = await original.tools.invoke('edit_source', JSON.parse(editArgs));
    assert.equal((accepted as { accepted: boolean }).accepted, true);
    const records = [{ name: 'read_source', argumentsJson: readArgs, resultJson: JSON.stringify(read) },
      { name: 'edit_source', argumentsJson: editArgs, resultJson: JSON.stringify(accepted) }];
    const tools = new RecordedTools(records, (name, args) => replay.tools.invoke(name, args));
    assert.deepEqual(await tools.invoke('read_source', readArgs), read);
    assert.deepEqual(await tools.invoke('edit_source', editArgs), accepted);
    tools.assertConsumed();
    assert.equal(tools.transactions().length, 1); assert.notEqual(tools.transactions()[0].recorded, tools.transactions()[0].actual);
    assert.equal(replay.engine.readDocument().source, original.engine.readDocument().source);
    assert.equal((await replay.engine.readiness()).ready, true);
    for (const mutation of [{ revision: 'f'.repeat(64) }, { versions: {} }, { findings: [{ message: 'different' }] }]) {
      const altered = new RecordedTools(records.slice(1), async () => ({ ...(accepted as object), transactionId: randomUUID(), ...mutation }));
      altered.snapshots.bind(read, { ...read, snapshotId: randomUUID() });
      await assert.rejects(altered.invoke('edit_source', editArgs), /result differs/);
      assert.equal(altered.transactions().length, 0);
    }
  } finally { await original.close(); await replay.close(); await rm(dir, { recursive: true, force: true }); }
});
