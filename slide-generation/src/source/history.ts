import { SourceError } from '../contracts.js';
import { parseSource } from '../parser.js';
import { childNodes } from '../schema.js';
import { allocateIds, advanceVersions, highWater, indexSource } from './candidate.js';
import { applyPatches, setChildren, setProp } from './surgery.js';

/** User undo/redo restores visual identity, never rewinds original words or cleaned notes. */
export function restoreContentCandidate(current: string, snapshot: string): string {
  const now = indexSource(current), previous = indexSource(snapshot);
  if (now.root.id !== previous.root.id) throw new SourceError('history_deck', 'History belongs to another deck');
  const currentSlides = childNodes(now.root).filter(n => n.tag === 'Slide');
  const currentArchive = childNodes(now.root).find(n => n.tag === 'Archive')!;
  const sources = new Map(childNodes(currentArchive).map(n => [String(n.props.slideId), n]));
  for (const slide of currentSlides) sources.set(slide.id!, slide);
  const restored = childNodes(previous.root).filter(n => n.tag === 'Slide');
  const restoredIds = new Set(restored.map(n => n.id!));
  const patches = [setProp(previous.root, 'nextId', Math.max(highWater(now.root), highWater(previous.root)))];
  for (const slide of restored) {
    const fresh = sources.get(slide.id!);
    if (!fresh) throw new SourceError('history_evidence', 'Restored slide has no retained evidence', slide.id);
    for (const tag of ['SpeakerNotes', 'Transcript']) {
      const target = childNodes(slide).find(n => n.tag === tag)!;
      const origin = childNodes(fresh).find(n => n.tag === tag)!;
      patches.push({ start: target.start, end: target.end, text: current.slice(origin.start, origin.end) });
    }
  }
  const archive = childNodes(previous.root).find(n => n.tag === 'Archive')!;
  const entries = [...sources].filter(([id]) => !restoredIds.has(id)).map(([id, node]) => node.tag === 'ArchivedSlide'
    ? current.slice(node.start, node.end)
    : `<ArchivedSlide slideId="${id}" version={${node.props.version ?? 1}}>${childNodes(node)
      .filter(n => ['SpeakerNotes', 'Transcript'].includes(n.tag)).map(n => current.slice(n.start, n.end)).join('\n')}</ArchivedSlide>`);
  patches.push(setChildren(snapshot, archive, entries.join('\n')));
  const allocated = allocateIds(applyPatches(snapshot, patches), highWater(now.root)).source;
  // Advance every restored slide/definition even when an earlier visual value recurs (ABA).
  const advanced = advanceVersions(current, allocated, new Set(restoredIds));
  const versionPatches = [...indexSource(advanced).byId.values()]
    .filter(n => ['Slide', 'Layout', 'Component'].includes(n.tag) && !now.byId.has(n.id!))
    .map(n => setProp(n, 'version', Math.max(Number(previous.byId.get(n.id!)?.props.version ?? 0),
      Number(sources.get(n.id!)?.props.version ?? 0)) + 1));
  return applyPatches(advanced, versionPatches);
}
