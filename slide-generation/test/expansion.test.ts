import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeck } from '../src/bootstrap.js';
import { allocateIds } from '../src/source/candidate.js';
import { expandSource, type ExpandedNode } from '../src/expansion.js';
import { nodeById, parseSource } from '../src/parser.js';

function deck(library: string, content: string) {
  return allocateIds(createDeck().source.replace('<Library id="n9" />', `<Library id="n9">${library}</Library>`)
    .replace('<SpeakerNotes id="n12" />', `<SpeakerNotes id="n12" />${content}`)).source;
}
function all(root: ExpandedNode): ExpandedNode[] { return [root, ...root.children.flatMap(c => typeof c === 'string' ? [] : all(c))]; }
const layout = '<Layout name="Headline" description="Headline"><Slide fill="accent" frame={false}><Slot name="heading" kind="headline" /></Slide></Layout>';
const instance = '<Headline><Slot name="heading"><Text id="t80" role="caption">Exact substantive words.</Text></Slot></Headline>';
test('layout ground replaces slide style, slots retain identity and normalize stored typography idempotently', () => {
  const source = deck(layout, instance), result = expandSource(source);
  assert.equal(result.slides[0].id, 'n10');
  assert.equal(result.slides[0].props.fill, 'accent');
  assert.equal(result.slides[0].props.frame, false);
  const text = all(result.slides[0]).find(n => n.id === 't80')!;
  assert.equal(text.props.role, 'title');
  assert.equal(text.children[0], 'Exact substantive words.');
  assert.equal(nodeById(parseSource(result.source), 't80').props.role, 'title');
  assert.equal(expandSource(result.source).source, result.source);
  assert.deepEqual(result.library[0].dependentSlides, ['n10']);
});
test('missing required slots create deterministic Pending; optional absence is empty', () => {
  const source = deck(layout, '<Headline/>');
  const first = expandSource(source), second = expandSource(source);
  assert.equal(first.pendingNodeIds.length, 1);
  assert.deepEqual(first.pendingNodeIds, second.pendingNodeIds);
  const optional = deck(layout.replace('kind="headline"', 'kind="headline" optional={true}'), '<Headline/>');
  assert.equal(expandSource(optional).pendingNodeIds.length, 0);
});
test('Each identities follow item IDs through reordering and Index changes without replacing user content', () => {
  const library = '<Layout name="List" description="List"><Slide><Each slot="points" kind="text" min={2} max={3}><Row><Index/><Item/></Row></Each></Slide></Layout>';
  const a = '<Slot name="points"><Text id="t80">A</Text></Slot>', b = '<Slot name="points"><Text id="t81">B</Text></Slot>';
  const source = deck(library, `<List>${a}${b}</List>`), first = expandSource(source);
  const firstSource = parseSource(source);
  const bindings = [...(function* walk(n: any): Generator<any> { yield n; for (const c of n.children) if (typeof c !== 'string') yield* walk(c); })(firstSource)].filter(n => n.tag === 'Slot');
  const aNode = bindings.find(n => n.children.some((c: any) => typeof c !== 'string' && c.id === 't80'))!;
  const bNode = bindings.find(n => n.children.some((c: any) => typeof c !== 'string' && c.id === 't81'))!;
  const aSource = source.slice(aNode.start, aNode.end), bSource = source.slice(bNode.start, bNode.end);
  const reordered = source.slice(0, aNode.start) + bSource + aSource + source.slice(bNode.end);
  const second = expandSource(reordered);
  const rows = (r: typeof first) => all(r.slides[0]).filter(n => n.tag === 'Row');
  assert.equal(rows(first)[0].id, rows(second)[1].id);
  assert.equal(rows(first)[1].id, rows(second)[0].id);
  assert.deepEqual(all(second.slides[0]).filter(n => n.tag === 'Text').map(n => n.id), ['t81', 't80']);
  assert.deepEqual(all(second.slides[0]).filter(n => n.tag === 'Index').map(n => n.props.value), [1, 2]);
  assert.equal(expandSource(deck(library, '<List/>')).pendingNodeIds.length, 2);
  assert.throws(() => expandSource(deck(library, `<List>${a}${b}<Slot name="points"><Text>C</Text></Slot><Slot name="points"><Text>D</Text></Slot></List>`)), /at most 3/);
});
test('nested components propagate slot styles and transitive dependent slides', () => {
  const library = '<Component name="Card" description="Card"><Panel><Slot name="body" kind="text" role="heading" /></Panel></Component>' +
    '<Layout name="Cards" description="Cards"><Slide><Card><Slot name="body"><Slot name="title" kind="text" /></Slot></Card></Slide></Layout>';
  const result = expandSource(deck(library, '<Cards build={2}><Slot name="title"><Text id="t80">A</Text></Slot></Cards>'));
  assert.equal(nodeById(parseSource(result.source), 't80').props.role, 'heading');
  assert.ok(result.library.every(e => e.dependentSlides.includes('n10')));
  assert.equal(result.slides[0].props.build, 2);
  assert.ok(all(result.slides[0]).filter(n => n.tag === 'Panel').every(n => n.id.startsWith('@')));
});
test('wrong slots/types, cycles and equivalent slot shapes refuse', () => {
  assert.throws(() => expandSource(deck(layout, '<Headline><Slot name="wrong"><Text>A</Text></Slot></Headline>')), /Unknown slot/);
  assert.throws(() => expandSource(deck(layout, '<Headline><Slot name="heading"><Stat value="1"/></Slot></Headline>')), /expects Text/);
  assert.throws(() => expandSource(deck(layout + layout.replace('Headline', 'Other').replace('heading', 'different'), instance)), /Equivalent layout/);
  assert.throws(() => expandSource(deck('<Component name="Cycle" description="Cycle"><Cycle/></Component>', '<Cycle/>')), /cycle/);
  assert.throws(() => expandSource(deck('<Component name="A" description="A"><B/></Component><Component name="B" description="B"><A/></Component>', '<A/>')), /cycle/);
});
test('expanded depth is checked independently of authored depth and nesting', () => {
  const library = '<Component name="Deep" description="Deep"><Stack><Stack><Stack><Stack><Slot name="x" kind="text"/></Stack></Stack></Stack></Stack></Component>';
  assert.throws(() => expandSource(deck(library, '<Panel><Deep><Slot name="x"><Text>A</Text></Slot></Deep></Panel>')), /Expanded visual depth/);
});

