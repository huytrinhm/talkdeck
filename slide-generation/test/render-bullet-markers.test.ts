import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeck } from '../src/bootstrap.js';
import { allocateIds } from '../src/source/candidate.js';
import { HonoSlideRenderer } from '../src/render/renderer.js';
import { BrowserValidationPipeline } from '../src/browser/pipeline.js';

function source(content: string) {
  return allocateIds(createDeck().source.replace('<SpeakerNotes id="n12" />', `<SpeakerNotes id="n12"/>${content}`)).source;
}

test('real browser measures numbered, disc and dash marker glyphs with inherited list typography', async () => {
  const renderer = new HonoSlideRenderer(), browser = new BrowserValidationPipeline(renderer, { concurrency: 1 });
  try {
    for (const [marker, glyph] of [['number', '1.'], ['disc', '•'], ['dash', '—']] as const) {
      const document = source(`<Text role="title" transform={{scale:1.2,translate:[0,0]}}>Launch checklist</Text>
        <Panel><Stack><Bullets marker="${marker}" transform={{scale:0.8}}><Text>Monitor</Text><Text>Draft</Text></Bullets></Stack></Panel>`);
      const artifact = await renderer.render(document, 'n10'), checked = await browser.inspect(artifact);
      const markerRuns = checked.measurement.texts.filter(run => run.text === glyph || marker === 'number' && run.text === '2.');
      assert.equal(markerRuns.length, 2, `${marker}: all painted marker glyphs are measured`);
      for (const run of markerRuns) {
        assert.match(run.nodeId, /^b\d+$/); assert.equal(run.role, 'body');
        assert.ok(run.fontPx >= 32 - 0.01); assert.ok(run.backgrounds.length > 0);
      }
      assert.deepEqual(checked.findings, [], `${marker}: ${JSON.stringify(checked.findings)}`);
    }
    const standalone = await browser.inspect(await renderer.render(source('<Bullets><Text>One</Text><Text>Two</Text></Bullets>'), 'n10'));
    assert.ok(standalone.measurement.texts.filter(run => run.text === '•').every(run => run.role === 'lead' && run.fontPx >= 36));
  } finally { await browser.close(); }
});

test('real browser rejects low-contrast marker glyphs even when list item words are readable', async () => {
  const renderer = new HonoSlideRenderer(), browser = new BrowserValidationPipeline(renderer, { concurrency: 1 });
  try {
    const document = source('<Bullets color="accent" marker="number"><Text color="fg">Readable words</Text><Text color="fg">More words</Text></Bullets>')
      .replace('value="#0f766e"', 'value="#eeeeee"');
    const checked = await browser.inspect(await renderer.render(document, 'n10'));
    const markerRuns = checked.measurement.texts.filter(run => run.text === '1.' || run.text === '2.');
    assert.equal(markerRuns.length, 2);
    for (const marker of markerRuns) assert.ok(checked.findings.some(finding => finding.check === 'contrast' && finding.subject === marker.id));
    assert.ok(!checked.findings.some(finding => finding.check === 'contrast' && !markerRuns.some(marker => marker.id === finding.subject)));
  } finally { await browser.close(); }
});
