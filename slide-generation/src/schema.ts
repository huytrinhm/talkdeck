import { z } from 'zod';
import { SourceError, type SourceNode } from './contracts.js';
import { nodes, parseSource } from './parser.js';

export const textRoles = ['title', 'subtitle', 'heading', 'lead', 'body', 'caption', 'label', 'display', 'numeral'] as const;
export const textSteps = [...textRoles, 'stat', 'hero', 'quote'] as const;
export const spaceSteps = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
export const shapeKinds = ['disc', 'ring', 'blob', 'pill', 'arc', 'dots', 'grid', 'glow', 'sparkle'] as const;
export const slotKinds = ['headline', 'subtitle', 'kicker', 'heading', 'supporting', 'points', 'presenter', 'meta',
  'metric', 'hero-metric', 'quote', 'image', 'text', 'stat', 'bullets', 'any'] as const;
export const metadataTags = new Set('Deck Brief Theme Token Scale Frame Motif Library Layout Component Transcript Prompt SpeakerNotes Archive ArchivedSlide'.split(' '));
const str = z.string(), name = str.regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
const themeColor = str.regex(/^[a-z][a-z0-9-]*$/);
const step = z.enum(['none', ...spaceSteps]);
const align = z.enum(['start', 'center', 'end', 'stretch']);
const justify = z.enum(['start', 'center', 'end', 'between', 'around', 'evenly']);
const version = z.number().int().positive();
export const assetSchema = z.object({ id: str.min(1), version: str.min(1) }).strict();
const transform = z.object({ scale: z.union([z.literal(0.6), z.literal(0.8), z.literal(1), z.literal(1.2), z.literal(1.4), z.literal(1.6), z.literal(1.8)]).optional(),
  translate: z.tuple([z.number().min(-0.5).max(0.5), z.number().min(-0.5).max(0.5)]).optional() }).strict();
