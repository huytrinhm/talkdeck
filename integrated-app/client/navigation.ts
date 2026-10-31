import type { NavigationDeck, Snapshot } from '../shared/protocol.js';
import type { PublicationMessage } from '../../slide-generation/src/viewer/protocol.js';
import type { NavigationTrace } from './tracing.js';

export interface NavigationTarget {
  trace?: NavigationTrace;
  slideId: string;
  build: number;
  revision: string;
  preview?: PublicationMessage;
}
/** Navigation uses canonical slide order and prepared renderer output, never source interpretation. */
export function navigationTarget(snapshot: Snapshot, deck: NavigationDeck | undefined, current: NavigationTarget | undefined,
  action: 'next' | 'previous' | 'select', slideId?: string): NavigationTarget | undefined {
  let id = current?.slideId ?? snapshot.selectedId;
  let build = current?.build ?? snapshot.build;
  const prepared = deck?.revision === snapshot.revision && deck.epoch === snapshot.epoch ? deck : undefined;
  if (action === 'select') { id = slideId!; build = 0; }
  else {
    const direction = action === 'next' ? 1 : -1;
    const groups = snapshot.mode === 'present' ? prepared?.slides.find(slide => slide.slideId === id)?.builds : undefined;
    // Build order must come from the backend, so an unprepared Present uses server navigation.
    if (snapshot.mode === 'present' && !groups) return;
    const nextBuild = direction > 0 ? groups?.find(n => n > build) : groups?.filter(n => n < build).at(-1);
    if (nextBuild !== undefined) build = nextBuild;
    else {
      const index = snapshot.slides.findIndex(slide => slide.id === id);
      const next = snapshot.slides[index + direction];
      if (!next) return;
      id = next.id; build = 0;
    }
  }
  if (!snapshot.slides.some(slide => slide.id === id)) return;
  const artifact = prepared?.slides.find(slide => slide.slideId === id);
  return { slideId: id, build, revision: snapshot.revision,
    ...(artifact ? { preview: {
      version: 1, channel: '', type: 'publish', sequence: 0,
      publicationId: `local-${crypto.randomUUID()}`, revision: snapshot.revision, slideId: id,
      html: artifact.html, css: artifact.css, readiness: artifact.readiness,
      mode: prepared!.mode, motion: { durationMs: 0, stiffness: 220, damping: 26 }, build, holdIds: [],
    } as PublicationMessage } : {}),
  };
}
