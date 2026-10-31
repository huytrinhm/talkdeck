import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { BrowserValidationPipeline } from '../src/browser/pipeline.js';
import { BrowserPool } from '../src/browser/pool.js';
import type { RenderArtifact } from '../src/render/types.js';
import { createDeck } from '../src/bootstrap.js';

// Actual licensed bundled bytes, even for deliberately adversarial hand-built DOM fixtures.
const fontPath = new URL('../assets/fonts/NotoSans-Regular.ttf', import.meta.url);
async function fixture(html: string, extraCSS = ''): Promise<RenderArtifact> {
  const bytes = await readFile(fontPath);
  return { source: createDeck().source, slideId:'n10', html:`<section data-node="n10" data-slide-canvas="true" data-display-floor="144">${html}</section>`,
    css:`@font-face{font-family:"Fixture Noto";font-weight:400;font-style:normal;src:url(data:font/ttf;base64,${bytes.toString('base64')}) format('truetype')}[data-slide-canvas]{position:relative;width:1920px;height:1080px;background:white;color:black;font-family:"Fixture Noto"}p{margin:0;font-size:32px;line-height:1.2}[data-content]{position:absolute;left:80px;top:80px;width:800px}${extraCSS}`,
    dependencies:[{kind:'font',id:'fixture-noto',version:'bundled',sha256:'test'}],
    fonts:[{family:'Fixture Noto',weight:400,style:'normal',testText:'ABC abc 0123'}],pendingNodeIds:[],artifactKey:'test' };
}
function pipeline(artifact: RenderArtifact, timeoutMs = 20_000) { return new BrowserValidationPipeline({ async render() { return artifact; } }, {concurrency:1,timeoutMs}); }

test('real Chromium checks clean native text, returns measured evidence and exact JPEG dimensions', async () => {
  const artifact = await fixture('<p data-node="t1" data-content="text" data-role="body">Exact wording.</p>');
  const validator = pipeline(artifact);
  try {
    const report = await validator.check(artifact.source);
    assert.equal(report.complete, true, JSON.stringify(report.findings));
    assert.deepEqual(report.findings, []);
    assert.equal(report.evidence.length, 1);
    const captures = await validator.screenshot(artifact.source,['n10']);
    assert.equal(captures[0].artifactDigest, report.evidence[0].artifactDigest);
    assert.equal(captures[0].sourceDigest, report.evidence[0].sourceDigest);
    const dimensionPool = new BrowserPool({concurrency:1});
    const dimensions = await dimensionPool.withPage(async page => {
      return page.evaluate(async base64 => { const img = new Image(); img.src=`data:image/jpeg;base64,${base64}`; await img.decode(); return [img.width,img.height]; }, Buffer.from(captures[0].jpeg).toString('base64'));
    });
    await dimensionPool.close();
    assert.deepEqual(dimensions,[1920,1080]);
    await mkdir('.artifacts/browser', {recursive:true});
    await writeFile('.artifacts/browser/clean.jpg',captures[0].jpeg);
    await writeFile('.artifacts/browser/clean-evidence.json',JSON.stringify(report,null,2));
  } finally { await validator.close(); }
});

test('real Chromium measures overflow, overlap, wrapped Stats, contrast and effective floors', async () => {
  const artifact = await fixture('<p data-node="t1" data-content="text" data-role="body" style="font-size:20px;color:#eee;width:100px">A complete sentence.</p><p data-node="t2" data-content="text" data-role="body" style="left:90px">Overlaps.</p><p data-node="s1" data-content="stat" data-role="stat" data-stat-value="true" style="top:250px;font-size:112px;width:80px;word-break:break-all">123456789</p><p data-node="t3" data-content="text" data-role="body" style="left:1900px;width:200px">Outside.</p>');
  const validator = pipeline(artifact);
  try {
    const report = await validator.check(artifact.source);
    assert.equal(report.complete,true,JSON.stringify(report.findings));
    for (const check of ['overflow','overlap','stat-wrap','contrast','text-size']) assert.ok(report.findings.some(f=>f.check===check),check);
  } finally { await validator.close(); }
});

test('real Chromium keeps alpha backgrounds, zoom and invisible glyphs in mandatory measurements', async () => {
  const artifact = await fixture('<div data-node="p1" data-surface="true" style="position:absolute;left:40px;top:40px;width:1000px;height:300px;background:rgba(0,0,0,.1)"><p data-node="t1" data-content="text" data-role="body" style="color:rgb(230,230,230);zoom:.6">Almost invisible.</p></div><p data-node="t2" data-content="text" data-role="body" style="top:500px;color:white">Invisible white.</p>');
  const validator=pipeline(artifact);
  try {
    const report=await validator.check(artifact.source);
    assert.equal(report.complete,true,JSON.stringify(report.findings));
    assert.ok(report.findings.some(f=>f.check==='contrast'&&f.nodeId==='t2'));
    assert.ok(report.findings.some(f=>f.check==='text-size'&&f.nodeId==='t1'));
  } finally {await validator.close();}
});

test('real Chromium shape-under uses painted silhouette, not a hollow shape bounding box', async () => {
  const solid=await fixture('<div data-node="d1" data-shape="disc" data-shape-opacity="solid" style="position:absolute;left:50px;top:50px;width:500px;height:200px;background:#ddd;border-radius:50%"></div><p data-node="t1" data-content="text" data-role="body">Shape behind words.</p>');
  const validator=pipeline(solid);
  try {const report=await validator.check(solid.source);assert.equal(report.complete,true,JSON.stringify(report.findings));assert.ok(report.findings.some(f=>f.check==='shape-under'));} finally {await validator.close();}
  const ring=await fixture('<div data-node="d1" data-shape="ring" data-shape-opacity="solid" style="position:absolute;left:50px;top:30px;width:500px;height:250px;border:10px solid #ddd;border-radius:50%"></div><p data-node="t1" data-content="text" data-role="body" style="left:160px;top:120px;width:250px">Inside ring.</p>');
  const other=pipeline(ring);
  try {const report=await other.check(ring.source);assert.equal(report.complete,true,JSON.stringify(report.findings));assert.equal(report.findings.some(f=>f.check==='shape-under'),false);} finally {await other.close();}
});

