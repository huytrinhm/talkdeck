import { SourceError, type SourceNode } from '../contracts.js';
import { nodes, parseSource } from '../parser.js';
import { childNodes } from '../schema.js';
import { applyPatches, setChildren, setProp } from './surgery.js';

export const systemProps = ['version', 'born', 'layoutChanges', 'nextId', 'provenance', 'utteranceId', 'correctionOf', 'deliveredAtMs', 'slideId'];
export function indexSource(source: string) {
  const root = parseSource(source), byId = new Map<string, SourceNode>(), parents = new Map<SourceNode, SourceNode>();
  function visit(node: SourceNode) {
    if (node.id) byId.set(node.id, node);
    for (const child of childNodes(node)) { parents.set(child, node); visit(child); }
  }
  visit(root);
  return { root, byId, parents };
}
/** Pure agent candidate: validates ownership and moves deleted evidence before assigning IDs. */
export function prepareCandidate(current: string, staged: string) {
  const before = indexSource(current), after = indexSource(staged);
  const removedSlides = childNodes(before.root).filter(n => n.tag === 'Slide' && !after.byId.has(n.id!));
  const removedIds = new Set(removedSlides.flatMap(s => [...nodes(s)].map(n => n.id)));
  for (const node of nodes(after.root)) {
    const previous = node.id ? before.byId.get(node.id) : undefined;
    if (node.id && !previous) throw new SourceError('system_field', 'New nodes must omit system-assigned IDs', node.id);
    if (previous && previous.tag !== node.tag) throw new SourceError('system_field', 'Cannot reuse ID for another tag', node.id);
    for (const key of systemProps) if (JSON.stringify(previous?.props[key]) !== JSON.stringify(node.props[key]))
      throw new SourceError('system_field', `Cannot edit system-managed ${key}`, node.id);
    if (!previous && ['Prompt', 'ArchivedSlide', 'Archive'].includes(node.tag)) throw new SourceError('system_field', 'Evidence is system-owned', node.id);
    if (!previous && node.tag === 'Transcript' && (childNodes(node).length || node.children.some(c => typeof c === 'string' && c.trim())))
      throw new SourceError('system_field', 'New transcript must be empty', node.id);
    if (previous && ['Transcript', 'Prompt', 'Archive', 'ArchivedSlide'].includes(node.tag)) {
      if (current.slice(previous.start, previous.end) !== staged.slice(node.start, node.end) || before.parents.get(previous)?.id !== after.parents.get(node)?.id)
        throw new SourceError('system_field', 'Raw transcripts and archives are system-owned', node.id);
    }
  }
  for (const previous of before.byId.values()) {
    const remains = after.byId.get(previous.id!);
    if (['Transcript', 'Prompt', 'Archive', 'ArchivedSlide'].includes(previous.tag) && !remains && !removedIds.has(previous.id))
      throw new SourceError('system_field', 'Raw transcripts and archives cannot be removed', previous.id);
    if (previous.tag === 'SpeakerNotes' && !removedIds.has(previous.id)) {
      if (!remains || before.parents.get(previous)?.id !== after.parents.get(remains)?.id)
        throw new SourceError('system_field', 'Retain the slide speaker-note identity', previous.id);
    }
  }
  let candidate = staged;
  if (removedSlides.length) {
    const archive = childNodes(after.root).find(n => n.tag === 'Archive');
    if (!archive) throw new SourceError('system_field', 'Archive must survive slide deletion');
    const entries = removedSlides.map(slide => {
      const evidence = childNodes(slide).filter(n => ['Transcript', 'SpeakerNotes'].includes(n.tag));
      if (evidence.some(e => after.byId.has(e.id!))) throw new SourceError('system_field', 'Deleted slide evidence cannot move to another slide', slide.id);
      return `<ArchivedSlide slideId="${slide.id}" version={${slide.props.version ?? 1}}>${evidence.map(n => current.slice(n.start, n.end)).join('\n')}</ArchivedSlide>`;
    }).join('\n');
    const existing = archive.closingStart === undefined ? '' : staged.slice(archive.openingEnd, archive.closingStart);
    candidate = applyPatches(staged, [setChildren(staged, archive, existing + '\n' + entries + '\n')]);
  }
  return allocateIds(candidate, highWater(before.root));
}
export function highWater(root: SourceNode): number {
  let next = Number(root.props.nextId ?? 1);
  for (const node of nodes(root)) {
    const suffix = node.id?.match(/(\d+)$/)?.[1];
    if (suffix) next = Math.max(next, Number(suffix) + 1);
  }
  if (!Number.isSafeInteger(next) || next < 1) throw new SourceError('id_limit', 'Invalid ID allocation high-water mark');
  return next;
}
export function allocateIds(source: string, minimum = 1) {
  const root = parseSource(source);
  let next = Math.max(highWater(root), minimum);
  const patches = [], assigned: string[] = [], used = new Set([...nodes(root)].map(n => n.id));
  const prefixes: Record<string, string> = { Text: 't', Badge: 't', Stat: 's', Bullets: 'b', Quote: 'q', Image: 'i', Panel: 'p', Band: 'p', Shape: 'd' };
  const definitions = new Set([...nodes(root)].filter(n => ['Layout', 'Component'].includes(n.tag)).map(n => n.props.name));
  for (const node of nodes(root)) if (!node.id) {
    let id: string;
    do {
      if (!Number.isSafeInteger(next + 1)) throw new SourceError('id_limit', 'ID allocation exhausted');
      id = `${definitions.has(node.tag) ? 'c' : prefixes[node.tag] ?? 'n'}${next++}`;
    } while (used.has(id));
    patches.push(setProp(node, 'id', id)); used.add(id); assigned.push(id);
  }
  if (root.props.nextId !== next) patches.push(setProp(root, 'nextId', next));
  return { source: applyPatches(source, patches), assigned };
}
/** Version only after the caller has validated this complete candidate. */
export function advanceVersions(current: string, candidate: string, dependentSlideIds: Set<string> = new Set()) {
  const before = indexSource(current), after = indexSource(candidate), patches = [];
  if (current === candidate) return current;
  for (const node of nodes(after.root)) if (['Deck', 'Slide', 'Layout', 'Component'].includes(node.tag)) {
    const previous = before.byId.get(node.id!);
    const changed = !previous || current.slice(previous.start, previous.end) !== candidate.slice(node.start, node.end) || dependentSlideIds.has(node.id!);
    if (changed) patches.push(setProp(node, 'version', previous ? Number(previous.props.version ?? 1) + 1 : 1));
  }
  return applyPatches(candidate, patches);
}
