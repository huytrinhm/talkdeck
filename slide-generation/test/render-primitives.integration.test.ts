import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDeck } from '../src/bootstrap.js';
import { allocateIds } from '../src/source/candidate.js';
import { HonoSlideRenderer } from '../src/render/renderer.js';
import { BrowserValidationPipeline } from '../src/browser/pipeline.js';
import { nodes, parseSource } from '../src/parser.js';
import { ready } from '../src/validation.js';

const gallery = '.artifacts/renderer-primitive-gallery';
function deck(content: string, library = '') {
  return allocateIds(createDeck().source
    .replace('</Theme>', '<Frame id="n1000" labels={{left:"WORKSHOP",right:"Q3",footer:"CONFIDENTIAL"}} rule={true} page={true}/></Theme>')
    .replace('<Library id="n9" />', `<Library id="n9">${library}</Library>`)
    .replace('<SpeakerNotes id="n12" />', `<SpeakerNotes id="n12">PRIVATE NOTES MUST NOT RENDER</SpeakerNotes>${content}`)).source;
}

test('real primitive gallery validates generated frame labels/pages, Stat labels, Quote bylines, badges and inline glyphs', async () => {
  const source = deck(`<Text role="title">Native text gallery</Text>
    <Grid cols={2}><Panel><Stat value="42.0%" label="active accounts, preliminary"/></Panel>
      <Panel fill="inverse"><Quote by="Mara Chen">Keep the qualifier.</Quote></Panel></Grid>
    <Row align="center"><Badge fill="inverse">DRAFT</Badge><Text>**Bold** *Italic* \`Code\` remain native.</Text></Row>`);
  const renderer = new HonoSlideRenderer(), browser = new BrowserValidationPipeline(renderer, { concurrency: 1 });
  try {
    const artifact = await renderer.render(source, 'n10'), checked = await browser.inspect(artifact);
    assert.deepEqual(checked.findings, [], JSON.stringify(checked.findings));
    const runs = checked.measurement.texts;
    for (const [text, role] of [['Native text gallery', 'title'], ['42.0%', 'stat'], ['active accounts, preliminary', 'caption'],
      ['Keep the qualifier.', 'quote'], ['Mara Chen', 'caption'], ['DRAFT', 'label'], ['Bold', 'body'], ['Italic', 'body'], ['Code', 'body'],
      ['WORKSHOP', 'label'], ['Q3', 'label'], ['CONFIDENTIAL', 'label'], ['1', 'label']]) {
      const run = runs.find(run => run.text === text);
      assert.ok(run, `Visible native glyphs missing from measurement: ${text}`); assert.equal(run.role, role);
      assert.ok(run.rects.length > 0 && run.backgrounds.length > 0 && run.nodeId.length > 0);
      if (['WORKSHOP', 'Q3', 'CONFIDENTIAL', '1'].includes(text)) assert.equal(run.nodeId, 'n1000', 'Frame diagnostics identify authored metadata');
    }
    assert.ok(!runs.some(run => run.text.includes('PRIVATE NOTES')));
    const report = await browser.check(source);
    assert.equal(report.complete, true); assert.deepEqual(report.findings, []); assert.deepEqual(report.pendingNodeIds, []); assert.equal(ready(report), true);
    await mkdir(gallery, { recursive: true });
    await writeFile(`${gallery}/native-text.jsx`, source);
    await writeFile(`${gallery}/native-text-report.json`, JSON.stringify({ report, measurement: checked.measurement, dependencies: artifact.dependencies }, null, 2));
    await writeFile(`${gallery}/native-text.jpg`, (await browser.screenshot(source, ['n10']))[0].jpeg);
  } finally { await browser.close(); }
});

test('real expanded gallery validates generated Index glyphs and Pending labels while keeping unresolved content unready', async () => {
  const library = '<Component name="IndexedItems" description="Indexed items"><Stack><Each slot="items" kind="text" min={1}><Row align="center"><Index size="body" look="pill"/><Item/></Row></Each><Slot name="summary" kind="text"/></Stack></Component>';
  const source = deck('<Text role="title">Generated content gallery</Text><IndexedItems><Slot name="items"><Text>First exact item</Text></Slot><Slot name="items"><Text>Second exact item</Text></Slot></IndexedItems><Pending kind="image"/>', library);
  const renderer = new HonoSlideRenderer(), browser = new BrowserValidationPipeline(renderer, { concurrency: 1 });
  try {
    const artifact = await renderer.render(source, 'n10'), checked = await browser.inspect(artifact);
    assert.deepEqual(checked.findings, [], JSON.stringify(checked.findings));
    const instance = [...nodes(parseSource(source))].find(node => node.tag === 'IndexedItems')!;
    const indices = checked.measurement.texts.filter(run => run.nodeId === instance.id && /^\d+$/.test(run.text));
    assert.deepEqual(indices.map(run => run.text), ['1', '2']); assert.ok(indices.every(run => run.role === 'body' && run.fontPx >= 32));
    const placeholders = checked.measurement.texts.filter(run => run.text.startsWith('Pending:'));
    assert.deepEqual(placeholders.map(run => run.text).sort(), ['Pending: image', 'Pending: text']);
    assert.ok(placeholders.every(run => run.role === 'body' && run.fontPx >= 32 && run.rects.length > 0));
    const report = await browser.check(source);
    assert.equal(report.complete, true); assert.deepEqual(report.findings, []);
    assert.equal(report.pendingNodeIds.length, 2, 'Complete measurement must still retain both unresolved presentation blockers');
    assert.equal(ready(report), false);
    await mkdir(gallery, { recursive: true });
    await writeFile(`${gallery}/expanded-text.jsx`, source);
    await writeFile(`${gallery}/expanded-text-report.json`, JSON.stringify({ report, measurement: checked.measurement, dependencies: artifact.dependencies }, null, 2));
    await writeFile(`${gallery}/expanded-text.jpg`, (await browser.screenshot(source, ['n10']))[0].jpeg);
  } finally { await browser.close(); }
});
