import type { Page } from 'playwright';
import { CANVAS, SourceError } from '../contracts.js';
import type { RenderArtifact } from '../render/types.js';
import type { SlideMeasurement } from './types.js';

async function injectStyle(page: Page, content: string) {
  return page.evaluateHandle(css => { const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style); return style; }, content);
}

const measurementCSS = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}html,body{margin:0!important;padding:0!important;width:1920px!important;height:1080px!important;overflow:hidden!important}';
export function staticDocument(artifact: RenderArtifact) {
  // HTML/CSS are renderer-owned output. Source JSX is never placed in this document.
  const csp = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  if (/<\/style/i.test(artifact.css)) throw new SourceError('validation_unavailable', 'Invalid renderer stylesheet boundary');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${artifact.css}</style><style>${measurementCSS}</style></head><body>${artifact.html}</body></html>`;
}
export async function preparePage(page: Page, artifact: RenderArtifact) {
  if (!artifact.fonts.length || !artifact.dependencies.some(d => d.kind === 'font')) throw new SourceError('validation_unavailable', 'Render artifact has no pinned font dependency');
  await page.setContent(staticDocument(artifact), { waitUntil: 'load' });
  // tsx/esbuild preserves local function names with this helper. Install its identity
  // operation through trusted automation; no page-authored script is enabled.
  await page.evaluate('globalThis.__name = (value) => value');
  await page.evaluate(async fonts => {
    await document.fonts.ready;
    for (const font of fonts) {
      const specification = `${font.style} ${font.weight} 32px ${JSON.stringify(font.family)}`;
      const faces = await document.fonts.load(specification, font.testText);
      if (!faces.length || faces.some(face => face.status !== 'loaded') || !document.fonts.check(specification, font.testText))
        throw new Error(`Pinned font is unavailable: ${font.family} ${font.weight}`);
    }
    for (const image of document.images) {
      await image.decode();
      if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) throw new Error('Image did not decode');
    }
  }, artifact.fonts);
}

/** Runs only through trusted automation; page-authored scripts remain disabled. */
export async function measurePage(page: Page, artifact: RenderArtifact): Promise<SlideMeasurement> {
  const measured: SlideMeasurement = await page.evaluate(({ slideId, canvas }) => {
    const root = document.querySelector<HTMLElement>('[data-slide-canvas="true"]');
    if (!root || root.dataset.node !== slideId) throw new Error('Missing or mismatched slide canvas');
    const rect = (value: DOMRect) => ({ x: value.x, y: value.y, width: value.width, height: value.height });
    const canvasRect = rect(root.getBoundingClientRect());
    if (Math.abs(canvasRect.x) > .01 || Math.abs(canvasRect.y) > .01 || Math.abs(canvasRect.width - canvas.width) > .01 || Math.abs(canvasRect.height - canvas.height) > .01)
      throw new Error('Final design canvas must be exactly 1920x1080 at origin');
    const nodeElements = [...root.querySelectorAll<HTMLElement>('[data-node]')];
    nodeElements.unshift(root);
    if (nodeElements.length > 10_000) throw new Error('Browser node measurement limit exceeded');
    const ids = new Set<string>();
    const nodes = nodeElements.map(element => {
      const id = element.dataset.node!;
      if (ids.has(id)) throw new Error(`Duplicate rendered node identity ${id}`);
      ids.add(id);
      const bleed = element.dataset.bleed === 'true';
      if (bleed && !element.hasAttribute('data-shape') && element.dataset.primitive !== 'Rule' && !element.classList.contains('td-rule')) throw new Error('Only decorative Shape/Rule nodes may bleed');
      return { id, authoredId: element.dataset.authoredNode ?? id, rect: rect(element.getBoundingClientRect()), bleed, shape: element.dataset.shape, shapeOpacity: element.dataset.shapeOpacity };
    });
    const color = (value: string): [number, number, number, number] => {
      const m = /^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(value);
      if (!m) throw new Error(`Unsupported computed sRGB color: ${value}`);
      return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
    };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const ordinal = new Map<string, number>();
    const texts: import('./types.js').TextRun[] = [];
    while (walker.nextNode()) {
      const leaf = walker.currentNode as Text, element = leaf.parentElement;
      if (!element || !leaf.data.trim() || element.closest('svg,style,script,template,canvas')) continue;
      const owner = element.closest<HTMLElement>('[data-node]');
      const roleElement = element.closest<HTMLElement>('[data-role]');
      if (!owner || !roleElement) throw new Error('Native text is missing node identity or typography role');
      const renderedId = owner.dataset.node!, nodeId = owner.dataset.authoredNode ?? renderedId, role = roleElement.dataset.role!;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility !== 'visible') throw new Error(`Final native text ${nodeId} is unexpectedly hidden`);
      let zoom = 1, opacity = 1, parent: Element | null = element;
      const bounds: { id: string; rect: ReturnType<typeof rect> }[] = [];
      let onSurface = false;
      while (parent && root.contains(parent)) {
        const inherited = getComputedStyle(parent);
        const ownZoom = Number(inherited.zoom || 1);
        if (!Number.isFinite(ownZoom) || ownZoom <= 0) throw new Error('Invalid effective zoom');
        zoom *= ownZoom;
        if (inherited.transform !== 'none') {
          const matrix = new DOMMatrixReadOnly(inherited.transform);
          if (Math.abs(matrix.a - 1) > .0001 || Math.abs(matrix.d - 1) > .0001 || Math.abs(matrix.b) > .0001 || Math.abs(matrix.c) > .0001)
            throw new Error('Final content scaling must use zoom; unsupported transformed text measurement');
        }
        const ownOpacity = Number(inherited.opacity);
        if (ownOpacity !== 1 && (color(inherited.backgroundColor)[3] > 0 || inherited.backgroundImage !== 'none' || parent !== element))
          throw new Error('Unsupported group-opacity compositor; use foreground alpha on native text');
        opacity *= ownOpacity;
        if (parent.hasAttribute('data-surface')) {
          onSurface ||= color(inherited.backgroundColor)[3] > 0 || inherited.backgroundImage !== 'none';
          bounds.push({ id: `surface:${parent.getAttribute('data-node')}`, rect: rect(parent.getBoundingClientRect()) });
        }
        parent = parent.parentElement;
      }
      const content = element.closest<HTMLElement>('[data-content]') ?? owner;
      bounds.unshift({ id: `own:${content.dataset.node ?? nodeId}`, rect: rect(content.getBoundingClientRect()) });
      const range = document.createRange(); range.selectNodeContents(leaf);
      const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0).map(rect);
      if (!rects.length) throw new Error(`Native text ${nodeId} has no measured glyph box`);
      const rgba = color(style.color), index = ordinal.get(renderedId) ?? 0; ordinal.set(renderedId, index + 1);
      const stat = element.closest<HTMLElement>('[data-stat-value]');
      texts.push({ id: `${renderedId}:text:${index}`, nodeId, role, text: leaf.data, rects, bounds,
        fontPx: parseFloat(style.fontSize) * zoom, fontWeight: Number(style.fontWeight),
        color: [rgba[0], rgba[1], rgba[2]], alpha: rgba[3] * opacity, onSurface,
        statId: stat ? `${stat.closest<HTMLElement>('[data-node]')?.dataset.node}:stat-value` : undefined, backgrounds: [] });
      if (texts.length > 2_000) throw new Error('Browser text measurement limit exceeded');
    }
    const displayFloor = Number(root.dataset.displayFloor ?? 144);
    if (!Number.isFinite(displayFloor) || displayFloor < 144) throw new Error('Invalid display role floor');
    return { slideId, canvas: canvasRect, nodes, texts, shapeIntersections: [], pendingNodeIds: nodeElements.filter(e => e.hasAttribute('data-pending')).map(e => e.dataset.node!), displayFloor } satisfies import('./types.js').SlideMeasurement;
  }, { slideId: artifact.slideId, canvas: CANVAS });
  if (!measured.texts.length) return measured;

  // Hiding glyph paint leaves layout, actual surfaces, Shapes, images and alpha composition
  // unchanged. This capture is private measurement data, never automatic model feedback.
  const glyphHiding = await injectStyle(page, '*{ -webkit-text-fill-color:transparent!important;text-shadow:none!important;text-decoration-color:transparent!important }');
  let background: string;
  try { background = (await page.screenshot({ type: 'png', animations: 'disabled' })).toString('base64'); }
  finally { await glyphHiding.evaluate(element => element.parentNode?.removeChild(element)); }

  // Independent glyph coverage mask catches invisible text too. Sampling original-minus-
  // background pixels would miss exactly the low-contrast glyphs that need a finding.
  const maskStyle = await injectStyle(page, '*{background:transparent!important;border-color:transparent!important;outline-color:transparent!important;box-shadow:none!important;text-shadow:none!important;text-decoration:none!important;-webkit-text-fill-color:white!important;color:white!important;opacity:1!important}svg,img,canvas,video{visibility:hidden!important}');
  let mask: string;
  try { mask = (await page.screenshot({ type: 'png', animations: 'disabled', omitBackground: true })).toString('base64'); }
  finally { await maskStyle.evaluate(element => element.parentNode?.removeChild(element)); }

  const colors = await page.evaluate(async ({ background, mask, texts }) => {
    async function pixels(base64: string) {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true })!; context.drawImage(image, 0, 0);
      return { data: context.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height };
    }
    const bg = await pixels(background), glyphs = await pixels(mask);
    let visited = 0;
    return texts.map(text => {
      const colors = new Set<number>();
      for (const rect of text.rects) {
        const x0 = Math.max(0, Math.floor(rect.x)), x1 = Math.min(bg.width, Math.ceil(rect.x + rect.width));
        const y0 = Math.max(0, Math.floor(rect.y)), y1 = Math.min(bg.height, Math.ceil(rect.y + rect.height));
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          if (++visited > 12_000_000) throw new Error('Contrast pixel measurement limit exceeded');
          const offset = (y * bg.width + x) * 4;
          if (!glyphs.data[offset + 3]) continue;
          colors.add(bg.data[offset] * 65536 + bg.data[offset + 1] * 256 + bg.data[offset + 2]);
        }
      }
      if (!colors.size) {
        // Fully off-canvas glyphs cannot have viewport contrast samples. Keep their
        // measured geometry so policy can return actionable overflow findings.
        const outside = text.rects.every(r => r.x + r.width <= 0 || r.y + r.height <= 0 || r.x >= bg.width || r.y >= bg.height);
        if (!outside) throw new Error(`No native glyph coverage could be measured for ${text.id}`);
      }
      return [...colors].map(packed => [packed >> 16 & 255, packed >> 8 & 255, packed & 255] as [number,number,number]);
    });
  }, { background, mask, texts: measured.texts });
  for (const [i, samples] of colors.entries()) measured.texts[i].backgrounds = samples;

  for (const shape of measured.nodes.filter(n => n.shape && n.shapeOpacity === 'solid')) {
    const marker = await page.evaluateHandle(id => {
      const element = [...document.querySelectorAll<HTMLElement>('[data-node]')].find(e => e.dataset.node === id);
      if (!element) throw new Error('Measured Shape disappeared');
      element.setAttribute('data-measure-shape', 'true'); return element;
    }, shape.id);
    const shapeStyle = await injectStyle(page, '*:not([data-measure-shape]):not([data-measure-shape] *){visibility:hidden!important}[data-measure-shape],[data-measure-shape] *{visibility:visible!important}');
    let shapePixels: string;
    try { shapePixels = (await page.screenshot({ type: 'png', animations: 'disabled', omitBackground: true })).toString('base64'); }
    finally { await shapeStyle.evaluate(element => element.parentNode?.removeChild(element)); await marker.evaluate(element => element.removeAttribute('data-measure-shape')); await marker.dispose(); }
    const overlaps = await page.evaluate(async ({ shape, glyph, texts }) => {
      async function pixels(base64: string) {
        const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d', { willReadFrequently: true })!; context.drawImage(image, 0, 0);
        return { data: context.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height };
      }
      const a = await pixels(shape), b = await pixels(glyph);
      return texts.map(text => {
        const offsets = new Set<number>();
        for (const r of text.rects) for (let y = Math.max(0, Math.floor(r.y)); y < Math.min(a.height, Math.ceil(r.y + r.height)); y++)
          for (let x = Math.max(0, Math.floor(r.x)); x < Math.min(a.width, Math.ceil(r.x + r.width)); x++) {
            const offset = (y * a.width + x) * 4;
            if (a.data[offset + 3] && b.data[offset + 3]) offsets.add(offset);
          }
        return { textId: text.id, nodeId: text.nodeId, pixels: offsets.size };
      }).filter(overlap => overlap.pixels > 0);
    }, { shape: shapePixels, glyph: mask, texts: measured.texts });
    measured.shapeIntersections.push(...overlaps.map(overlap => ({ ...overlap, shapeId: shape.id })));
  }
  return measured;
}
