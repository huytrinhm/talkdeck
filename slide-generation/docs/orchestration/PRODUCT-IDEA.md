# Talkdeck: product idea and intended workflow

Handoff snapshot: 2026-10-31. This records the product discussion, not a claim that
all features below are implemented. See [the developer handoff](HANDOFF.md) for
current code and [the decision record](DESIGN-DECISIONS.md) for runtime contracts.

## Problem and audience

Presentation preparation involves four connected jobs: deciding what to say,
writing it, designing slides, and rehearsing. Separate tools lose the connection
between those jobs. Rehearsal discoveries rarely make it back into the deck.

Design primarily for students, educators, and conference speakers: people who
know their material but need help structuring it for an audience. Other presenters
can benefit, but teaching and explaining should guide product choices.

The founding insight is that people often organize ideas while explaining them
out loud. The stronger product hypothesis is that explaining **to someone** helps:
a listener's confusion can prompt examples, clarification, and better structure.
The original discussion referenced learning-by-teaching and self-explanation
research as motivation, not as evidence that this product has been validated.

## The continuous loop

1. **Draft by talking.** Informal speech becomes useful slide content while the
   person speaks. Preserve their facts, qualifications, corrections, and wording
   in the source record; retain their speech for speaker notes. Show useful
   partial progress without waiting for the whole talk.
2. **Refine.** Improve narrative structure, hierarchy, and visual explanation.
   Suggest cuts, gaps, reordered sections, or better visual representations.
   Allow precise explicit instructions through push-to-edit. Eventually support
   element selection, pointing, sketch input, and reusable component retrieval.
3. **Practice.** Observe pacing, fillers, slide timing, and coverage of intended
   points. Suggest changes based on actual delivery: split a rushed slide, move
   a routinely skipped point, or preserve a good improvised explanation in notes.
   Keep the deck and delivery improving together.

## Interaction intentions

- The user controls slide navigation. Agents must not advance the audience view.
- Normal narration is content; push-to-edit is a separate instruction channel.
  The implemented initial version is simply a text prompt/comment.
- Pause suspends agent work; microphone mute is a separate, still-unspecified
  interaction. Undo/redo reverses accepted deck changes.
- Background specialists prepare images, tables, diagrams, and components.
  Prepared assets should not alter a published slide until integrated explicitly.
- Leaving a slide may motivate refinement of that slide and private preparation
  of the next. Predicting a slide is not permission to show or navigate to it.
- Feedback may span slides and should offer a before/after change, explanation,
  accept/reject, and a counter-prompt. Rewind should link feedback to actual audio.
- Practice should not automatically generate or change slides. Explicit
  push-to-edit remains available.
- Live presentation should minimize changes. A divergence from the planned next
  slide can produce a private suggestion/preview, with confirmation before use.

## Important unresolved distinction

The current orchestration emits no AI audio and has no conversational clarification
channel. That does not yet implement the “confused listener” hypothesis. Optional
text questions are one possible future design; they have not been selected or
implemented. Do not silently turn narration transcription into a talking assistant.

## Implementation boundary

Implemented here: speech/Decision scheduling, persistent Fast/Slow actors,
private specialists, multi-slide targeting, publication, pause/resume,
prompt-based push-to-edit, and undo/redo using the original HTML backend.

Not implemented here: feedback proposals/approval, practice and presentation mode
policies, timestamped audio rewind, polished speaker-note generation, pointer or
sketch grounding, speculative next-slide preparation, or component search.

The separately developed [slide-generation subsystem](../../slide-generation/README.md)
now provides a canonical JSX engine and its own notes/source, rendering, validation,
and viewer contracts. Those capabilities are not yet wired into the orchestration
actors. Its newer decisions must be reconciled during integration, not confused
with features already running through this package.
