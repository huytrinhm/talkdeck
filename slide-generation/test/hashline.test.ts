import assert from 'node:assert/strict';
import test from 'node:test';
import { SnapshotStore, lineHash } from '../src/hashline.js';
import type { SourceEdit, SourceRead } from '../src/contracts.js';

const source = `<Deck id="n1">
  <Slide id="n2">
    <Text id="t1">Alpha</Text>
    <Text id="t2">Beta</Text>
  </Slide>
</Deck>`;
function edit(read: SourceRead, startLine: number, count: number, text: string, op: SourceEdit['op'] = 'replace'): SourceEdit {
  return { snapshotId: read.snapshotId, nodeId: read.nodeId, startLine, hashes: read.lines.slice(startLine - 1, startLine - 1 + count).map(line => line.hash), text, op };
}
test('accepts two granular edits against the same snapshot', () => {
  const store = new SnapshotStore(), read = store.read(source, 'n2');
  const after = store.stage(source, [edit(read, 2, 1, '    <Text id="t1">Changed A</Text>'), edit(read, 3, 1, '    <Text id="t2">Changed B</Text>')]);
  assert.match(after, /Changed A/); assert.match(after, /Changed B/);
});
test('relocates an unchanged range after a preceding insertion', () => {
  const store = new SnapshotStore(), read = store.read(source, 'n2');
  const current = source.replace('    <Text id="t1">', '    <Spacer id="n3" />\n    <Text id="t1">');
  const after = store.stage(current, [edit(read, 3, 1, '    <Text id="t2">Updated</Text>')]);
  assert.match(after, /Spacer/); assert.match(after, /Updated/);
});
test('accepts unrelated changes within the selected node', () => {
  const store = new SnapshotStore(), read = store.read(source, 'n2');
  const after = store.stage(source.replace('Alpha', 'Unrelated'), [edit(read, 3, 1, '    <Text id="t2">Updated</Text>')]);
  assert.match(after, /Unrelated/); assert.match(after, /Updated/);
});
test('rejects a changed interior line despite unchanged endpoints', () => {
  const store = new SnapshotStore(), read = store.read(source, 'n2');
  assert.throws(() => store.stage(source.replace('Alpha', 'Changed'), [edit(read, 1, 4, read.lines.map(line => line.text).join('\n'))]), /match exactly once/);
});
test('rejects ambiguous repeated text lines inside a node', () => {
  const s = '<Deck id="n1">\n<Slide id="n2">\n<Text id="t1">\nsame\nsame\n</Text>\n</Slide>\n</Deck>';
  const store = new SnapshotStore(), read = store.read(s, 't1');
  assert.throws(() => store.stage(s, [edit(read, 2, 1, 'new')]), /match exactly once/);
});
test('rejects overlap across ancestor and descendant scopes', () => {
  const store = new SnapshotStore(), parent = store.read(source, 'n2'), child = store.read(source, 't1');
  assert.throws(() => store.stage(source, [edit(parent, 2, 1, '<Text id="t1">One</Text>'), edit(child, 1, 1, '<Text id="t1">Two</Text>')]), /overlap/);
});
test('insertion validates neighboring gap context', () => {
  const store = new SnapshotStore(), read = store.read(source, 'n2');
  const patch = edit(read, 2, 1, '    <Spacer />', 'insert_after');
  assert.match(store.stage(source, [patch]), /Spacer/);
  assert.throws(() => store.stage(source.replace('Beta', 'Changed neighbor'), [patch]), /match exactly once/);
});
test('forged and evicted snapshot anchors are refused', () => {
  const store = new SnapshotStore(1), old = store.read(source, 'n2');
  const fresh = store.read(source, 'n2');
  assert.throws(() => store.stage(source, [edit(old, 2, 1, '')]), /Read this node/);
  const patch = edit(fresh, 2, 1, ''); patch.hashes[0] = lineHash('forged');
  assert.throws(() => store.stage(source, [patch]), /Hashes do not match/);
});
test('invalid second edit cannot produce a partially staged result', () => {
  const store = new SnapshotStore(), read = store.read(source, 'n2');
  assert.throws(() => store.stage(source, [edit(read, 2, 1, '<Text id="t1">Good</Text>'), edit(read, 3, 1, '<Text>Broken')]), /syntax|Syntax|Rejected/i);
  assert.equal(store.read(source, 'n2').lines[1].text, '    <Text id="t1">Alpha</Text>');
});
test('scope root cannot be renamed and duplicate IDs are refused after staging', () => {
  const store = new SnapshotStore(), read = store.read(source, 't1');
  assert.throws(() => store.stage(source, [edit(read, 1, 1, '<Text id="t3">A</Text>')]), /does not exist/);
  assert.throws(() => store.stage(source, [edit(read, 1, 1, '<Text id="t2">A</Text>')]), /Duplicate ID/);
});

