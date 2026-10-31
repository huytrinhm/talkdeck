import { parseArgs } from 'node:util';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContactSheetError, writeDeckContactSheet } from '../src/headless/contact-sheet.js';

const { values } = parseArgs({ options: { run: { type: 'string' }, out: { type: 'string' } }, strict: true });
if (!values.run || !values.out) throw new Error('Usage: headless-contact-sheet --run EXISTING_EVIDENCE_DIR --out NEW_ARTIFACT_DIR');
const root = fileURLToPath(new URL('../', import.meta.url)), run = resolve(values.run), out = resolve(values.out);
const inside = relative(join(root, '.artifacts'), out);
if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Output must be new under slide-generation/.artifacts');
const insideRun = relative(run, out);
if (!insideRun || (!insideRun.startsWith('..') && !isAbsolute(insideRun))) throw new Error('Standalone output must be outside the original run');
await mkdir(out, { recursive: false });
try {
  const source = await readFile(join(run, 'final/deck.jsx'), 'utf8');
  const slides = (await readdir(join(run, 'final'))).filter(name => /^slide-.+\.(?:jpg|jpeg|png)$/.test(name))
    .map(name => ({ slideId: name.replace(/^slide-/, '').replace(/\.(?:jpg|jpeg|png)$/, ''), path: join(run, 'final', name) }));
  const result = await writeDeckContactSheet({ source, slides, outputPath: join(out, 'deck-contact-sheet.png') });
  await writeFile(join(out, 'contact-sheet-status.json'), JSON.stringify({ ...result, originalRun: run, paidCalls: 0 }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(result));
} catch (error) {
  const result = { complete: false, originalRun: run, paidCalls: 0, error: String(error),
    ...(error instanceof ContactSheetError ? { issues: error.issues, expectedSlideIds: error.expectedSlideIds, providedSlideIds: error.providedSlideIds } : {}) };
  await writeFile(join(out, 'contact-sheet-status.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
  console.error(JSON.stringify(result)); process.exitCode = 1;
}
