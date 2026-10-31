import { SourceError, type Literal, type SourceNode } from '../contracts.js';
export interface SourcePatch { start: number; end: number; text: string }
export function escapeText(value: string) {
  return value.replace(/[&<>"'{}\r]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;', '{': '&#123;', '}': '&#125;', '\r': '&#13;' })[c]!);
}
export function attribute(value: Literal): string {
  return typeof value === 'string' ? `"${escapeText(value)}"` : `{${JSON.stringify(value)}}`;
}
export function setProp(node: SourceNode, key: string, value: Literal): SourcePatch {
  const range = node.attributes[key];
  return range ? { ...range, text: `${key}=${attribute(value)}` }
    : { start: node.start + node.tag.length + 1, end: node.start + node.tag.length + 1, text: ` ${key}=${attribute(value)}` };
}
export function setChildren(source: string, node: SourceNode, contents: string): SourcePatch {
  return node.closingStart !== undefined ? { start: node.openingEnd, end: node.closingStart, text: contents }
    : { start: node.openingEnd - 2, end: node.end, text: `>${contents}</${node.tag}>` };
}
export function applyPatches(source: string, patches: SourcePatch[]): string {
  const sorted = [...patches].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].start < sorted[i - 1].end)
    throw new SourceError('normalization_overlap', 'System source patches overlap');
  for (const patch of sorted.reverse()) source = source.slice(0, patch.start) + patch.text + source.slice(patch.end);
  return source;
}
