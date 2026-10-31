import test from 'node:test';
import assert from 'node:assert/strict';
import { manifestDependencies, recordedDependencyInventory } from '../src/evaluation/dependencies.js';
import { lineHash } from '../src/hashline.js';
const font = { kind: 'font', id: 'NotoSans-Regular.ttf', version: 'pinned', sha256: 'a'.repeat(64) };
const asset = { kind: 'asset', id: 'chart', version: 'v1', sha256: 'b'.repeat(64) };
test('manifest preserves actual typed dependency identity and bytes, deduplicates and rejects conflicts', () => {
  const dependencies = manifestDependencies([font, asset, font]);
  assert.equal(dependencies.length, 2);
  assert.ok(dependencies.some(d => d.name === 'font:NotoSans-Regular.ttf' && d.sha256 === font.sha256));
  assert.ok(dependencies.every(d => /font|asset|lucide/i.test(d.name)), 'Existing comparator recognizes typed assets and fonts');
  assert.throws(() => manifestDependencies([font, { ...font, sha256: 'c'.repeat(64) }]), /Conflicting/);
  assert.throws(() => manifestDependencies([{ ...font, sha256: 'not-a-digest' }]));
});
test('inventory retains transient recorded assets and exact source references without claiming final coverage', () => {
  const result = recordedDependencyInventory([
    { phase: 'initial', reference: 'configuration.json', source: 'initial', dependencies: [font] },
    { phase: 'recorded-state', reference: 'states/earlier.json', source: 'with chart', revision: lineHash('with chart'), slideId: 'n10', dependencies: [font, asset] },
    { phase: 'recorded-state', reference: 'states/later.json', source: 'chart deleted', revision: lineHash('chart deleted'), slideId: 'n10', dependencies: [font] },
  ]);
  assert.equal(result.status, 'consistent'); assert.equal(result.finalCoverage, 'not-verified');
  assert.equal(result.dependencies.length, 2); assert.equal(result.sources[1].sourceSha256, lineHash('with chart'));
  assert.equal(result.sources[1].reference, 'states/earlier.json');
});
test('inventory marks missing, corrupt and conflicting records without silently erasing their evidence', () => {
  const result = recordedDependencyInventory([
    { phase: 'initial', reference: 'configuration.json', source: 'initial', dependencies: [font] },
    { phase: 'recorded-state', reference: 'states/conflict.json', source: 'changed', dependencies: [{ ...font, sha256: 'd'.repeat(64) }] },
    { phase: 'recorded-state', reference: 'states/corrupt.json', source: 'bad', revision: lineHash('different'), dependencies: [asset] },
  ], [{ reference: 'states/missing.json', error: 'Missing recorded state' }]);
  assert.equal(result.status, 'conflict'); assert.equal(result.conflicts.length, 1); assert.equal(result.errors.length, 2);
  assert.equal(result.dependencies.length, 2); assert.equal(result.finalCoverage, 'not-verified');
  assert.equal(recordedDependencyInventory([]).status, 'incomplete');
});
