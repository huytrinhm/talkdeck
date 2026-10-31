import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { chromium, type Browser, type Page, type Frame } from 'playwright';
import { HonoSlideRenderer } from '../src/render/renderer.js';
import { createDeck } from '../src/bootstrap.js';
import { allocateIds } from '../src/source/candidate.js';
import { createViewerDocument } from '../src/viewer/document.js';
import { publicationSchema, acknowledgmentSchema, DEFAULT_MOTION, fitCanvas, mayPresent, nextBuild, visibleAtBuild, type PublicationMessage } from '../src/viewer/protocol.js';

const channel = 'viewer_test_channel_12345678';
const css = 'html,body{margin:0} [data-node="slide"]{position:relative;width:1920px;height:1080px;background:#fff;color:#111;font:48px Arial} .box{position:absolute;left:100px;top:100px;width:200px;height:100px;background:rgb(0,128,128);color:white}';
let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });
function message(sequence: number, html: string, extra: Partial<PublicationMessage> = {}): PublicationMessage {
  return publicationSchema.parse({ version: 1, channel, type: 'publish', sequence, publicationId: `p${sequence}`, revision: `r${sequence}`,
    slideId: 'slide', html, css, mode: 'editor', readiness: { revision: `r${sequence}`, ready: true },
    motion: { ...DEFAULT_MOTION, durationMs: 0 }, build: 0, holdIds: [], ...extra });
}
async function harness(options: { video?: string } = {}) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ...(options.video ? { recordVideo: { dir: options.video, size: { width: 1920, height: 1080 } } } : {}) });
  const page = await context.newPage(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<style>html,body{margin:0;width:100%;height:100%}iframe{border:0;width:100%;height:100%}</style><iframe sandbox="allow-scripts"></iframe>');
  await page.evaluate(({ source, channel }) => {
    (window as any).acks = [];
    addEventListener('message', event => { if (event.source === document.querySelector('iframe')!.contentWindow && event.data.channel === channel) (window as any).acks.push(event.data); });
    document.querySelector('iframe')!.srcdoc = source;
  }, { source: createViewerDocument(channel), channel });
  await page.waitForFunction(() => (window as any).acks.some((a: any) => a.type === 'ready'));
  const frame = page.frames().find(f => f.parentFrame() === page.mainFrame())!;
  return { page, frame, errors, close: () => context.close() };
}
async function send(page: Page, data: unknown) { await page.evaluate(data => document.querySelector('iframe')!.contentWindow!.postMessage(data, '*'), data); }
async function ack(page: Page, type: string, sequence?: number) {
  await page.waitForFunction(({ type, sequence }) => (window as any).acks.some((a: any) => a.type === type && (sequence === undefined || a.sequence === sequence)), { type, sequence });
  const result = await page.evaluate(({ type, sequence }) => (window as any).acks.findLast((a: any) => a.type === type && (sequence === undefined || a.sequence === sequence)), { type, sequence });
  return acknowledgmentSchema.parse(result);
}
const slide = (inner: string) => `<div data-node="slide">${inner}</div>`;
async function geometry(frame: Frame, id: string) {
  return frame.locator(`[data-node="${id}"]`).evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, opacity: Number(getComputedStyle(el).opacity), visibility: getComputedStyle(el).visibility, text: el.textContent }; });
}

test('viewer protocol is strict; same-revision presentation proof, build and canvas semantics', () => {
  assert.deepEqual(fitCanvas(960, 600), { scale: 0.5, left: 0, top: 30 });
  assert.equal(visibleAtBuild([1, 3], 2), false);
  assert.equal(nextBuild([0, 3, 1, 3, 7], 1), 3);
  const valid = message(1, slide(''));
  assert.equal(mayPresent({ ...valid, mode: 'presentation', readiness: { ready: true, revision: 'old' } }), false);
  assert.equal(publicationSchema.safeParse({ ...valid, untrusted: true }).success, false);
  assert.throws(() => createViewerDocument('predictable'));
  assert.throws(() => createViewerDocument(channel, '" onclick="bad'));
});

