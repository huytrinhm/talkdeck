import type { Page } from 'playwright';
import type { Rect } from './types.js';
import type { RenderDependency } from '../render/types.js';

/** Immutable, deterministic review geometry. Offsets are UTF-16 DOM Range offsets. */
export interface ReviewToken { text: string; start: number; end: number; rects: Rect[]; styles: string[] }
export interface ReviewPart { key: string; nodeId: string; text: string; tokens: ReviewToken[] }
export interface ReviewNode {
  id: string; authoredId: string; instanceId?: string; definitionId?: string; itemId?: string; parentId?: string;
  primitive: string; rect: Rect; style: Record<string, string>; build: number;
  visual: Record<string, string>;
}
export interface ReviewGeometry { canvas: { width: number; height: number }; nodes: ReviewNode[]; parts: ReviewPart[] }
export interface ReviewCapture {
  jpeg: string; imageDigest: string; renderDigest: string; sourceDigest: string;
  dependencies: RenderDependency[]; geometry: ReviewGeometry;
}
/** Measurement never wraps text or inserts highlight nodes into the slide. */
export async function measureReview(page: Page): Promise<ReviewGeometry> {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-slide-canvas]');
    if (!root) throw new Error('Review canvas is unavailable');
    const round = (n: number) => Math.round(n * 100) / 100;
    const rect = (r: DOMRect) => ({x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height)});
    const properties = ['color','background-color','background-image','font-family','font-size','font-weight','font-style','letter-spacing','line-height','text-align','opacity','border-top-color','border-top-width','border-radius','box-shadow','filter','transform','zoom','fill','stroke','stroke-width','clip-path'];
    const style = (el: Element) => {
      const computed = getComputedStyle(el);
      return Object.fromEntries(properties.map(p => [p, computed.getPropertyValue(p)]));
    };
    const elements = [root, ...root.querySelectorAll<HTMLElement>('[data-node]')];
    const nodes = elements.map(el => ({
      id: el.dataset.node!, authoredId: el.dataset.authoredNode ?? el.dataset.node!,
      instanceId: el.dataset.component, definitionId: el.dataset.definitionNode, itemId: el.dataset.itemNode,
      parentId: el.parentElement?.closest<HTMLElement>('[data-node]')?.dataset.node,
      primitive: el.dataset.primitive ?? 'Frame', rect: rect(el.getBoundingClientRect()),
      style: style(el), build: Number(el.dataset.build ?? 0),
      visual: Object.fromEntries(['data-icon','data-catalog-version','data-shape','aria-label'].map(k => [k, el.getAttribute(k) ?? '']).concat([['image', el.querySelector('img')?.getAttribute('src') ?? '']])),
    }));
    const parts = [...root.querySelectorAll<HTMLElement>('[data-content-part]')].map(el => {
      const owner = el.closest<HTMLElement>('[data-node]');
      if (!owner) throw new Error('Review text part is missing stable identity');
      const nodeId = owner.dataset.node!, key = `${nodeId}:${el.dataset.contentPart}`;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const leaves: {node: Text; start: number; end: number}[] = [];
      let text = '';
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        leaves.push({node, start:text.length, end:text.length+node.data.length});
        text += node.data;
      }
      const tokens = [...text.matchAll(/[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*|\s+|[^\p{L}\p{N}\p{M}\s]/gu)].map(match => {
        const start = match.index!, end = start + match[0].length;
        const selected = leaves.filter(l => l.start < end && l.end > start);
        const range = document.createRange();
        range.setStart(selected[0].node, start-selected[0].start);
        range.setEnd(selected.at(-1)!.node, end-selected.at(-1)!.start);
        return {text:match[0], start, end,
          rects:[...range.getClientRects()].filter(r => r.width > 0 && r.height > 0).map(rect),
          styles: [...new Set(selected.map(l => JSON.stringify(style(l.node.parentElement!))))],
        };
      });
      return {key,nodeId,text,tokens};
    });
    if (new Set(parts.map(p => p.key)).size !== parts.length) throw new Error('Duplicate stable review content part');
    if (nodes.length > 10000 || parts.reduce((n,p)=>n+p.tokens.length,0) > 20000) throw new Error('Review geometry limit exceeded');
    return {canvas:{width:1920,height:1080},nodes,parts};
  });
}