test('root insertions and replacement siblings cannot escape a selected scope', () => {
  const store = new SnapshotStore(), read = store.read(source, 't1');
  for (const op of ['insert_before', 'insert_after'] as const)
    assert.throws(() => store.stage(source, [edit(read, 1, 1, '<Text>Intruder</Text>', op)]), /parent/);
  for (const text of ['<Text>Intruder</Text><Text id="t1">Alpha</Text>', '<Text id="t1">Alpha</Text><Text>Intruder</Text>'])
    assert.throws(() => store.stage(source, [edit(read, 1, 1, text)]), /escapes/);
  assert.match(store.stage(source, [edit(read, 1, 1, '<Text id="t1">Changed root</Text>')]), /Changed root/);
});
test('resolved anchors include exact bytes, all hashes, ranges and relocation evidence', () => {
  const store = new SnapshotStore(), read = store.read(source, 'n2');
  const current = source.replace('    <Text id="t1">', '    <Spacer />\n    <Text id="t1">');
  const result = store.stageDetailed(current, [edit(read, 3, 1, '    <Text id="t2">Ω 😀 &amp; β</Text>')]);
  assert.equal(result.resolutions[0].relocated, true);
  assert.equal(result.resolutions[0].currentLine, 4);
  assert.equal(result.resolutions[0].exactText, read.lines[2].text);
  assert.deepEqual(result.resolutions[0].hashes, [read.lines[2].hash]);
  assert.equal(read.revision, lineHash(source));
  assert.equal(source.slice(read.sourceRange.start, read.sourceRange.end), read.lines.map(l => l.text).join('\n'));
});
test('inline siblings, multiline attributes and disjoint replacements match a reference result', () => {
  const s = '<Deck id="n1"><Slide id="n2"><Text id="t1"\n role="body">A</Text><Text id="t2">B</Text></Slide></Deck>';
  const store = new SnapshotStore(), a = store.read(s, 't1'), b = store.read(s, 't2');
  assert.equal(store.stage(s, [edit(a, 2, 1, ' role="body">Ω</Text>'), edit(b, 1, 1, '<Text id="t2">😀</Text>')]), s.replace('>A<', '>Ω<').replace('>B<', '>😀<'));
  for (let n = 1; n <= 40; n++) {
    const src = `<Deck id="n1">${Array.from({ length: n }, (_, i) => `<Text id="t${i}">${i}</Text>`).join('\n')}</Deck>`;
    const scopes = Array.from({ length: n }, (_, i) => store.read(src, `t${i}`));
    const patches = scopes.filter((_, i) => i % 2 === 0).map(r => edit(r, 1, 1, `<Text id="${r.nodeId}">Changed</Text>`));
    const expected = src.replace(/<Text id="t(\d+)">\d+<\/Text>/g, (s, i) => Number(i) % 2 ? s : `<Text id="t${i}">Changed</Text>`);
    assert.equal(store.stage(src, patches), expected);
  }
});
test('snapshot handles cannot cross deck engines or survive eviction/restart', () => {
  const store = new SnapshotStore(), read = store.read(source, 'n2');
  assert.throws(() => new SnapshotStore().stage(source, [edit(read, 2, 1, '')]), /Read this node/);
  assert.throws(() => new SnapshotStore(0), /positive/);
});
