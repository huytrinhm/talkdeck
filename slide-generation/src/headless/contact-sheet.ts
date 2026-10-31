import { lstat, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { BrowserPool } from '../browser/pool.js';
import { parseSource } from '../parser.js';
import { lineHash } from '../hashline.js';

export interface ContactSheetInput {
  source: string;
  slides: readonly { slideId: string; path: string }[];
  outputPath: string;
}
export interface ContactSheetResult {
  complete: true; path: string; width: number; height: number; columns: 2;
  sourceSha256: string; slideIds: string[];
  items: { slideId: string; index: number; path: string; imageSha256: string; width: number; height: number; x: number; y: number }[];
}
export class ContactSheetError extends Error {
  constructor(readonly issues: string[], readonly expectedSlideIds: string[], readonly providedSlideIds: string[]) {
    super(`Complete deck contact sheet unavailable: ${issues.join('; ')}`);
    this.name = 'ContactSheetError';
  }
}
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Contact sheet of existing final captures, never a slide re-render or a completeness/faithfulness verdict. */
export async function writeDeckContactSheet(input: ContactSheetInput): Promise<ContactSheetResult> {
  const root = parseSource(input.source);
  const live = root.children.filter(child => typeof child !== 'string' && child.tag === 'Slide');
  const expected = live.map(node => typeof node === 'string' ? '' : node.id ?? '');
  const provided = input.slides.map(slide => slide.slideId), issues: string[] = [];
  if (root.tag !== 'Deck' || !expected.length || expected.some(id => !id)) issues.push('Canonical source must contain identified live slides');
  if (new Set(expected).size !== expected.length) issues.push('Duplicate canonical live slide IDs');
  if (new Set(provided).size !== provided.length) issues.push('Duplicate supplied slide IDs');
  if (new Set(input.slides.map(slide => resolve(slide.path))).size !== input.slides.length) issues.push('Duplicate source capture paths');
  for (const id of expected) if (!provided.includes(id)) issues.push(`Missing capture for ${id}`);
  for (const id of provided) if (!expected.includes(id)) issues.push(`Unexpected capture for ${id}`);
  const width = 1968, height = Math.ceil(expected.length / 2) * 580 + (Math.ceil(expected.length / 2) + 1) * 16;
  if (height > 32760) issues.push('Complete sheet exceeds supported 32760px image height');
  if (!input.outputPath.endsWith('.png')) issues.push('Contact sheet output must be PNG');
  if (input.slides.some(slide => resolve(slide.path) === resolve(input.outputPath))) issues.push('Output must not replace a source capture');
  try { await lstat(input.outputPath); issues.push('Output already exists; original evidence will not be replaced'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (issues.length) throw new ContactSheetError(issues, expected, provided);
  const captures: { slideId: string; path: string; bytes: Buffer; mime: string }[] = [];
  for (const id of expected) {
    const slide = input.slides.find(item => item.slideId === id)!;
    try {
      const bytes = await readFile(slide.path);
      const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if (!png && !jpeg) throw new Error('Capture must be a decoded PNG or JPEG image');
      captures.push({ ...slide, bytes, mime: png ? 'image/png' : 'image/jpeg' });
    } catch (error) { issues.push(`${id}: ${String(error)}`); }
  }
  if (issues.length) throw new ContactSheetError(issues, expected, provided);
  const pool = new BrowserPool({ concurrency: 1, timeoutMs: 30_000 });
  try {
    const png = await pool.withPage(async page => {
      await page.setViewportSize({ width, height: Math.min(height, 1080) });
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>*{box-sizing:border-box}html,body{margin:0;padding:0}body{width:${width}px;padding:16px;background:#d4d4d8;display:grid;grid-template-columns:960px 960px;gap:16px;font:20px system-ui;color:#18181b}article{width:960px;height:580px;background:white}header{height:40px;padding:8px 12px;white-space:nowrap;overflow:hidden}img{display:block;width:960px;height:540px;object-fit:contain}</style></head><body>${captures.map((capture, index) => `<article data-slide-id="${escape(capture.slideId)}"><header>${index + 1}. ${escape(capture.slideId)}</header><img alt="Slide ${index + 1}: ${escape(capture.slideId)}" src="data:${capture.mime};base64,${capture.bytes.toString('base64')}"></article>`).join('')}</body></html>`);
      const measured = await page.locator('article').evaluateAll(async articles => Promise.all(articles.map(async article => {
        const image = article.querySelector('img')!;
        await image.decode();
        return { id: article.getAttribute('data-slide-id'), width: image.naturalWidth, height: image.naturalHeight };
      })));
      if (measured.length !== expected.length || measured.some((image, index) => image.id !== expected[index] || image.width !== 1920 || image.height !== 1080))
        throw new Error('Capture set/order/dimensions differ; every source screenshot must be exactly 1920×1080');
      const dimensions = await page.evaluate(() => ({ width: document.body.scrollWidth, height: document.body.scrollHeight }));
      if (dimensions.width !== width || dimensions.height !== height) throw new Error('Contact sheet layout dimensions differ from complete grid');
      return page.screenshot({ type: 'png', fullPage: true, animations: 'disabled' });
    });
    await writeFile(input.outputPath, png, { flag: 'wx', mode: 0o600 });
    return { complete: true, path: input.outputPath, width, height, columns: 2, sourceSha256: lineHash(input.source), slideIds: expected,
      items: captures.map((capture, index) => ({ slideId: capture.slideId, index: index + 1, path: capture.path,
        imageSha256: createHash('sha256').update(capture.bytes).digest('hex'), width: 960, height: 540,
        x: 16 + (index % 2) * 976, y: 56 + Math.floor(index / 2) * 596 })) };
  } catch (error) {
    throw new ContactSheetError([String(error)], expected, provided);
  } finally { await pool.close(); }
}
