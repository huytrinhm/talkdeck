import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeck } from '../src/bootstrap.js';
import { designState } from '../src/design/state.js';

test('design evidence is derived from source, including reload/undo rather than sticky completion flags', () => {
  const seed = createDeck().source;
  assert.equal(designState(seed).theme, 'matches_bootstrap_defaults');
  assert.equal(designState(seed.replace('#fafafa', '#f7f7f1')).theme, 'customized');
  assert.equal(designState(seed.replace('id="n3"', 'id="theme"')).theme, 'matches_bootstrap_defaults');
  assert.equal(designState(seed).theme, 'matches_bootstrap_defaults');
});
