import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeck } from '../src/bootstrap.js';
import { nodes, parseSource, nodeById, textContent } from '../src/parser.js';
import { prepareCandidate, allocateIds, advanceVersions } from '../src/source/candidate.js';
import { ingestCandidate } from '../src/source/ingestion.js';
import { parseAndValidate } from '../src/schema.js';

const input = { id: 'u1', slideId: 'n10', text: '  $12.4 million & {exact}\r\n"quoted" 😀  ', deliveredAtMs: 123 };
const source = createDeck().source;
test('allocation preserves formatting, words and monotonic high-water mark after deletion/reload', () => {
  const candidate = source.replace('<SpeakerNotes id="n12" />', '<SpeakerNotes id="n12" />\n<Text>  α &amp; β  </Text>');
  const allocated = prepareCandidate(source, candidate);
  assert.deepEqual(allocated.assigned, ['t14']);
  assert.match(allocated.source, /<Text id="t14">  α &amp; β  <\/Text>/);
  assert.equal(parseSource(allocated.source).props.nextId, 15);
  const deleted = allocated.source.replace('\n<Text id="t14">  α &amp; β  </Text>', '');
  const next = prepareCandidate(allocated.source, deleted).source;
  const later = prepareCandidate(next, next.replace('<SpeakerNotes id="n12" />', '<SpeakerNotes id="n12" /><Text>New</Text>'));
  assert.deepEqual(later.assigned, ['t15']);
  assert.equal(allocateIds(later.source).source, later.source);
  parseAndValidate(later.source);
});
test('ingestion retains exact originals, initializes notes, is idempotent and records corrections', () => {
  const first = ingestCandidate(source, input);
  parseAndValidate(first.source);
  assert.equal(textContent(nodeById(parseSource(first.source), first.assigned[0])), input.text);
  assert.equal(textContent(nodeById(parseSource(first.source), 'n12')), input.text);
  assert.equal(ingestCandidate(first.source, input).source, first.source);
  assert.throws(() => ingestCandidate(first.source, { ...input, text: 'different' }), /different data/);
  assert.throws(() => ingestCandidate(first.source, { ...input, id: 'u2', correctionOf: 'missing' }), /unknown utterance/);
  const corrected = ingestCandidate(first.source, { ...input, id: 'u2', text: 'Correction: $12.7 million.', correctionOf: 'u1', deliveredAtMs: 150 });
  const prompts = [...nodes(parseSource(corrected.source))].filter(n => n.tag === 'Prompt');
  assert.equal(prompts.length, 2);
  assert.equal(textContent(prompts[0]), input.text);
  assert.equal(textContent(prompts[1]), 'Correction: $12.7 million.');
  assert.equal(prompts[1].props.correctionOf, 'u1');
  assert.equal(parseSource(corrected.source).props.version, 3);
});
test('deleting a slide archives its exact evidence once with original IDs and slide association', () => {
  const first = ingestCandidate(source, input).source;
  const added = prepareCandidate(first, first.replace('<Archive id="n13" />', '<Slide freeForm={{reason:"Second"}}><Transcript/><SpeakerNotes/></Slide><Archive id="n13" />')).source;
  const oldSlide = nodeById(parseSource(added), 'n10');
  const deleted = prepareCandidate(added, added.slice(0, oldSlide.start) + added.slice(oldSlide.end)).source;
  const root = parseAndValidate(deleted);
  assert.equal([...nodes(root)].filter(n => n.tag === 'ArchivedSlide').length, 1);
  const archived = [...nodes(root)].find(n => n.tag === 'ArchivedSlide')!;
  assert.equal(archived.props.slideId, 'n10');
  assert.equal(textContent(nodeById(root, 'n12')), input.text);
  assert.equal(textContent(nodeById(root, 'n11')), input.text);
  assert.equal(prepareCandidate(deleted, deleted).source, deleted);
  assert.equal(ingestCandidate(deleted, input).duplicate, true);
});
test('raw evidence cannot be forged, erased, moved or retagged by agent candidates', () => {
  const retained = ingestCandidate(source, input).source;
  const root = parseSource(retained), prompt = [...nodes(root)].find(n => n.tag === 'Prompt')!;
  const transcript = nodeById(root, 'n11');
  for (const changed of [
    retained.replace(`utteranceId="u1"`, 'utteranceId="forged"'),
    retained.slice(0, prompt.start) + retained.slice(prompt.end),
    retained.slice(0, transcript.start) + '<Transcript />' + retained.slice(transcript.end),
    retained.replace('<Brief id="n2" />', '<Brief id="forged" />'),
    retained.replace('<Brief id="n2" />', '<Text id="n2" />'),
    retained.replace('<Library id="n9" />', '<Library id="n9"><Prompt>Forged</Prompt></Library>'),
    retained.replace('<Archive id="n13" />', '<Archive id="n13"><ArchivedSlide slideId="fake" /></Archive>'),
    retained.replace('nextId={15}', 'nextId={1}'),
    retained.replace('<SpeakerNotes', '<SpeakerNotes provenance="fake"'),
  ]) assert.throws(() => prepareCandidate(retained, changed));
  assert.equal(textContent(nodeById(parseSource(retained), 'n11')), input.text);
});
test('versioning is separate, no-op stable and includes explicitly dependent slides', () => {
  const committed = allocateIds(source).source;
  assert.equal(advanceVersions(committed, committed), committed);
  const changed = committed.replace('<Brief id="n2" />', '<Brief id="n2">New brief</Brief>');
  const versioned = advanceVersions(committed, changed, new Set(['n10']));
  assert.equal(parseSource(versioned).props.version, 2);
  assert.equal(nodeById(parseSource(versioned), 'n10').props.version, 2);
});
