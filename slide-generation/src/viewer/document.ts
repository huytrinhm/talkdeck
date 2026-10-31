import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
const client = readFileSync(new URL('./client.js', import.meta.url), 'utf8');

/** Host must set sandbox=allow-scripts; opaque origins are intentional. */
export function createViewerDocument(channel: string, nonce = randomBytes(24).toString('base64')) {
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(channel)) throw new Error('Viewer channel must be an unpredictable URL-safe token');
  if (!/^[a-zA-Z0-9+/=_-]{16,128}$/.test(nonce)) throw new Error('Invalid CSP nonce');
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111}
#viewport{position:absolute;width:1920px;height:1080px;transform-origin:0 0;overflow:hidden}
#stage,#exits{position:absolute;inset:0;width:1920px;height:1080px}
#exits{pointer-events:none}
[data-viewer-held]{visibility:hidden!important}
</style><style id="render-css"></style></head><body><div id="viewport"><div id="stage"></div><div id="exits" aria-hidden="true"></div></div><script nonce="${nonce}">"use strict";const VIEWER_CONFIG=${JSON.stringify({ channel, version: 1 })};\n${client}\n</script></body></html>`;
}
