import { SourceError, type SourceNode } from '../contracts.js';
import { expandSource, type ExpandedNode } from '../expansion.js';
import { nodes, parseSource } from '../parser.js';
import { childNodes } from '../schema.js';
import { allocateIds } from '../source/candidate.js';
import { applyPatches, setProp } from '../source/surgery.js';
import { APCA_VERSION, apcaContrast, blend, parseHex, type RGB } from './contrast.js';
import { readIcon } from './icons.js';

export const TEXT_FLOORS: Record<string, number> = { title: 72, subtitle: 36, heading: 44, lead: 36, body: 32, caption: 24, label: 20, stat: 112, hero: 180, quote: 44, display: 144, numeral: 128 };
export const DEFAULT_TEXT: Record<string, number> = { title: 88, subtitle: 44, heading: 56, lead: 40, body: 32, caption: 24, label: 20, stat: 128, hero: 220, quote: 56, display: 200, numeral: 160 };
export const DEFAULT_SPACE: Record<string, number> = { none: 0, xs: 12, sm: 24, md: 40, lg: 64, xl: 96 };
export interface Theme {
  colors: Record<string, string>; text: Record<string, number>; space: Record<string, number>; tokens: Record<string, string>;
  derived: string[]; frame?: SourceNode; font?: { id: string; version: string }; motif: string[];
}
const hex = (rgb: RGB) => '#' + rgb.map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
function rotateHue(input: string, degrees: number) {
  const rgb = parseHex(input).map(c => c / 255), max = Math.max(...rgb), min = Math.min(...rgb), chroma = max - min;
  if (!chroma) return input;
  let h = max === rgb[0] ? (rgb[1] - rgb[2]) / chroma : max === rgb[1] ? (rgb[2] - rgb[0]) / chroma + 2 : (rgb[0] - rgb[1]) / chroma + 4;
  h = ((h * 60 + degrees) % 360 + 360) % 360 / 60;
  const x = chroma * (1 - Math.abs(h % 2 - 1));
  const pairs = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]];
  return hex(pairs[Math.floor(h)].map(c => (c + min) * 255) as RGB);
}
export function resolveTheme(source: string): Theme {
  const root = parseSource(source), theme = childNodes(root).find(n => n.tag === 'Theme')!;
  const tokens = Object.fromEntries(childNodes(theme).filter(n => n.tag === 'Token').map(n => [String(n.props.name), String(n.props.value)]));
  const colors: Record<string, string> = Object.fromEntries(Object.entries(tokens).filter(([k]) => k.startsWith('--color-')).map(([k, v]) => [k.slice(8), hex(parseHex(v))]));
  for (const name of ['bg', 'fg', 'accent', 'accent-fg']) if (!colors[name]) throw new SourceError('theme', `Missing color ${name}`, theme.id);
  const derived: string[] = [];
  const seeds = { muted: hex(blend(parseHex(colors.bg), .35, parseHex(colors.fg))), 'bg-alt': hex(blend(parseHex(colors.fg), .05, parseHex(colors.bg))), 'accent-2': rotateHue(colors.accent, 150), inverse: colors.fg };
  const textColors = [...new Set([colors.fg, ...Object.entries(colors).filter(([k]) => k.endsWith('-fg')).map(([,v]) => v)])];
  for (const [name, seed] of Object.entries(seeds)) if (!colors[name]) {
    let chosen: { fill: string; fg: string; change: number; lc: number } | undefined;
    for (let amount = 0; amount <= 255 && !chosen; amount++) {
      for (const endpoint of [[0,0,0], [255,255,255]] as RGB[]) {
        const fill = hex(blend(endpoint, amount / 255, parseHex(seed)));
        for (const fg of colors[`${name}-fg`] ? [colors[`${name}-fg`]] : textColors) {
          const lc = Math.abs(apcaContrast(parseHex(fg), parseHex(fill)));
          if (lc >= 60 && (!chosen || lc > chosen.lc)) chosen = { fill, fg, change: amount, lc };
        }
      }
    }
    if (!chosen) throw new SourceError('theme_contrast', `Cannot derive readable ${name}`, theme.id);
    colors[name] = chosen.fill; colors[`${name}-fg`] = colors[`${name}-fg`] ?? chosen.fg; derived.push(name);
  }
  const scale = childNodes(theme).find(n => n.tag === 'Scale');
  const text = { ...DEFAULT_TEXT, ...scale?.props.text as Record<string, number> | undefined };
  for (const [role, floor] of Object.entries(TEXT_FLOORS)) text[role] = Math.max(text[role], floor);
  text.display = Math.max(text.display, 144, 1.5 * text.title);
  const space = { ...DEFAULT_SPACE, ...scale?.props.space as Record<string, number> | undefined };
  return { colors, text, space, tokens, derived, frame: childNodes(theme).find(n => n.tag === 'Frame'),
    font: theme.props.font as Theme['font'], motif: (childNodes(theme).find(n => n.tag === 'Motif')?.props.kinds as string[] | undefined) ?? [] };
}
export function color(theme: Theme, name: string, nodeId?: string) {
  if (!theme.colors[name]) throw new SourceError('theme_color', `Unknown theme color ${name}`, nodeId);
  return theme.colors[name];
}
export function foreground(theme: Theme, fill: string, nodeId?: string) {
  return color(theme, fill === 'bg' ? 'fg' : `${fill}-fg`, nodeId);
}
export function textRole(node: ExpandedNode, inCard = false, inheritedListRole?: string): string | undefined {
  if (node.tag === 'Text') return inheritedListRole ?? String(node.props.role ?? 'body');
  if (node.tag === 'Stat') return node.props.size === 'hero' ? 'hero' : 'stat';
  if (node.tag === 'Quote') return 'quote';
  if (node.tag === 'Badge') return 'label';
  if (node.tag === 'Index') return String(node.props.size ?? 'label');
  if (node.tag === 'Bullets') return String(node.props.size ?? (!inCard && childNodes(node).length <= 3 ? 'lead' : 'body'));
  return undefined;
}
/** Stored scale is the actual base size needed after cumulative zoom. No words are changed. */
export function normalizeTypography(source: string): string {
  const expanded = expandSource(source, { resolveIcon: readIcon });
  source = expanded.source;
  const theme = resolveTheme(source), required = { ...theme.text };
  const minScale: Record<string, number> = {};
  const use = (role: string, scale: number) => { minScale[role] = Math.min(minScale[role] ?? Infinity, scale); };
  function visit(node: ExpandedNode, scale = 1, inCard = false, listRole?: string) {
    const transform = node.props.transform as { scale?: number } | undefined;
    scale *= transform?.scale ?? 1;
    const role = textRole(node, inCard, listRole);
    if (role) use(role, scale);
    if (node.tag === 'Stat' && node.props.label || node.tag === 'Quote' && node.props.by) use('caption', scale);
    const nextCard = inCard || ['Panel', 'Band'].includes(node.tag);
    for (const child of node.children) if (typeof child !== 'string') visit(child, scale, nextCard, node.tag === 'Bullets' ? role : undefined);
  }
  expanded.slides.forEach(s => visit(s));
  for (const [role, scale] of Object.entries(minScale)) required[role] = Math.max(required[role], TEXT_FLOORS[role] / scale);
  required.display = Math.max(required.display, Math.max(144, 1.5 * required.title) / (minScale.display ?? 1));
  for (const key of Object.keys(required)) required[key] = Math.ceil(required[key] * 1000) / 1000;
  const root = parseSource(source), themeNode = childNodes(root).find(n => n.tag === 'Theme')!, scaleNode = childNodes(themeNode).find(n => n.tag === 'Scale');
  if (scaleNode) {
    const stored = scaleNode.props.text as Record<string, number> | undefined ?? {};
    if (Object.entries(required).every(([key,value]) => stored[key] === value)) return source;
    return applyPatches(source, [setProp(scaleNode, 'text', required)]);
  }
  if (themeNode.closingStart === undefined) throw new SourceError('theme', 'Theme must contain required colors', themeNode.id);
  const at = themeNode.closingStart;
  return allocateIds(source.slice(0, at) + `<Scale text={${JSON.stringify(required)}} />` + source.slice(at)).source;
}
export function paletteReport(source: string) {
  const theme = resolveTheme(source);
  return { policy: APCA_VERSION, colors: theme.colors, derived: theme.derived, surfaces: Object.entries(theme.colors)
    .filter(([name]) => name === 'bg' || !!theme.colors[`${name}-fg`]).map(([fill, value]) => {
      const fg = foreground(theme, fill), lc = apcaContrast(parseHex(fg), parseHex(value));
      return { fill, foreground: fg, lc, largeTextReadable: Math.abs(lc) >= 45, bodyReadable: Math.abs(lc) >= 60 };
    }) };
}
