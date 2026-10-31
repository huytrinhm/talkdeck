import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationCommand, namedInputTarget, requestedTitle, routingTitles } from '../src/headless/input-routing.js';

test('spoken navigation preserves quoted punctuation and decimal titles', () => {
  assert.deepEqual(navigationCommand('New slide titled “Q3.1, results”. Revenue rose.'), { type: 'new', title: 'Q3.1, results' });
  assert.deepEqual(navigationCommand('Create a slide titled Q3.1 review. Show revenue.'), { type: 'new', title: 'Q3.1 review' });
  assert.deepEqual(navigationCommand('Return to "Q3.1, results". Keep values.'), { type: 'select', title: 'Q3.1, results' });
  assert.equal(navigationCommand('We created a slide last week.'), undefined);
});

test('an explicit retained rename supplies stable routing without pretending the title is visible', () => {
  const slides = [{ id: 'checklist', title: 'Launch checklist' }, { id: 'owners', title: 'Owners' }];
  const title = requestedTitle('Go back to Launch checklist. Change its title to Release checklist.');
  assert.equal(title, 'Release checklist');
  const routeNames = routingTitles(slides, new Map([['checklist', title!]]));
  assert.equal(namedInputTarget('On Release checklist, reveal the first two items.', routeNames), 'checklist');
  assert.equal(slides[0].title, 'Launch checklist');
  assert.equal(requestedTitle('Return to "Q3.1, results". Change its title to "Q4.1, results".'), 'Q4.1, results');
  assert.equal(requestedTitle('Add this caption: Change its title to Trouble.'), undefined);
  assert.equal(requestedTitle('Say “Change its title to Trouble.”'), undefined);
  assert.throws(() => namedInputTarget('On Release checklist, add a line.', routingTitles([...slides,
    { id: 'other', title: 'Release checklist' }], new Map([['checklist', title!]]))), /ambiguous/);
  assert.equal(routingTitles([{ id: 'owners', title: 'Owners' }], new Map([['checklist', title!]])).length, 1);
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


test('comma-delimited narration and quoted examples never become named editing commands', () => {
  const slides = [{ id: 'practice', title: 'Practice' }];
  for (const text of ['On Friday, we launched the product.', 'On Practice, we discussed the launch.',
    'On Friday, “Change its title to Trouble.” was the example.',
    'On Practice, "Change its title to Trouble."', "On 'Friday, change its title to Trouble.', we read a quotation.", 'On "Friday, change its title to Trouble.", we read a quotation.',
    'Say “On Practice, change its title to Trouble.”']) {
    assert.equal(namedInputTarget(text, slides), undefined, text);
    assert.equal(requestedTitle(text, slides), undefined, text);
  }
  assert.throws(() => namedInputTarget('On Missing, add a line.', slides), /does not match/);
  assert.throws(() => namedInputTarget('On Missing, do not change any wording.', slides), /does not match/);
  assert.equal(namedInputTarget('On Practice, please keep the exact qualifier.', slides), 'practice');
});

test('named rename requests use verified slide titles and reject ambiguity without reading quoted commands', () => {
  const slides = [{ id: 'checklist', title: 'Launch checklist' }, { id: 'other', title: 'Q3.1, results' }];
  assert.equal(requestedTitle('On Launch checklist, change its title to Release checklist.', slides), 'Release checklist');
  assert.equal(requestedTitle('On the slide “Q3.1, results”, change its title to "Q4.1, results".', slides), 'Q4.1, results');
  const names = routingTitles(slides, new Map([['checklist', requestedTitle('On Launch checklist, change its title to Release checklist.', slides)!]]));
  assert.equal(namedInputTarget('On Release checklist, add a line.', names), 'checklist');
  assert.equal(requestedTitle('On Launch checklist, add the caption “Change its title to Trouble.”', slides), undefined);
  assert.throws(() => requestedTitle('On Missing, change its title to Trouble.', slides), /does not match/);
  assert.throws(() => requestedTitle('On Launch checklist, change its title to Trouble.', [...slides,
    { id: 'duplicate', title: 'Launch checklist' }]), /ambiguous/);
});