test('real sandbox displays fixed canvas and enforces reserved geometry for nested builds', async () => {
  const h = await harness();
  try {
    await send(h.page, message(1, slide('<div data-node="parent" data-build="2" class="box"><span data-node="child" data-content="text" data-build="1">Held words</span></div><div data-node="peer" data-content="text" class="box" style="top:300px">Peer</div>'), { mode: 'presentation' }));
    const settled = await ack(h.page, 'settled', 1);
    assert.equal(settled.domEquivalent, true, await h.frame.locator('#stage').innerHTML());
    const before = await geometry(h.frame, 'child');
    assert.equal(before.visibility, 'hidden');
    assert.ok(before.width > 0);
    assert.equal((await ack(h.page, 'painted', 1)).visibleNodeIds?.includes('child'), false);
    await send(h.page, { version: 1, channel, type: 'build', sequence: 2, revision: 'r1', build: 2, holdIds: [] });
    await ack(h.page, 'painted', 2);
    assert.equal((await ack(h.page, 'applied', 2)).build, 2);
    assert.equal((await ack(h.page, 'settled', 2)).domEquivalent, true);
    const after = await geometry(h.frame, 'child');
    assert.equal(after.visibility, 'visible');
    assert.deepEqual({ ...after, visibility: 'hidden' }, before);
    await send(h.page, { version: 1, channel, type: 'build', sequence: 3, revision: 'r1', build: 0, holdIds: [] });
    await ack(h.page, 'painted', 3);
    assert.equal((await geometry(h.frame, 'child')).visibility, 'hidden');
    await h.page.setViewportSize({ width: 960, height: 540 });
    await h.page.waitForTimeout(50);
    assert.equal(Math.round((await h.frame.locator('#viewport').boundingBox())!.width), 960);
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

test('malformed, wrong-channel, wrong-sender, unsafe HTML and unready presentation cannot replace a visible revision', async () => {
  const h = await harness();
  try {
    await send(h.page, message(1, slide('<div data-node="words" data-content="text">Original</div>'))); await ack(h.page, 'settled', 1);
    const hostile = message(2, slide('<div data-node="words">Wrong</div>'));
    await send(h.page, { ...hostile, channel: 'another_channel_12345678' });
    await send(h.page, { ...hostile, motion: { durationMs: -1, stiffness: 200, damping: 20 } });
    await h.frame.evaluate(data => window.postMessage(data, '*'), hostile);
    await h.page.waitForTimeout(50);
    assert.equal(await h.frame.locator('[data-node="words"]').textContent(), 'Original');
    await send(h.page, { ...hostile, mode: 'presentation', readiness: { ready: true, revision: 'wrong' } });
    assert.equal((await ack(h.page, 'refused', 2)).code, 'presentation_not_ready');
    await send(h.page, message(3, slide('<script>parent.hacked=true</script>')));
    assert.equal((await ack(h.page, 'refused', 3)).code, 'active_html');
    await send(h.page, message(4, slide('<img src="https://example.invalid/image.png">')));
    assert.equal((await ack(h.page, 'refused', 4)).code, 'external_asset');
    assert.equal(await h.frame.locator('[data-node="words"]').textContent(), 'Original');
    assert.equal(await h.frame.evaluate(() => { try { return parent.document.body.textContent; } catch { return 'opaque'; } }), 'opaque');
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

test('actual movement/resize/color interruption retargets and settles to exact DOM with no exit identities', async () => {
  const h = await harness();
  try {
    await send(h.page, message(1, slide('<div data-node="a" data-content="text" class="box">A</div><div data-node="b" class="box" style="top:400px">Exit</div>'))); await ack(h.page, 'settled', 1);
    await send(h.page, message(2, slide('<div data-node="a" data-content="text" class="box" style="left:800px;width:500px;background:rgb(255,100,0)">A</div>'), { motion: { ...DEFAULT_MOTION, durationMs: 400 } }));
    await ack(h.page, 'applied', 2); await h.page.waitForTimeout(90);
    const moving = await geometry(h.frame, 'a');
    assert.ok(moving.x > 100 && moving.x < 800, JSON.stringify(moving));
    assert.ok(moving.width >= 200 && moving.width <= 500, JSON.stringify(moving));
    await send(h.page, message(3, slide('<section data-node="new-parent" style="position:absolute;left:1000px;top:200px"><div data-node="a" data-content="text" class="box" style="position:relative;left:0;top:0;width:350px;background:rgb(50,100,255)">A</div></section>'), { motion: { ...DEFAULT_MOTION, durationMs: 300 } }));
    await ack(h.page, 'applied', 3);
    const retargeted = await geometry(h.frame, 'a');
    assert.ok(retargeted.width >= 0);
    const settled = await ack(h.page, 'settled', 3);
    assert.equal(settled.domEquivalent, true, await h.frame.locator('#stage').innerHTML());
    const final = await geometry(h.frame, 'a');
    assert.equal(final.x, 1000); assert.equal(final.y, 200); assert.equal(final.width, 350);
    assert.equal(await h.frame.locator('[data-node="a"]').count(), 1);
    assert.equal(await h.frame.locator('#exits > *').count(), 0);
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

test('build command during motion survives settlement and a slide-key switch clears old DOM', async () => {
  const h = await harness();
  try {
    await send(h.page, message(1, slide('<div data-node="a" data-content="text" data-build="2" class="box">Reveal</div>'), { mode: 'presentation', motion: { ...DEFAULT_MOTION, durationMs: 200 } }));
    await ack(h.page, 'applied', 1);
    await send(h.page, { version: 1, channel, type: 'build', sequence: 2, revision: 'r1', build: 2, holdIds: [] });
    const settled = await ack(h.page, 'settled', 2);
    assert.equal(settled.domEquivalent, true, await h.frame.locator('#stage').innerHTML()); assert.equal((await geometry(h.frame, 'a')).visibility, 'visible');
    await send(h.page, message(3, '<div data-node="other-slide" style="width:1920px;height:1080px;background:white"><div data-node="other" data-content="text">Next</div></div>', { slideId: 'other-slide', motion: { ...DEFAULT_MOTION, durationMs: 150 } }));
    assert.equal((await ack(h.page, 'settled', 3)).domEquivalent, true);
    assert.equal(await h.frame.locator('[data-node="a"]').count(), 0);
    assert.equal(await h.frame.locator('#exits > *').count(), 0);
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

test('corrupt embedded assets refuse and restore the last visible revision', async () => {
  const h = await harness();
  try {
    await send(h.page, message(1, slide('<div data-node="a" data-content="text">Retained</div>'))); await ack(h.page, 'settled', 1);
    await send(h.page, message(2, slide('<img data-node="broken" src="data:image/png;base64,aW52YWxpZA==">')));
    assert.equal((await ack(h.page, 'refused', 2)).code, 'asset_failed');
    assert.equal(await h.frame.locator('[data-node="a"]').textContent(), 'Retained');
    await send(h.page, message(3, slide('<div data-node="a" data-content="text">Recovered</div>')));
    assert.equal((await ack(h.page, 'settled', 3)).domEquivalent, true);
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

test('numeric counting is bounded; record actual intermediate digits under D56 animation exception', async () => {
  await mkdir('.artifacts/viewer-runs', { recursive: true });
  const artifact = await mkdtemp('.artifacts/viewer-runs/numeric-');
  const h = await harness({ video: `${artifact}/video` });
  try {
    const markup = (value: string) => slide(`<div data-node="stat" data-content="stat" style="position:absolute;left:240px;top:300px;font-size:180px"><span data-stat-value="${value}">${value}</span><div style="font-size:40px">Illustrative revenue correction</div></div>`);
    await send(h.page, message(1, markup('$12.4 million'))); await ack(h.page, 'settled', 1);
    await h.page.screenshot({ path: `${artifact}/before.png` });
    await send(h.page, message(2, markup('$12.7 million'), { motion: { ...DEFAULT_MOTION, durationMs: 1200 } }));
    await ack(h.page, 'applied', 2);
    const samples: { at: number; text: string }[] = [];
    for (let i = 0; i < 12; i++) {
      await h.page.waitForTimeout(55);
      samples.push(await h.frame.locator('[data-stat-value]').evaluate(el => ({ at: performance.now(), text: el.textContent! })));
      if (i === 2) await h.page.screenshot({ path: `${artifact}/intermediate.png` });
    }
    assert.ok(samples.every(s => { const value = Number(s.text.replace(/[^\d.]/g, '')); return value >= 12.4 && value <= 12.7; }));
    assert.ok(samples.some(s => s.text !== '$12.4 million' && s.text !== '$12.7 million'), JSON.stringify(samples));
    assert.equal((await ack(h.page, 'settled', 2)).domEquivalent, true, await h.frame.locator('#stage').innerHTML());
    await h.page.screenshot({ path: `${artifact}/after.png` });
    await writeFile(`${artifact}/samples.json`, JSON.stringify({ decision: 'D56: intermediate bounded counting digits are animation, not factual claims', observed: samples, claim: 'Bounded counting displays intermediate digits that were not user source claims.' }, null, 2));
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

test('renderer artifact uses identical bundled fonts and includes Stat-owned visible identities', async () => {
  const renderer = new HonoSlideRenderer();
  const source = allocateIds(createDeck().source.replace('<SpeakerNotes id="n12" />', '<SpeakerNotes id="n12" /><Text role="title">Exact renderer words</Text><Stat value="42%" label="growth"/>')).source;
  const artifact = await renderer.render(source, 'n10');
  const h = await harness();
  try {
    await send(h.page, message(1, artifact.html, { css: artifact.css, slideId: 'n10' }));
    assert.equal((await ack(h.page, 'settled', 1)).domEquivalent, true);
    const painted = await ack(h.page, 'painted', 1);
    const statId = await h.frame.locator('[data-stat-value]').evaluate(el => el.closest('[data-node]')!.getAttribute('data-node'));
    assert.ok(painted.visibleNodeIds?.includes(statId!));
    const loadedFaces = await h.frame.evaluate(() => [...document.fonts].map(face => ({ family: face.family, weight: face.weight, status: face.status })));
    for (const font of artifact.fonts) assert.ok(loadedFaces.some(face => face.family.replaceAll('\"', '') === font.family && face.weight === String(font.weight) && face.status === 'loaded'), JSON.stringify(loadedFaces));
    assert.equal(await h.frame.evaluate(() => document.fonts.check('400 32px "Talkdeck Noto Sans"')), true);
    assert.equal(await h.frame.evaluate(() => document.fonts.check('700 72px "Talkdeck Noto Sans"')), true);
    const canvas = await h.frame.locator('[data-slide-canvas]').boundingBox();
    assert.equal(canvas?.width, 1920); assert.equal(canvas?.height, 1080);
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

test('newer publication supersedes a pending resource wait without showing the stale target', async () => {
  const h = await harness();
  try {
    await send(h.page, message(1, slide('<div data-node="a" data-content="text">Visible baseline</div>'))); await ack(h.page, 'settled', 1);
    // Delay the genuine font-ready promise to deterministically reproduce a slow resource pipeline.
    await h.frame.evaluate(() => {
      const getReady = Object.getOwnPropertyDescriptor(FontFaceSet.prototype, 'ready')!.get!;
      Object.defineProperty(document.fonts, 'ready', { get() { return Promise.all([getReady.call(this), new Promise(resolve => setTimeout(resolve, 200))]); } });
    });
    await send(h.page, message(2, slide('<div data-node="a" data-content="text">Stale target</div>')));
    await h.page.waitForTimeout(30);
    assert.match(await h.frame.locator('#exits').textContent() ?? '', /Visible baseline/);
    await send(h.page, message(3, slide('<div data-node="a" data-content="text">Latest target</div>')));
    assert.equal((await ack(h.page, 'refused', 2)).code, 'superseded_before_paint');
    assert.equal((await ack(h.page, 'settled', 3)).domEquivalent, true);
    assert.equal(await h.frame.locator('[data-node="a"]').textContent(), 'Latest target');
    assert.equal(await h.page.evaluate(() => (window as any).acks.some((a: any) => a.type === 'painted' && a.sequence === 2)), false);
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

test('numeric precision changes remain bounded and nonnumeric Stats crossfade as exact strings', async () => {
  const h = await harness();
  try {
    const markup = (value: string) => slide(`<div data-node="s" class="box" data-content="stat"><span data-stat-value="${value}">${value}</span></div>`);
    await send(h.page, message(1, markup('1.28'))); await ack(h.page, 'settled', 1);
    await send(h.page, message(2, markup('1.2'), { motion: { ...DEFAULT_MOTION, durationMs: 300 } })); await ack(h.page, 'applied', 2);
    for (let i = 0; i < 4; i++) {
      const value = Number(await h.frame.locator('[data-stat-value]').textContent());
      assert.ok(value >= 1.2 && value <= 1.28, String(value)); await h.page.waitForTimeout(40);
    }
    await ack(h.page, 'settled', 2);
    assert.equal(await h.frame.locator('[data-stat-value]').textContent(), '1.2');
    await send(h.page, message(3, markup('Ready'), { motion: { ...DEFAULT_MOTION, durationMs: 200 } })); await ack(h.page, 'applied', 3);
    assert.match(await h.frame.locator('#exits').textContent() ?? '', /1.2/);
    assert.equal((await ack(h.page, 'settled', 3)).domEquivalent, true);
    assert.equal(await h.frame.locator('[data-stat-value]').textContent(), 'Ready');
    assert.equal(await h.frame.locator('#exits > *').count(), 0);
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

test('nested zoom/translate reparenting retargets at early and late progress with bounded size and opacity', async () => {
  await mkdir('.artifacts/viewer-runs', { recursive: true });
  const artifact = await mkdtemp('.artifacts/viewer-runs/motion-');
  const h = await harness({ video: `${artifact}/video` });
  const samples: unknown[] = [];
  try {
    let seq = 0;
    const markup = (left: number, width: number, zoom: number, parent: string) => slide(`<div data-node="${parent}" style="position:absolute;left:${left}px;top:180px"><div data-node="a" data-content="text" class="box" style="position:relative;left:0;top:0;width:${width}px;zoom:${zoom};transform:translate(25%,10%)">Stable words</div></div>`);
    for (const delay of [25, 140, 280]) {
      await send(h.page, message(++seq, markup(100, 240, 0.8, 'parent'))); await ack(h.page, 'settled', seq);
      const start = await geometry(h.frame, 'a');
      await send(h.page, message(++seq, markup(900, 480, 1.2, 'parent'), { motion: { ...DEFAULT_MOTION, durationMs: 400 } })); await ack(h.page, 'applied', seq);
      await h.page.waitForTimeout(delay);
      const interrupted = await geometry(h.frame, 'a');
      assert.ok(interrupted.width >= start.width - 1 && interrupted.width <= 576 + 1, JSON.stringify(interrupted));
      assert.ok(interrupted.opacity >= 0 && interrupted.opacity <= 1);
      await send(h.page, message(++seq, markup(500, 300, 1, 'new-parent'), { motion: { ...DEFAULT_MOTION, durationMs: 300 } })); await ack(h.page, 'applied', seq);
      const retarget = await geometry(h.frame, 'a');
      assert.equal((await h.frame.locator('#viewport').textContent())!.split('Stable words').length - 1, 1, 'Reparented content must not remain duplicated in its old parent exit snapshot');
      assert.ok(Math.abs(retarget.x - interrupted.x) < 160, JSON.stringify({ interrupted, retarget }));
      assert.ok(retarget.width >= Math.min(interrupted.width, 300) - 1 && retarget.width <= Math.max(interrupted.width, 300) + 60, JSON.stringify({ interrupted, retarget }));
      samples.push({ delay, interrupted, retarget });
      await h.page.screenshot({ path: `${artifact}/retarget-${delay}.png` });
      assert.equal((await ack(h.page, 'settled', seq)).domEquivalent, true);
      const settled = await geometry(h.frame, 'a');
      assert.equal(settled.x, 575); assert.equal(settled.width, 300); assert.equal(settled.text, 'Stable words');
      assert.equal(await h.frame.locator('[data-node="a"]').count(), 1);
    }
    await writeFile(`${artifact}/samples.json`, JSON.stringify(samples, null, 2));
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

test('a corrupt font is not a successful viewer publication and external CSS requests stay blocked', async () => {
  const h = await harness();
  try {
    await send(h.page, message(1, slide('<div data-node="a" data-content="text">Existing</div>'))); await ack(h.page, 'settled', 1);
    await send(h.page, message(2, slide('<div data-node="a" data-content="text" style="font-family:Broken">Target</div>'), { css: css + '@font-face{font-family:Broken;src:url(data:font/ttf;base64,aW52YWxpZA==)}' }));
    assert.equal((await ack(h.page, 'refused', 2)).code, 'font_failed');
    assert.equal(await h.frame.locator('[data-node="a"]').textContent(), 'Existing');
    const failed: string[] = []; let networkRoutes = 0;
    h.page.on('requestfailed', req => { if (req.url().startsWith('https://')) failed.push(req.failure()?.errorText ?? 'unknown'); });
    await h.page.route('https://example.invalid/**', route => { networkRoutes++; return route.abort(); });
    await send(h.page, message(3, slide('<div data-node="a" data-content="text">Network denied</div>'), { css: css + ' @import "https://example.invalid/style.css"; [data-node="a"]{background-image:url(https://example.invalid/image.png)}' }));
    await ack(h.page, 'settled', 3); await h.page.waitForTimeout(50);
    assert.equal(networkRoutes, 0);
    assert.ok(failed.length > 0 && failed.every(reason => ['csp', 'net::ERR_BLOCKED_BY_CSP'].includes(reason)), JSON.stringify(failed));
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});
