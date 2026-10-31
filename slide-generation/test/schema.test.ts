import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeck } from '../src/bootstrap.js';
import { parseAndValidate, primitiveSchemas } from '../src/schema.js';
import { SourceError } from '../src/contracts.js';
const withContent = (content: string) => createDeck().source.replace('<SpeakerNotes id="n12" />', `<SpeakerNotes id="n12" />${content}`);
const withDefinition = (content: string) => createDeck().source.replace('<Library id="n9" />', `<Library id="n9"><Component name="Card" description="Test">${content}</Component></Library>`);

test('seed and primitive examples validate without character caps', () => {
  parseAndValidate(createDeck().source);
  for (const markup of [
    '<Stack gap="md"><Text>A &amp; B</Text></Stack>', '<Row wrap={true}><Spacer /><Text>Exact words</Text></Row>',
    '<Grid cols={2}><Panel /><Band /></Grid>', '<Split><Center /><Center /></Split>',
    '<Stat value="12345678901234567890.12345" label="an uncapped substantive qualifier" />',
    '<Bullets marker="number"><Text>One</Text><Text>Two</Text></Bullets>', '<Quote by="Mara">Exact quote.</Quote>',
    '<Image asset={{id:"a",version:"v1"}} alt="Figure" />', '<Rule length="bleed" />', '<Badge>Ready</Badge>',
    '<Shape kind="disc" /><Shape kind="ring" />', '<Pending kind="headline" />',
    '<Text role="body" transform={{scale:0.6,translate:[-0.5,0.5]}}> Exact  words\nremain. </Text>',
  ]) assert.doesNotThrow(() => parseAndValidate(withContent(markup)), markup);
  assert.equal(primitiveSchemas.Slot.safeParse({ name: 'a', kind: 'headline', maxChars: 20 }).success, false);
});
for (const markup of [
  '<Grid cols={7}/>', '<Grid cols={1}/>', '<Text role="tiny">A</Text>', '<Text style="color:red">A</Text>',
  '<Text transform={{scale:0.7}}>A</Text>', '<Text transform={{translate:[0.6,0]}}>A</Text>',
  '<Text transform={{rotate:1}}>A</Text>', '<Text build={-1}>A</Text>', '<Text build={0.5}>A</Text>',
  '<Text><Badge>Nested</Badge></Text>', '<Image alt="x" asset={{id:"a",version:"1",url:"x"}} />',
  '<Image alt="x" asset={{id:"a"}} />', '<Stat value="5">Hidden text</Stat>', '<Spacer gap="md"/>',
  '<Split><Text>A</Text></Split>', '<Bullets><Stat value="5"/></Bullets>', '<Panel><Shape kind="ring"/></Panel>',
  '<Panel><Rule length="bleed"/></Panel>', '<Shape kind="disc"/><Shape kind="ring"/><Shape kind="arc"/>',
  '<Text class="flex">A</Text>', '<Item/>', '<Index/>', '<Slot name="x" kind="text"/>', '<Theme/>',
]) test(`strict schema rejects ${markup}`, () => assert.throws(() => parseAndValidate(withContent(markup)), SourceError));

test('class allowlist is definition-only and cannot inject arbitrary CSS or icon strokes', () => {
  parseAndValidate(withDefinition('<Panel class="flex gap-md rounded-lg"><Slot name="title" kind="headline" /></Panel>'));
  for (const utility of ['text-xs', 'bg-red-500', 'text-accent', 'stroke-1', 'stroke-[3]', '[color:red]', 'hover:flex', 'absolute', 'gap-1']) {
    assert.throws(() => parseAndValidate(withDefinition(`<Panel class="${utility}" />`)), /allowed utilities/);
  }
});
test('six visual levels allowed, seventh refused; metadata does not consume visual depth', () => {
  const nested = (n: number) => '<Stack>'.repeat(n) + '<Text>Words</Text>' + '</Stack>'.repeat(n);
  parseAndValidate(withContent(nested(4)));
  assert.throws(() => parseAndValidate(withContent(nested(5))), /depth exceeds six/);
});
test('wrappers, tokens, and evidence cardinality are strict', () => {
  for (const source of [
    createDeck().source.replace('<Archive id="n13" />', ''),
    createDeck().source.replace('<SpeakerNotes id="n12" />', ''),
    createDeck().source.replace('value="#fafafa"', 'value="red"'),
    createDeck().source.replace('name="--color-bg"', 'name="--font-display"'),
    createDeck().source.replace('value="#fafafa"', 'value="#fff; color:red"'),
    withDefinition('<Text>Hard-coded user claim</Text>'),
    withDefinition('<Slot name="title" kind="headline"><Text>Words</Text></Slot>'),
  ]) assert.throws(() => parseAndValidate(source), SourceError);
  const source = withContent('<Text id="t99" bad={true}>words</Text>');
  assert.throws(() => parseAndValidate(source), (e: unknown) => e instanceof SourceError && e.nodeId === 't99' && e.span?.start === source.indexOf('<Text'));
});
test('dedicated Icon has strict props, fixed strokes, and mandatory exact catalog resolution', () => {
  const icon = '<Icon name="arrow-right" catalogVersion="test-v1" alt="" />';
  assert.throws(() => parseAndValidate(withContent(icon)), /catalog is not installed/);
  const resolveIcon = (name: string, version: string) => {
    if (name !== 'arrow-right' || version !== 'test-v1') throw new Error('Unknown pinned icon');
  };
  parseAndValidate(withContent(icon), { resolveIcon });
  for (const extra of ['stroke="red"', 'strokeWidth={3}', 'fill="red"', 'width={40}', 'path="x"'])
    assert.throws(() => parseAndValidate(withContent(icon.replace('/>', `${extra}/>`)), { resolveIcon }));
  assert.throws(() => parseAndValidate(withContent(icon.replace('arrow-right', 'invented')), { resolveIcon }), /Unknown pinned/);
  assert.throws(() => parseAndValidate(withContent(icon.replace('test-v1', 'latest')), { resolveIcon }), /Unknown pinned/);
  assert.throws(() => parseAndValidate(withContent(icon.replace('/>', '>Words</Icon>')), { resolveIcon }), /children/);
});
