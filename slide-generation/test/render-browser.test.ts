import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createDeck } from '../src/bootstrap.js';
import { allocateIds } from '../src/source/candidate.js';
import { HonoSlideRenderer } from '../src/render/renderer.js';
import { LUCIDE_VERSION } from '../src/render/icons.js';

test('real Chromium renders fixed canvas, shared fonts, nested Icon colors, floors and definition utilities', async () => {
  const browser=await chromium.launch({headless:true});
  try {
    const initial=createDeck().source.replace('<Library id="n9" />',`<Library id="n9"><Component name="IconCard" description="Icon card"><Panel class="p-xl gap-lg rounded-lg" fill="inverse"><Row align="center"><Icon name="shield-check" catalogVersion="${LUCIDE_VERSION}" alt="Checked"/><Icon name="arrow-right" catalogVersion="${LUCIDE_VERSION}" alt="" color="accent"/><Slot name="words" kind="text"/></Row></Panel></Component></Library>`)
      .replace('<SpeakerNotes id="n12" />', '<SpeakerNotes id="n12"/><Text role="title">Preserve the source</Text><IconCard><Slot name="words"><Text>Exact words. Shared identity.</Text></Slot></IconCard><Stat value="42%" label="reported growth"/><Text id="t80" role="body" transform={{scale:0.6}}>Effective typography stays readable.</Text>');
    const source=allocateIds(initial).source, renderer=new HonoSlideRenderer(), artifact=await renderer.render(source,'n10');
    const context=await browser.newContext({viewport:{width:1920,height:1080},javaScriptEnabled:false});
    const page=await context.newPage();await page.route('**/*',r=>r.abort());
    await page.setContent(`<!doctype html><html><head><style>${artifact.css}</style></head><body>${artifact.html}</body></html>`);
    await page.evaluate(async()=>{await document.fonts.ready;});
    const measured=await page.evaluate(()=>{
      const canvas=document.querySelector('[data-slide-canvas]')!,panel=document.querySelector('[data-surface="inverse"]')!,icons=[...document.querySelectorAll('svg')],text=document.querySelector('[data-node="t80"]')!;
      return {canvas:{width:canvas.getBoundingClientRect().width,height:canvas.getBoundingClientRect().height},font:getComputedStyle(canvas).fontFamily,
        padding:getComputedStyle(panel).paddingTop,gap:getComputedStyle(panel).gap,radius:getComputedStyle(panel).borderRadius,
        parentColor:getComputedStyle(panel).color,iconColors:icons.map(i=>getComputedStyle(i).color),strokes:icons.map(i=>i.getAttribute('stroke-width')),
        fontSize:parseFloat(getComputedStyle(text).fontSize),zoom:parseFloat(getComputedStyle(text).zoom),
        statTextRects:[...document.querySelectorAll('.td-stat [data-content]')].map(el=>{const range=document.createRange();range.selectNodeContents(el);return range.getBoundingClientRect().toJSON();})};
    });
    assert.deepEqual(measured.canvas,{width:1920,height:1080});assert.match(measured.font,/Talkdeck Noto Sans/);
    assert.equal(measured.padding,'96px');assert.equal(measured.gap,'64px');assert.equal(measured.radius,'32px');
    assert.equal(measured.iconColors[0],measured.parentColor);assert.equal(measured.iconColors[1],'rgb(15, 118, 110)');assert.deepEqual(measured.strokes,['2','2']);
    assert.ok(measured.fontSize*measured.zoom>=32);
    assert.ok(measured.statTextRects[0].bottom <= measured.statTextRects[1].top, 'Stat value and label font-metric boxes must not overlap');
    await mkdir('.artifacts/renderer-gallery',{recursive:true});
    await page.screenshot({path:'.artifacts/renderer-gallery/representative.jpg',type:'jpeg',quality:90});
    await writeFile('.artifacts/renderer-gallery/manifest.json',JSON.stringify({artifactKey:artifact.artifactKey,dependencies:artifact.dependencies,measured},null,2));
    await context.close();
  } finally {await browser.close();}
});
