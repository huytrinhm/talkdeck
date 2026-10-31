import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationCommand, namedInputTarget } from '../src/headless/input-routing.js';

test('spoken navigation preserves quoted punctuation and decimal titles', () => {
  assert.deepEqual(navigationCommand('New slide titled “Q3.1, results”. Revenue rose.'), { type: 'new', title: 'Q3.1, results' });
  assert.deepEqual(navigationCommand('Create a slide titled Q3.1 review. Show revenue.'), { type: 'new', title: 'Q3.1 review' });
  assert.deepEqual(navigationCommand('Return to "Q3.1, results". Keep values.'), { type: 'select', title: 'Q3.1, results' });
  assert.equal(navigationCommand('We created a slide last week.'), undefined);
});
test('named edits target live identities independently of current audience selection', () => {
  const slides = [{ id: 'practice', title: 'Practice' }, { id: 'timebox', title: 'Timebox' }, { id: 'punctuation', title: 'Q3.1, results' }];
  assert.equal(namedInputTarget('On Practice, add the actual phrase.', slides), 'practice');
  assert.equal(namedInputTarget('On the slide "Timebox", change the number.', slides), 'timebox');
  assert.equal(namedInputTarget('On “Q3.1, results”, preserve revenue.', slides), 'punctuation');
  assert.equal(namedInputTarget('On Friday we launched.', slides), undefined);
  assert.throws(() => namedInputTarget('On Missing, add a line.', slides), /does not match/);
  assert.throws(() => namedInputTarget('On Practice, add a line.', [...slides, { id: 'duplicate', title: 'Practice' }]), /ambiguous/);
});
