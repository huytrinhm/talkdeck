import { SourceError, type Literal, type SourceNode } from './contracts.js';
import { nodes } from './parser.js';
import { childNodes, metadataTags, parseAndValidate, type SchemaOptions } from './schema.js';
import { applyPatches, setProp } from './source/surgery.js';

export interface Origin { authoredId: string; definitionId?: string; instanceId?: string; itemId?: string }
export interface ExpandedNode extends Omit<SourceNode, 'children'> { id: string; children: (ExpandedNode | string)[]; origin: Origin }
export interface LibraryEntry { id: string; name: string; category: 'Layout' | 'Component'; description: string; version: number; shape: string; dependentSlides: string[] }
export interface Expansion {
  source: string; slides: ExpandedNode[]; pendingNodeIds: string[]; library: LibraryEntry[];
  normalizations: { nodeId: string; key: string; value: Literal }[];
}
interface SlotRule { accepts: string[]; role?: string; size?: string }
const rules: Record<string, SlotRule> = {
  headline: { accepts: ['Text'], role: 'title' }, subtitle: { accepts: ['Text'], role: 'subtitle' },
  kicker: { accepts: ['Text', 'Badge'], role: 'label' }, heading: { accepts: ['Text'], role: 'heading' },
  supporting: { accepts: ['Text', 'Bullets'], role: 'body' }, points: { accepts: ['Text', 'Bullets'], role: 'body' },
  presenter: { accepts: ['Text'], role: 'body' }, meta: { accepts: ['Text'], role: 'caption' },
  metric: { accepts: ['Stat'], size: 'normal' }, 'hero-metric': { accepts: ['Stat'], size: 'hero' },
  quote: { accepts: ['Quote'] }, image: { accepts: ['Image'] }, text: { accepts: ['Text'] },
  stat: { accepts: ['Stat'] }, bullets: { accepts: ['Bullets'] }, any: { accepts: ['*'] },
};
function refuse(node: SourceNode, message: string): never { throw new SourceError('reference', message, node.id, { start: node.start, end: node.end }); }
function declarations(definition: SourceNode, definitions: Map<string, SourceNode>) {
  const result: SourceNode[] = [];
  function walk(node: SourceNode, parent?: SourceNode) {
    const binding = node.tag === 'Slot' && !!parent && definitions.has(parent.tag);
    if (node.tag === 'Each' || node.tag === 'Slot' && !binding) result.push(node);
    for (const child of childNodes(node)) walk(child, node);
  }
  walk(definition);
  const names = result.map(n => String(n.props[n.tag === 'Each' ? 'slot' : 'name']));
  if (new Set(names).size !== names.length) refuse(definition, 'Duplicate slot declaration');
  return result;
}
export function expandSource(source: string, options: SchemaOptions = {}): Expansion {
  const root = parseAndValidate(source, options);
  if ([...nodes(root)].some(n => !n.id)) throw new SourceError('expansion_identity', 'Allocate authored IDs before expansion');
  const definitions = new Map([...nodes(root)].filter(n => ['Layout', 'Component'].includes(n.tag)).map(n => [String(n.props.name), n]));
  const slots = new Map([...definitions].map(([name, def]) => [name, declarations(def, definitions)]));
  const dependencies = new Map([...definitions].map(([name, def]) => [name, new Set([...nodes(def)].filter(n => definitions.has(n.tag)).map(n => n.tag))]));
  function closure(name: string, path: string[] = []): Set<string> {
    if (path.includes(name)) refuse(definitions.get(name)!, `Definition cycle: ${[...path, name].join(' -> ')}`);
    if (path.length >= 6) refuse(definitions.get(name)!, 'Definition nesting exceeds six');
    return new Set([name, ...[...dependencies.get(name)!].flatMap(child => [...closure(child, [...path, name])])]);
  }
  const transitive = new Map([...definitions.keys()].map(name => [name, closure(name)]));
  const shapes = new Map<string, string>();
  const library: LibraryEntry[] = [...definitions].map(([name, def]) => {
    const shape = JSON.stringify(slots.get(name)!.map(n => ({ kind: n.props.kind,
      count: n.tag === 'Each' ? [n.props.min ?? 0, n.props.max ?? 8] : [n.props.optional ? 0 : 1, 1] }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    if (def.tag === 'Layout' && shapes.has(shape)) refuse(def, `Equivalent layout slot shape: ${shapes.get(shape)}`);
    if (def.tag === 'Layout') shapes.set(shape, name);
    return { id: def.id!, name, category: def.tag as 'Layout' | 'Component', description: String(def.props.description),
      version: Number(def.props.version ?? 1), shape, dependentSlides: [] };
  });
  const pendingNodeIds: string[] = [], normalizationMap = new Map<string, { node: SourceNode; key: string; value: Literal }>();
  function normalize(node: SourceNode, key: string, value: Literal) {
    if (node.props[key] === value) return;
    const identity = `${node.id}:${key}`, previous = normalizationMap.get(identity);
    if (previous && previous.value !== value) refuse(node, 'Conflicting slot styling for reused content');
    normalizationMap.set(identity, { node, key, value });
  }
  const authored = (node: SourceNode): ExpandedNode => ({ ...node, id: node.id!, children: [], origin: { authoredId: node.id! } });
  interface Context { path: string; definition: SourceNode; instance: SourceNode; bindings: Map<string, ExpandedNode[]>; item?: ExpandedNode; index?: number }
  function structural(node: SourceNode, ctx?: Context): ExpandedNode {
    if (!ctx) return authored(node);
    const id = `@${ctx.path}:${node.id}`;
    return { ...node, id, props: { ...node.props, id }, children: [], origin: { authoredId: ctx.instance.id!, definitionId: node.id!, instanceId: ctx.instance.id!, itemId: ctx.item?.id } };
  }
  function pending(node: SourceNode, ctx: Context, index = 0): ExpandedNode {
    const result = structural(node, ctx);
    result.id += `:pending:${index}`; result.tag = 'Pending'; result.props = { id: result.id, kind: node.props.kind ?? 'any' };
    pendingNodeIds.push(result.id); return result;
  }
  function styleSlot(declaration: SourceNode, content: ExpandedNode): ExpandedNode {
    const rule = rules[String(declaration.props.kind)] ?? rules.any;
    const accepts = declaration.props.accepts as string[] | undefined ?? rule.accepts;
    if (!accepts.includes('*') && !accepts.includes(content.tag)) refuse(declaration, `Slot expects ${accepts.join('/')} but received ${content.tag}`);
    const role = String(declaration.props.role ?? rule.role ?? '');
    const styled = { ...content, props: { ...content.props } };
    const set = (key: string, value: string) => {
      styled.props[key] = value;
      if (!content.id.startsWith('@')) normalize(content, key, value);
    };
    if (content.tag === 'Text' && role) set('role', role);
    if (content.tag === 'Bullets' && role) {
      if (!['body', 'lead'].includes(role)) refuse(declaration, 'Bullets slot role must be body or lead');
      set('size', role);
    }
    if (content.tag === 'Stat' && rule.size) set('size', rule.size);
    return styled;
  }
  function expand(node: SourceNode, ctx?: Context): ExpandedNode[] {
    if (metadataTags.has(node.tag)) return [];
    if (node.tag === 'Slot') {
      if (!ctx) refuse(node, 'Unbound Slot');
      const supplied = ctx.bindings.get(String(node.props.name)) ?? [];
      if (supplied.length > 1) refuse(node, 'Slot accepts only one item');
      return supplied.length ? [styleSlot(node, supplied[0])] : node.props.optional ? [] : [pending(node, ctx)];
    }
    if (node.tag === 'Each') {
      if (!ctx) refuse(node, 'Unbound Each');
      const supplied = ctx.bindings.get(String(node.props.slot)) ?? [];
      const minimum = Number(node.props.min ?? 0), maximum = Number(node.props.max ?? 8);
      if (supplied.length > maximum) refuse(node, `Each permits at most ${maximum} items`);
      const items = [...supplied];
      while (items.length < minimum) items.push(pending(node, ctx, items.length));
      return items.flatMap((item, i) => expand(childNodes(node)[0], { ...ctx,
        path: `${ctx.path}:${node.id}:item:${item.id}`, item: item.tag === 'Pending' ? item : styleSlot(node, item), index: i + 1 })
        .map(wrapper => ({ ...wrapper, props: { ...wrapper.props, build: Math.max(Number(node.props.build ?? 0), Number(wrapper.props.build ?? 0)) } })));
    }
    if (node.tag === 'Item') {
      if (!ctx?.item) refuse(node, 'Item has no repeated content');
      return [{ ...ctx.item, props: { ...ctx.item.props, build: Math.max(Number(node.props.build ?? 0), Number(ctx.item.props.build ?? 0)) } }];
    }
    if (node.tag === 'Index') {
      const result = structural(node, ctx); result.props = { ...result.props, value: ctx?.index ?? 1 }; return [result];
    }
    const definition = definitions.get(node.tag);
    if (definition) {
      const bindings = new Map<string, ExpandedNode[]>();
      const allowed = new Set(slots.get(node.tag)!.map(n => String(n.props[n.tag === 'Each' ? 'slot' : 'name'])));
      for (const binding of childNodes(node)) {
        const name = String(binding.props.name);
        if (!allowed.has(name)) refuse(binding, `Unknown slot ${name} in ${node.tag}`);
        const values = childNodes(binding).flatMap(child => expand(child, ctx));
        bindings.set(name, [...bindings.get(name) ?? [], ...values]);
      }
      const instance = structural(node, ctx);
      const inner: Context = { path: ctx ? `${ctx.path}:${node.id}` : node.id!, definition, instance, bindings };
      const result = expand(childNodes(definition)[0], inner);
      if (result.length !== 1) refuse(definition, 'Expanded definition must have one visual root');
      // Instance build gates the complete expanded subtree, including unmarked descendants.
      if (node.props.build !== undefined) result[0] = { ...result[0], props: { ...result[0].props, build: Math.max(Number(node.props.build), Number(result[0].props.build ?? 0)) } };
      if (node.props.class) result[0] = { ...result[0], props: { ...result[0].props, class: [result[0].props.class, node.props.class].filter(Boolean).join(' ') } };
      return result;
    }
    const result = structural(node, ctx);
    result.children = node.children.flatMap<string | ExpandedNode>(child => typeof child === 'string' ? [child] : expand(child, ctx));
    return [result];
  }
  const slides = childNodes(root).filter(n => n.tag === 'Slide').map(slide => {
    const content = childNodes(slide).filter(n => !metadataTags.has(n.tag));
    const used = new Set([...nodes(slide)].filter(n => definitions.has(n.tag)).flatMap(n => [...transitive.get(n.tag)!]));
    for (const entry of library) if (used.has(entry.name)) entry.dependentSlides.push(slide.id!);
    if (content.length === 1 && definitions.get(content[0].tag)?.tag === 'Layout') {
      const result = expand(content[0])[0];
      return { ...result, id: slide.id!, props: { ...result.props, id: slide.id!, build: Math.max(Number(slide.props.build ?? 0), Number(result.props.build ?? 0)) } };
    }
    return expand(slide)[0];
  });
  const identities = new Set<string>();
  function checkExpanded(node: ExpandedNode, depth: number, parent?: ExpandedNode) {
    if (depth > 6) refuse(node, 'Expanded visual depth exceeds six');
    if (identities.has(node.id)) refuse(node, `Duplicate expanded identity ${node.id}`);
    identities.add(node.id);
    const children = node.children.filter((c): c is ExpandedNode => typeof c !== 'string');
    if (node.tag === 'Shape' && parent?.tag !== 'Slide') refuse(node, 'Expanded Shape must be directly in Slide');
    if (node.tag === 'Rule' && node.props.length === 'bleed' && parent?.tag !== 'Slide') refuse(node, 'Expanded bleed Rule must be directly in Slide');
    if (node.tag === 'Slide' && children.filter(c => c.tag === 'Shape').length > 2) refuse(node, 'Expanded Slide permits at most two Shapes');
    if (node.tag === 'Split' && children.length !== 2) refuse(node, 'Expanded Split requires two children');
    for (const child of children) checkExpanded(child, depth + 1, node);
  }
  for (const slide of slides) checkExpanded(slide, 1);
  const normalizations = [...normalizationMap.values()];
  return { source: applyPatches(source, normalizations.map(n => setProp(n.node, n.key, n.value))), slides, pendingNodeIds, library,
    normalizations: normalizations.map(n => ({ nodeId: n.node.id!, key: n.key, value: n.value })) };
}
