import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunRecorder } from '../evaluation/recorder.js';
import type { CapturedFrame } from './viewer.js';
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
/** Static evaluator report. Only public rendered frames appear; never model context. Call after viewer.close for video. */
export async function writeViewerGallery(recorder: RunRecorder, frames: readonly CapturedFrame[]) {
  await recorder.flush();
  const videos = (await readdir(join(recorder.directory, 'viewer'))).filter(name => /^[a-zA-Z0-9_@-]+\.webm$/.test(name));
  const cards = frames.map(frame => {
    if (!/^viewer\/frame-\d+\.png$/.test(frame.evidence)) throw new Error('Gallery frame path is not an issued evaluator screenshot');
    const heading = `${frame.slideId} · ${frame.surface} · ${frame.trigger} · ${frame.coherent ? 'same publication' : 'changed during capture'}`;
    return `<article><h2>${escape(heading)}</h2><p>Revision ${escape(frame.revision)}. DOM sample ${frame.atMs.toFixed(2)} ms; capture interval ${frame.captureStartedAtMs.toFixed(2)}–${frame.captureFinishedAtMs.toFixed(2)} ms.</p><a href="${frame.evidence}"><img loading="lazy" src="${frame.evidence}" alt="${escape(heading)}"></a><details><summary>Observed native text</summary><pre>${escape(JSON.stringify(frame.content, null, 2))}</pre></details></article>`;
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'"><title>Headless viewer evidence</title><style>body{font:16px system-ui;background:#f5f5f5;color:#18181b;margin:32px}article{background:white;padding:24px;margin:24px 0}img,video{width:100%;max-width:1280px}pre{white-space:pre-wrap}h2{font-size:20px}</style></head><body><h1>Headless viewer evidence</h1><p>These are evaluator-only captures of the packaged iframe. DOM samples and PNG captures have separate timestamps; animation can change between them. Incoherent captures cannot establish target visibility. Review the continuous video for intermediate digits, exits, clipping and motion.</p>${videos.map(name => `<p><a href="viewer/${name}">Original video ${name}</a></p><video controls preload="metadata" src="viewer/${name}"></video>`).join('')}${cards.join('')}</body></html>`;
  const path = join(recorder.directory, 'viewer-gallery.html'); await writeFile(path, html, { flag: 'wx', mode: 0o600 }); return path;
}