const base = { id: name.optional() };
const visual = { ...base, build: z.number().int().nonnegative().optional(), class: str.optional() };
const content = { ...visual, color: themeColor.optional(), transform: transform.optional() };
const layout = { ...visual, gap: step.optional(), align: align.optional(), justify: justify.optional(), grow: z.boolean().optional() };
const surface = { ...layout, fill: themeColor.optional(), pad: step.optional() };
const token = z.object({ ...base, name: str.regex(/^--(color|font|text|radius|shadow|spacing|tracking)-[a-z][a-z0-9-]*$/), value: str.min(1) }).strict().superRefine((p, ctx) => {
  let valid = !/[;{}<>]/.test(p.value) && p.name !== '--font-display';
  if (p.name.startsWith('--color-')) valid &&= /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(p.value);
  if (p.name.startsWith('--font-weight-')) valid &&= /^[1-9]00$/.test(p.value);
  if (p.name.startsWith('--tracking-')) valid &&= /^-?(?:\d+(?:\.\d+)?|\.\d+)em$/.test(p.value);
  if (!valid) ctx.addIssue({ code: 'custom', message: 'Invalid token name/value' });
});
const scaleMap = (keys: readonly string[]) => z.object(Object.fromEntries(keys.map(k => [k, z.number().finite().positive().optional()]))).strict();
const props: Record<string, z.ZodType> = {
  Deck: z.object({ ...base, version: version.optional(), nextId: version.optional() }).strict(),
  Brief: z.object(base).strict(), Theme: z.object({ ...base, font: assetSchema.optional() }).strict(), Token: token,
  Scale: z.object({ ...base, text: scaleMap(textSteps).optional(), space: scaleMap(spaceSteps).optional() }).strict(),
  Frame: z.object({ ...base, labels: z.object({ left: str.max(48).optional(), right: str.max(48).optional(), footer: str.max(64).optional() }).strict().optional(), rule: z.boolean().optional(), page: z.boolean().optional() }).strict(),
  Motif: z.object({ ...base, kinds: z.array(z.enum(shapeKinds)).min(1).max(2) }).strict(),
  Library: z.object(base).strict(),
  Layout: z.object({ ...base, name: str.regex(/^[A-Z][A-Za-z0-9]*$/), description: str, version: version.optional() }).strict(),
  Component: z.object({ ...base, name: str.regex(/^[A-Z][A-Za-z0-9]*$/), description: str, version: version.optional() }).strict(),
  Slide: z.object({ ...surface, version: version.optional(), frame: z.boolean().optional(), freeForm: z.object({ reason: str.trim().min(1) }).strict().optional() }).strict(),
  Transcript: z.object(base).strict(),
  Prompt: z.object({ ...base, mode: z.enum(['add', 'edit', 'correction']).optional(), utteranceId: str.min(1).optional(), correctionOf: str.min(1).optional(), deliveredAtMs: z.number().finite().nonnegative().optional() }).strict(),
  SpeakerNotes: z.object(base).strict(), Archive: z.object(base).strict(),
  ArchivedSlide: z.object({ ...base, slideId: name, version: version.optional() }).strict(),
  Stack: z.object(layout).strict(), Row: z.object({ ...layout, wrap: z.boolean().optional() }).strict(),
  Grid: z.object({ ...visual, cols: z.number().int().min(2).max(6), gap: step.optional(), grow: z.boolean().optional() }).strict(),
  Split: z.object({ ...visual, ratio: z.enum(['1:1', '2:1', '1:2', '3:2', '2:3']).optional(), gap: step.optional(), align: align.optional(), grow: z.boolean().optional() }).strict(),
  Center: z.object({ ...visual, gap: step.optional() }).strict(), Spacer: z.object({ ...base, build: visual.build }).strict(),
  Panel: z.object({ ...surface, variant: z.enum(['fill', 'outline', 'ghost']).optional(), radius: z.enum(['none', 'md', 'lg']).optional() }).strict(),
  Band: z.object(surface).strict(),
  Text: z.object({ ...content, role: z.enum(textRoles).optional(), align: z.enum(['left', 'center', 'right']).optional() }).strict(),
  Stat: z.object({ ...content, value: str, label: str.optional(), size: z.enum(['normal', 'hero']).optional(), align: z.enum(['left', 'center', 'right']).optional() }).strict(),
  Bullets: z.object({ ...content, marker: z.enum(['disc', 'number', 'dash', 'none']).optional(), size: z.enum(['body', 'lead']).optional() }).strict(),
  Quote: z.object({ ...content, by: str.optional() }).strict(),
  Image: z.object({ ...content, alt: str, asset: assetSchema }).strict(),
  Icon: z.object({ ...content, name: str.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), catalogVersion: str.min(1), alt: str }).strict(),
  Rule: z.object({ ...visual, color: themeColor.optional(), length: z.enum(['short', 'full', 'bleed']).optional(), weight: z.enum(['bold', 'hair']).optional(), orient: z.enum(['h', 'v']).optional() }).strict(),
  Badge: z.object({ ...content, fill: themeColor.optional() }).strict(),
  Shape: z.object({ ...visual, kind: z.enum(shapeKinds), fill: themeColor.optional(), at: z.enum(['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br']).optional(), size: z.enum(['sm', 'md', 'lg', 'xl']).optional(), bleed: z.boolean().optional(), opacity: z.enum(['faint', 'soft', 'solid']).optional() }).strict(),
  Pending: z.object({ ...visual, kind: str.min(1) }).strict(),
  Slot: z.object({ ...base, name, kind: z.enum(slotKinds).optional(), role: z.enum(textRoles).optional(), optional: z.boolean().optional(), accepts: z.array(name).min(1).optional() }).strict(),
  Each: z.object({ ...visual, slot: name, kind: z.enum(slotKinds), min: z.number().int().nonnegative().optional(), max: z.number().int().positive().max(64).optional() }).strict(),
  Item: z.object(visual).strict(),
  Index: z.object({ ...visual, size: z.enum(['label', 'caption', 'body', 'heading', 'numeral']).optional(), look: z.enum(['plain', 'circle', 'pill']).optional(), color: themeColor.optional() }).strict(),
};
export const primitiveSchemas = props;
export const allowedClasses = new Set([
  'flex', 'flex-col', 'flex-row', 'grid', 'flex-wrap', 'flex-nowrap', 'grow', 'shrink-0', 'min-w-0', 'min-h-0',
  'items-start', 'items-center', 'items-end', 'items-stretch', 'justify-start', 'justify-center', 'justify-end', 'justify-between',
  'self-start', 'self-center', 'self-end', 'w-full', 'h-full', 'relative', 'rounded-none', 'rounded-md', 'rounded-lg',
  ...[2, 3, 4, 5, 6].map(n => `grid-cols-${n}`),
  ...['gap', 'p', 'px', 'py', 'pt', 'pb', 'pl', 'pr'].flatMap(p => ['none', ...spaceSteps].map(s => `${p}-${s}`)),
]);
export const childNodes = (node: SourceNode) => node.children.filter((c): c is SourceNode => typeof c !== 'string');
function error(node: SourceNode, message: string): never { throw new SourceError('schema', message, node.id, { start: node.start, end: node.end }); }
const noChildren = new Set('Token Scale Frame Motif Spacer Stat Image Icon Rule Shape Pending Item Index'.split(' '));
const textChildren = new Set('Brief Prompt SpeakerNotes Text Quote Badge'.split(' '));
const envelopeChildren: Record<string, string[]> = {
  Deck: ['Brief', 'Theme', 'Library', 'Slide', 'Archive'], Theme: ['Token', 'Scale', 'Frame', 'Motif'],
  Library: ['Layout', 'Component'], Transcript: ['Prompt'], Archive: ['ArchivedSlide'], ArchivedSlide: ['Transcript', 'SpeakerNotes'],
};
export interface SchemaOptions {
  /** Presence is not availability: callers must resolve the exact pinned catalog. */
  resolveIcon?: (name: string, catalogVersion: string) => unknown;
}
export function validateStructure(root: SourceNode, options: SchemaOptions = {}): void {
  const definitions = new Map([...nodes(root)].filter(n => ['Layout', 'Component'].includes(n.tag)).map(n => [String(n.props.name), n]));
  function visit(node: SourceNode, parent?: SourceNode, definition?: SourceNode, visualDepth = 0, insideEach = false) {
    const def = ['Layout', 'Component'].includes(node.tag) ? node : definition;
    const isVisual = !metadataTags.has(node.tag) && !['Slot', 'Each', 'Item'].includes(node.tag);
    const depth = isVisual ? visualDepth + 1 : visualDepth;
    if (depth > 6) error(node, 'Authored visual depth exceeds six');
    const schema = props[node.tag] ?? z.object(visual).strict();
    const parsed = schema.safeParse(node.props);
    if (!parsed.success) error(node, `${node.tag}: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    if (node.props.class !== undefined && (!def || String(node.props.class).split(/\s+/).filter(Boolean).some(c => !allowedClasses.has(c)))) error(node, 'Class requires a definition and explicit allowed utilities');
    const children = childNodes(node), nonWhitespace = node.children.some(c => typeof c === 'string' && c.trim().length > 0);
    if (noChildren.has(node.tag) && (children.length || nonWhitespace)) error(node, `${node.tag} cannot have children`);
    if (textChildren.has(node.tag) && children.length) error(node, `${node.tag} accepts literal text only`);
    if (!textChildren.has(node.tag) && nonWhitespace) error(node, `${node.tag} does not accept text children`);
    if (envelopeChildren[node.tag] && children.some(c => !envelopeChildren[node.tag].includes(c.tag))) error(node, `Invalid child of ${node.tag}`);
    if (metadataTags.has(node.tag) && parent && !envelopeChildren[parent.tag]?.includes(node.tag) && !(parent.tag === 'Slide' && ['Transcript', 'SpeakerNotes'].includes(node.tag))) error(node, `Invalid placement of ${node.tag}`);
    if (node.tag === 'Deck') {
      for (const tag of ['Brief', 'Theme', 'Library', 'Archive']) if (children.filter(c => c.tag === tag).length !== 1) error(node, `Deck requires exactly one ${tag}`);
      if (!children.some(c => c.tag === 'Slide')) error(node, 'Deck requires at least one Slide');
    }
    if (node.tag === 'Theme') {
      for (const tag of ['Scale', 'Frame', 'Motif']) if (children.filter(c => c.tag === tag).length > 1) error(node, `Duplicate ${tag}`);
      const tokens = children.filter(c => c.tag === 'Token').map(c => c.props.name);
      if (new Set(tokens).size !== tokens.length) error(node, 'Duplicate theme token');
      for (const name of ['bg', 'fg', 'accent', 'accent-fg']) if (!tokens.includes(`--color-${name}`)) error(node, `Missing --color-${name}`);
    }
    if (node.tag === 'Slide') {
      if (parent?.tag !== 'Deck' && !(parent?.tag === 'Layout')) error(node, 'Slide must be in Deck or be the Layout root');
      const visualChildren = children.filter(c => !metadataTags.has(c.tag));
      if (!def) {
        for (const tag of ['Transcript', 'SpeakerNotes']) if (children.filter(c => c.tag === tag).length !== 1) error(node, `Slide requires exactly one ${tag}`);
        const layoutInstances = visualChildren.filter(c => definitions.get(c.tag)?.tag === 'Layout');
        if (layoutInstances.length ? visualChildren.length !== 1 : !node.props.freeForm) error(node, 'Use one Layout instance or supply a persistent freeForm reason');
      } else if (children.some(c => metadataTags.has(c.tag))) error(node, 'Definition Slide cannot contain source evidence');
      if (children.filter(c => c.tag === 'Shape').length > 2) error(node, 'Slide permits at most two Shapes');
    }
    if (node.tag === 'ArchivedSlide') for (const tag of ['Transcript', 'SpeakerNotes']) if (children.filter(c => c.tag === tag).length !== 1) error(node, `Archive requires ${tag}`);
    if (node.tag === 'Shape' && parent?.tag !== 'Slide') error(node, 'Shape must be directly in Slide');
    if (node.tag === 'Rule' && node.props.length === 'bleed' && parent?.tag !== 'Slide') error(node, 'Bleed Rule must be directly in Slide');
    if (node.tag === 'Split' && children.length !== 2) error(node, 'Split requires two children');
    if (node.tag === 'Bullets' && children.some(c => c.tag !== 'Text')) error(node, 'Bullets accepts Text items only');
    if (['Layout', 'Component'].includes(node.tag)) {
      if (children.length !== 1 || metadataTags.has(children[0].tag)) error(node, 'Definition requires one visual root');
      if (node.tag === 'Layout' && children[0].tag !== 'Slide') error(node, 'Layout root must be Slide');
      if (node.tag === 'Component' && children[0].tag === 'Slide') error(node, 'Component cannot contain Slide');
    }
    if (def && (textChildren.has(node.tag) && nonWhitespace || node.tag === 'Stat')) error(node, 'Definitions cannot contain user content; use slots');
    if (definitions.get(node.tag)?.tag === 'Layout' && parent?.tag !== 'Slide') error(node, 'Layout instance must be the slide visual child');
    if (definitions.has(node.tag) && children.some(c => c.tag !== 'Slot')) error(node, 'Instance children must be named Slot bindings');
    if (node.tag === 'Slot') {
      const binding = !!parent && definitions.has(parent.tag);
      if (!def && !binding) error(node, 'Slot must be a declaration or instance binding');
      if (binding ? children.length !== 1 : children.length !== 0) error(node, binding ? 'Slot binding requires one child' : 'Slot declaration has no children');
      if (!binding && !node.props.kind) error(node, 'Slot declaration requires kind');
      if (binding && ['kind', 'role', 'optional', 'accepts'].some(k => node.props[k] !== undefined)) error(node, 'Slot styling belongs to its declaration');
    }
    if (node.tag === 'Each') {
      const ownItems = (current: SourceNode): number => childNodes(current).reduce((count, child) =>
        count + (child.tag === 'Each' ? 0 : child.tag === 'Item' ? 1 : ownItems(child)), 0);
      if (ownItems(node) !== 1) error(node, 'Each requires exactly one Item placeholder');
    }
    if (node.tag === 'Each' && (!def || children.length !== 1 || Number(node.props.min ?? 0) > Number(node.props.max ?? 8))) error(node, 'Each requires a definition, one wrapper, and min <= max');
    if (['Item', 'Index'].includes(node.tag) && !insideEach) error(node, `${node.tag} requires Each`);
    if (node.tag === 'Icon') {
      if (!options.resolveIcon) throw new SourceError('icons_unavailable', 'Pinned Lucide catalog is not installed', node.id);
      options.resolveIcon(String(node.props.name), String(node.props.catalogVersion));
    }
    for (const child of children) visit(child, node, def, ['Layout', 'Component'].includes(node.tag) ? 0 : depth, insideEach || node.tag === 'Each');
  }
  visit(root);
}
export function parseAndValidate(source: string, options?: SchemaOptions) { const root = parseSource(source); validateStructure(root, options); return root; }
