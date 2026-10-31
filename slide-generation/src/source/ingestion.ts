import { z } from 'zod';
import { SourceError } from '../contracts.js';
import { nodes, nodeById, parseSource, textContent } from '../parser.js';
import { childNodes } from '../schema.js';
import { advanceVersions, allocateIds } from './candidate.js';
import { applyPatches, escapeText, setChildren } from './surgery.js';

export const utteranceSchema = z.object({ id: z.string().min(1), slideId: z.string().min(1), text: z.string(),
  deliveredAtMs: z.number().finite().nonnegative(), correctionOf: z.string().min(1).optional() }).strict();
export type InputUtterance = z.infer<typeof utteranceSchema>;
/** Trusted ingestion, not an agent mutation tool. Exact input is retained without semantic cleanup. */
export function ingestCandidate(source: string, input: InputUtterance) {
  const event = utteranceSchema.parse(input), root = parseSource(source);
  const existing = [...nodes(root)].find(n => n.tag === 'Prompt' && n.props.utteranceId === event.id);
  if (existing) {
    const owner = [...nodes(root)].find(n => ['Slide', 'ArchivedSlide'].includes(n.tag) && [...nodes(n)].includes(existing));
    if (textContent(existing) !== event.text || (owner?.props.slideId ?? owner?.id) !== event.slideId || existing.props.correctionOf !== event.correctionOf || existing.props.deliveredAtMs !== event.deliveredAtMs)
      throw new SourceError('input_conflict', 'Utterance ID already retained with different data');
    return { source, assigned: [], duplicate: true };
  }
  if (event.correctionOf && ![...nodes(root)].some(n => n.tag === 'Prompt' && n.props.utteranceId === event.correctionOf))
    throw new SourceError('input_reference', 'Correction references an unknown utterance');
  const slide = nodeById(root, event.slideId);
  if (slide.tag !== 'Slide') throw new SourceError('not_slide', 'Utterance target must be a live slide', event.slideId);
  const transcript = childNodes(slide).find(n => n.tag === 'Transcript'), notes = childNodes(slide).find(n => n.tag === 'SpeakerNotes');
  if (!transcript || !notes) throw new SourceError('evidence_missing', 'Slide is missing its evidence containers', slide.id);
  const prompt = `<Prompt utteranceId="${escapeText(event.id)}" deliveredAtMs={${event.deliveredAtMs}} mode="${event.correctionOf ? 'correction' : 'add'}"${event.correctionOf ? ` correctionOf="${escapeText(event.correctionOf)}"` : ''}>${escapeText(event.text)}</Prompt>`;
  const raw = transcript.closingStart === undefined ? '' : source.slice(transcript.openingEnd, transcript.closingStart);
  const noteText = textContent(notes);
  const candidate = applyPatches(source, [setChildren(source, transcript, raw + prompt),
    setChildren(source, notes, escapeText(noteText + (noteText ? '\n' : '') + event.text))]);
  const allocated = allocateIds(candidate);
  return { source: advanceVersions(source, allocated.source), assigned: allocated.assigned, duplicate: false };
}
