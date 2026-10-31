import type { Finding } from '../contracts.js';
import { apcaContrast, blend, requiredLc } from '../render/contrast.js';
import type { Rect, SlideMeasurement, TextRun } from './types.js';

export const CHECK_POLICY_VERSION = 'browser-checks-v1';
// Spec floors, measured after content zoom. Viewer-fit scaling never enters these values.
const floors: Record<string, number> = { label: 20, caption: 24, body: 32, lead: 36, subtitle: 36,
  heading: 44, quote: 44, title: 72, stat: 112, numeral: 128, display: 144, hero: 180 };
const right = (r: Rect) => r.x + r.width, bottom = (r: Rect) => r.y + r.height;
export function overflow(inner: Rect, outer: Rect) {
  return Math.max(0, outer.x - inner.x, outer.y - inner.y, right(inner) - right(outer), bottom(inner) - bottom(outer));
}
export function intersectionArea(a: Rect, b: Rect) {
  return Math.max(0, Math.min(right(a), right(b)) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y));
}
function lineCount(runs: TextRun[]) {
  // Font glyph bounds can overlap adjacent CSS line boxes (e.g. Noto at line-height
  // 1.2). Cluster centers, not any intersecting vertical bands, so real wraps remain
  // visible while differently sized inline runs on the same baseline stay together.
  const lines: { center: number; height: number }[] = [];
  for (const rect of runs.flatMap(r => r.rects).filter(r => r.width > 0 && r.height > 0).sort((a,b) => a.y - b.y)) {
    const center = rect.y + rect.height / 2;
    const line = lines.find(l => Math.abs(l.center - center) < Math.min(l.height, rect.height) / 2);
    if (!line) lines.push({ center, height: rect.height });
  }
  return lines.length;
}

export function evaluateMeasurement(measured: SlideMeasurement): Finding[] {
  const findings: Finding[] = [];
  const add = (check: string, nodeId: string, subject: string, magnitude: number, message: string, suggestion: string) => {
    if (!Number.isFinite(magnitude) || magnitude < 0) throw new Error('Invalid browser measurement magnitude');
    findings.push({ check, slideId: measured.slideId, nodeId, subject, severity: 'error', magnitude, message, suggestion });
  };
  for (const node of measured.nodes) {
    if (node.bleed) continue;
    const excess = overflow(node.rect, measured.canvas);
    if (excess > 2) add('overflow', node.authoredId ?? node.id, `canvas:${node.id}`, excess, `Node extends ${excess.toFixed(2)}px beyond the canvas`, 'Reduce occupied content or adjust the composition within the canvas.');
  }
  for (const text of measured.texts) {
    if (!(text.role in floors)) throw new Error(`Missing font-floor policy for text role ${text.role}`);
    const floor = Math.max(text.role === 'display' ? measured.displayFloor : floors[text.role], text.onSurface ? 20 : 0);
    if (text.fontPx + .01 < floor) add('text-size', text.nodeId, text.id, floor - text.fontPx,
      `${text.role} is ${text.fontPx.toFixed(2)}px; effective minimum is ${floor}px`, 'Normalize typography after cumulative scaling.');
    const tolerance = .3 * text.fontPx;
    for (const bound of [...text.bounds, { id: 'canvas', rect: measured.canvas }]) {
      const excess = Math.max(0, ...text.rects.map(r => overflow(r, bound.rect)));
      if (excess > tolerance) add('overflow', text.nodeId, `${text.id}:bound:${bound.id}`, excess - tolerance,
        `Text exceeds ${bound.id} by ${excess.toFixed(2)}px (allowance ${tolerance.toFixed(2)}px)`, 'Use a larger text box or a composition that fits the complete wording.');
    }
    if (!text.backgrounds.length) throw new Error(`No composited background measured for ${text.id}`);
    const threshold = requiredLc(text.fontPx, text.fontWeight >= 700);
    let lowest = Infinity;
    for (const bg of text.backgrounds) lowest = Math.min(lowest, Math.abs(apcaContrast(blend(text.color, text.alpha, bg), bg)));
    if (lowest + .01 < threshold) add('contrast', text.nodeId, text.id, threshold - lowest,
      `Text APCA |Lc| ${lowest.toFixed(2)} is below ${threshold}`, 'Choose a readable theme foreground for the actual underlying fill.');
  }
  const stats = new Map<string, TextRun[]>();
  for (const text of measured.texts) if (text.statId) stats.set(text.statId, [...stats.get(text.statId) ?? [], text]);
  for (const [id, runs] of stats) {
    const lines = lineCount(runs);
    if (lines > 1) add('stat-wrap', runs[0].nodeId, `stat:${id}`, lines - 1, `Stat value occupies ${lines} lines`, 'Give the complete Stat value more horizontal space.');
  }
  // Runs are leaf text nodes, so ancestors never duplicate a descendant's words.
  for (let i = 0; i < measured.texts.length; i++) for (let j = i + 1; j < measured.texts.length; j++) {
    const ordered = [measured.texts[i], measured.texts[j]].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const [a, b] = ordered;
    const area = a.rects.reduce((sum, ar) => sum + b.rects.reduce((s, br) => s + intersectionArea(ar, br), 0), 0);
    if (area > .01) add('overlap', a.nodeId, `${a.id}:with:${b.id}`, area,
      `Distinct text runs ${a.id} and ${b.id} overlap by ${area.toFixed(2)}px²`, 'Separate the content boxes or change the composition.');
  }
  for (const overlap of measured.shapeIntersections) if (overlap.pixels > 0) add('shape-under', overlap.nodeId,
    `${overlap.textId}:shape:${overlap.shapeId}`, overlap.pixels,
    `Solid Shape ${overlap.shapeId} lies beneath ${overlap.pixels} native text pixels`, 'Move the Shape away from content text or explicitly choose a non-solid decoration.');
  return findings;
}
