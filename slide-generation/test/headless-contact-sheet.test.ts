import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowserPool } from '../src/browser/pool.js';
import { ContactSheetError, writeDeckContactSheet } from '../src/headless/contact-sheet.js';

const source = '<Deck id="deck"><Slide id="second"/><Archive id="archive"><ArchivedSlide id="deleted" slideId="old"/></Archive><Slide id="first"/><Slide id="third"/></Deck>';
async function directory() {
  await mkdir('.artifacts/contact-sheet-tests', { recursive: true });
  return mkdtemp('.artifacts/contact-sheet-tests/run-');
}
test('real PNG contact sheet contains every canonical live slide in order with exact geometry and original image hashes', async () => {
  const dir = await directory(), pool = new BrowserPool();
  const slides = [{ slideId: 'first', color: '#ff0000' }, { slideId: 'third', color: '#0000ff' }, { slideId: 'second', color: '#00ff00' }];
  try {
    await pool.withPage(async page => {
      for (const slide of slides) {
        await page.setContent(`<style>body{margin:0;background:${slide.color}}</style>`);
        await page.screenshot({ path: join(dir, `${slide.slideId}.png`), type: 'png' });
      }
    });
    const result = await writeDeckContactSheet({ source, slides: slides.map(slide => ({ slideId: slide.slideId, path: join(dir, `${slide.slideId}.png`) })), outputPath: join(dir, 'sheet.png') });
    assert.equal(result.complete, true);
    assert.deepEqual(result.slideIds, ['second', 'first', 'third']);
    assert.equal(result.width, 1968); assert.equal(result.height, 1208);
    assert.deepEqual(result.items.map(item => [item.index, item.x, item.y]), [[1, 16, 56], [2, 992, 56], [3, 16, 652]]);
    assert.ok(result.items.every(item => item.width === 960 && item.height === 540 && /^[a-f0-9]{64}$/.test(item.imageSha256)));
    const bytes = await readFile(result.path);
    assert.equal(bytes.readUInt32BE(16), 1968); assert.equal(bytes.readUInt32BE(20), 1208);
    const pixels = await pool.withPage(async page => {
      await page.setContent(`<img src="data:image/png;base64,${bytes.toString('base64')}">`);
      return page.locator('img').evaluate(async element => {
        const image = element as HTMLImageElement;
        await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
        return [[100, 100], [1100, 100], [100, 700]].map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
      });
    });
    assert.deepEqual(pixels, [[0, 255, 0, 255], [255, 0, 0, 255], [0, 0, 255, 255]]);
    await assert.rejects(writeDeckContactSheet({ source, slides: result.items, outputPath: result.path }), /already exists/);
    assert.deepEqual(await readFile(result.path), bytes);
  } finally { await pool.close(); }
});

test('missing, duplicate, extra or undecodable captures never produce a supposedly complete image', async () => {
  const dir = await directory(), outputPath = join(dir, 'sheet.png'), missingPath = join(dir, 'missing.png');
  const badSet = [{ slideId: 'first', path: missingPath }, { slideId: 'first', path: missingPath }, { slideId: 'deleted', path: missingPath }];
  await assert.rejects(writeDeckContactSheet({ source, slides: badSet, outputPath }), error => {
    assert.ok(error instanceof ContactSheetError);
    assert.deepEqual(error.expectedSlideIds, ['second', 'first', 'third']);
    assert.match(error.message, /Duplicate supplied/); assert.match(error.message, /Missing capture for second/); assert.match(error.message, /Unexpected capture for deleted/);
    return true;
  });
  await assert.rejects(writeDeckContactSheet({ source, slides: ['first', 'second', 'third'].map(slideId => ({ slideId, path: missingPath })), outputPath }), /Duplicate source capture paths/);
  const completeSet = ['first', 'second', 'third'].map(slideId => ({ slideId, path: join(dir, `${slideId}.png`) }));
  await assert.rejects(writeDeckContactSheet({ source, slides: completeSet, outputPath }), /ENOENT/);
  for (const slide of completeSet) await writeFile(slide.path, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  await assert.rejects(writeDeckContactSheet({ source, slides: completeSet, outputPath }), /unavailable/);
  await assert.rejects(stat(outputPath), { code: 'ENOENT' });
});

test('a decodable image of the wrong slide dimensions is refused rather than stretched into evidence', async () => {
  const dir = await directory(), pool = new BrowserPool(), path = join(dir, 'small.png');
  try {
    await pool.withPage(async page => { await page.setViewportSize({ width: 400, height: 200 }); await page.screenshot({ path }); });
    const outputPath = join(dir, 'sheet.png');
    await assert.rejects(writeDeckContactSheet({ source: '<Deck id="d"><Slide id="s"/></Deck>', slides: [{ slideId: 's', path }], outputPath }), /1920×1080/);
    await assert.rejects(stat(outputPath), { code: 'ENOENT' });
  } finally { await pool.close(); }
});