test('unused definitions cannot conceal excessive expanded depth through empty optional bindings', () => {
  const library = '<Component name="Inner" description="Inner"><Stack><Stack><Stack><Stack><Slot name="x" kind="text" optional={true}/></Stack></Stack></Stack></Stack></Component>' +
    '<Component name="Outer" description="Outer"><Panel><Panel><Inner><Slot name="x"><Slot name="title" kind="text" optional={true}/></Slot></Inner></Panel></Panel></Component>';
  assert.throws(() => expandSource(deck(library, '<Text>Unrelated slide</Text>')), /Expanded visual depth/);
});
test('unused repeated wrappers are checked even when minimum item count is zero', () => {
  const library = '<Component name="Deep" description="Deep"><Stack><Stack><Stack><Stack><Slot name="body" kind="text"/></Stack></Stack></Stack></Stack></Component>' +
    '<Component name="Repeated" description="Repeated"><Stack><Each slot="items" kind="text" min={0}><Panel><Deep><Slot name="body"><Item/></Slot></Deep></Panel></Each></Stack></Component>';
  assert.throws(() => expandSource(deck(library, '<Text>Unrelated</Text>')), /Expanded visual depth/);
});

test('authored Pending and missing-slot Pending both remain visible to readiness', () => {
  const result = expandSource(deck('', '<Pending kind="image"/>'));
  assert.equal(result.pendingNodeIds.length, 1);
  assert.ok(all(result.slides[0]).some(n => n.tag === 'Pending' && result.pendingNodeIds.includes(n.id)));
});
