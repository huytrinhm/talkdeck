import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeck } from '../src/bootstrap.js';
import { nodeById, parseSource } from '../src/parser.js';

test('bootstrap parses and typed object/array props remain literal data', () => {
  const root = parseSource(createDeck().source);
  assert.equal(nodeById(root, 'n10').tag, 'Slide');
  const node = nodeById(parseSource('<Deck id="n1"><Text id="t2" transform={{ scale: 0.8, translate: [-0.5, 0.5] }}>A &amp; B</Text></Deck>'), 't2');
  assert.deepEqual(JSON.parse(JSON.stringify(node.props.transform)), { scale: 0.8, translate: [-0.5, 0.5] });
  assert.equal(node.children[0], 'A & B');
});

for (const markup of [
  '<Text>{run()}</Text>', '<Text value={process.env.SECRET} />', '<Text {...props} />',
  '<Text value={() => 1} />', '<Text value={{ ...other }} />', '<Text value={{ [key]: 1 }} />',
  '<Text value={{ shorthand }} />', '<Text value={{ get x() { return 1 } }} />',
  '<Text value={{ __proto__: {} }} />', '<Text value={{ a: 1, a: 2 }} />',
  '<Text value={[,1]} />', '<Text value={null} />', '<Text value={1 + 2} />',
  '<Text value={1e999} />', '<Text value={-1e999} />', '<Text value={`template`} />',
  '<><Text /></>', '<Text color="a" color="b" />', '<Text enabled />',
  '<Unknown />', '<Text>&madeup;</Text>', '<Text>&#0;</Text>', '<Text>&#xD800;</Text>',
  '<Text>A & B</Text>', '<Text>{/* comment */}</Text>',
]) test(`rejects unsafe or invalid JSX: ${markup}`, () => {
  assert.throws(() => parseSource(`<Deck id="n1">${markup}</Deck>`));
});

test('duplicate IDs across definitions and slides are rejected', () => {
  assert.throws(() => parseSource('<Deck id="n1"><Library id="n2"><Component id="n3" name="Card"><Panel id="p1" /></Component></Library><Slide id="n4"><Text id="p1">A</Text></Slide></Deck>'), /Duplicate ID/);
});
test('custom tags must resolve to uniquely named definitions', () => {
  assert.doesNotThrow(() => parseSource('<Deck id="n1"><Library id="n2"><Component id="c1" name="Card"><Panel id="p1" /></Component></Library><Slide id="n3"><Card id="c2" /></Slide></Deck>'));
  assert.throws(() => parseSource('<Deck id="n1"><Component name="Text"><Panel /></Component></Deck>'), /definition name/);
});
test('only one JSX root is accepted', () => {
  assert.throws(() => parseSource('<Deck id="n1" />; run()'));
  assert.throws(() => parseSource('<Slide id="n1" />'));
});