test('real Chromium refuses missing fonts, undecodable images and a closed browser pool', async () => {
  const clean=await fixture('<p data-node="t1" data-content="text" data-role="body">Words.</p>');
  for (const artifact of [{...clean,fonts:[{...clean.fonts[0],family:'Missing font'}]}, {...clean,html:clean.html.replace('</section>','<img data-node="i1" src="data:image/png;base64,YmFk" alt="bad"></section>')}]) {
    const validator=pipeline(artifact);try {assert.equal((await validator.check(artifact.source)).complete,false);}finally{await validator.close();}
  }
  const closed=pipeline(clean);await closed.close();assert.equal((await closed.check(clean.source)).complete,false);
});

test('real browser isolation disables page scripts and aborts external requests', async () => {
  const pool = new BrowserPool({concurrency:1});
  try {
    await pool.withPage(async (page,_version,requests) => {
      await page.setContent('<script>document.body.dataset.executed="yes"</script><img src="https://example.invalid/forbidden.png">');
      assert.equal(await page.evaluate(()=>document.body.dataset.executed),undefined);
      assert.equal(requests.length,1);
    });
  }finally{await pool.close();}
});

test('real Hono renderer artifacts use the same pinned bytes for validation and capture', async () => {
  const { HonoSlideRenderer } = await import('../src/render/renderer.js');
  const { prepareCandidate } = await import('../src/source/candidate.js');
  const renderer = new HonoSlideRenderer();
  const seeded = createDeck().source;
  const source = prepareCandidate(seeded, seeded.replace('<SpeakerNotes id="n12" />', '<SpeakerNotes id="n12" /><Text role="title">A faithful headline.</Text><Text>Exact substantive words.</Text><Stat value="42%" label="growth" />')).source;
  const validator = new BrowserValidationPipeline(renderer);
  try {
    const normalized = await renderer.normalize(source);
    const report = await validator.check(normalized);
    assert.equal(report.complete,true,JSON.stringify(report.findings));
    assert.deepEqual(report.findings,[]);
    const [capture] = await validator.screenshot(normalized,['n10']);
    assert.equal(capture.artifactDigest,report.evidence[0].artifactDigest);
    await writeFile('.artifacts/browser/hono-slide.jpg',capture.jpeg);
  } finally {await validator.close();}
});

test('real browser pool times out, rejects excess queued work, and releases failed slots', async () => {
  const pool = new BrowserPool({concurrency:1,queueLimit:1,timeoutMs:500});
  let entered!: () => void;
  const running = new Promise<void>(resolve => {entered=resolve;});
  const first = pool.withPage(async page => {entered();await page.evaluate(()=>new Promise(()=>{}));});
  const firstRejected = assert.rejects(first,/timed out/);
  await running;
  const queued = pool.withPage(async page => page.evaluate(()=>42));
  await assert.rejects(pool.withPage(async()=>{}),/queue is full/);
  await firstRejected;
  assert.equal(await queued,42);
  await pool.close();
  const crashed = new BrowserPool({concurrency:1});
  try {
    await assert.rejects(crashed.withPage(async page=>{await page.context().browser()!.close();await page.evaluate(()=>1);}),/closed|Target/);
    assert.equal(await crashed.withPage(async page=>page.evaluate(()=>7)),7);
  } finally {await crashed.close();}
});

test('empty Pending is reported even without native glyphs; screenshots reject oversized calls', async () => {
  const artifact=await fixture('<div data-node="n99" data-pending="true"></div>');
  const validator=pipeline(artifact);
  try {
    const report=await validator.check(artifact.source);
    assert.equal(report.complete,true,JSON.stringify(report.findings));
    assert.deepEqual(report.pendingNodeIds,['n99']);
    await assert.rejects(validator.screenshot(artifact.source,[]),/one to four/);
    await assert.rejects(validator.screenshot(artifact.source,['1','2','3','4','5']),/one to four/);
  } finally {await validator.close();}
});

test('an unresolved renderer or asset resolver cannot hang validation or report success', async () => {
  const validator = new BrowserValidationPipeline({ render: async () => new Promise(() => {}) }, {timeoutMs:25});
  try {
    const report = await validator.check(createDeck().source);
    assert.equal(report.complete,false);
    assert.match(report.findings[0].message,/resolution timed out/);
    await assert.rejects(validator.screenshot(createDeck().source,['n10']),/resolution timed out/);
  }finally{await validator.close();}
});

test('fully off-canvas native text yields actionable overflow, not validation-unavailable', async () => {
  const artifact = await fixture('<p data-node="t1" data-content="text" data-role="body" style="top:1102px">Exact wording must remain visible.</p>');
  const validator = pipeline(artifact);
  try {
    const report = await validator.check(artifact.source);
    assert.equal(report.complete, true, JSON.stringify(report.findings));
    assert(report.findings.some(f => f.check === 'overflow' && f.nodeId === 't1'));
    assert(!report.findings.some(f => f.check === 'validation-unavailable'));
    assert(report.findings.some(f => f.message.includes('contrast cannot be sampled')));
  } finally { await validator.close(); }
});
