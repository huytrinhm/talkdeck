import type { ReviewContext } from "./contracts.js";

/** Keep the persisted evidence intact; remove only proven duplicates on the wire. */
export function reviewContext(context: ReviewContext) {
  const {
    images: _images,
    design: _design,
    speechHistory: _speechHistory,
    version: _version,
    practiceId: _practiceId,
    ...evidence
  } = context;
  const wholeDeck = context.baseline.reads.find(
    (read) =>
      read.lines.map((line) => line.text).join("\n") ===
      context.baseline.source,
  );
  const effective = new Map(
    context.speech.map((span) => [span.id, JSON.stringify(span)]),
  );
  return {
    ...evidence,
    // A whole-deck read contains the exact source AND all executable line
    // anchors. Scoped copies add no capability: granular root edits are valid.
    baseline: wholeDeck
      ? { revision: context.baseline.revision, reads: [wholeDeck] }
      : context.baseline,
    slides: wholeDeck
      ? context.slides.map(({ id }) => ({ id }))
      : context.slides,
    ...(context.speechHistory.some(span => effective.get(span.id) !== JSON.stringify(span)) ? {
      speechHistory: context.speechHistory.filter(span => effective.get(span.id) !== JSON.stringify(span)),
    } : {}),
    ...(context.coverage
      ? {
          coverage: {
            speech: {
              completeness: context.coverage.speech.completeness,
              ...(context.coverage.speech.supersededIds.length ? { supersededIds: context.coverage.speech.supersededIds } : {}),
            },
            audio: context.coverage.audio,
            recognition: context.coverage.recognition,
          },
        }
      : {}),
  };
}
