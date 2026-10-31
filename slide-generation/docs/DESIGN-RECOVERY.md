# Initial design and failed-content recovery

The designer owns initial deliberate composition as well as later refinement.
Readable default text is not evidence that design is complete. Preserve explicit
user choices and coherent existing design; no obligatory rings/cards/retheming.
Native authoring contracts include Shape, Frame, Motif and Layout/Slot syntax.

## Context, not another model tool

`deck.designState` (actors) / `designState` (refinement gate) reports whether the
current Theme matches bootstrap defaults and counts shared definitions. It is
recomputed from canonical source, including after load/undo/redo. These facts do
not establish user intent or design quality. The image, brief and source remain
the evidence for choosing a composition. We deliberately do not maintain a sticky
"design completed" flag based on an agent calling finish.

## Eligibility

The decision API still chooses wake/hold. It is not replaced by automatic waking.

- Fast publication permits an evaluation; concurrent changes coalesce.
- When Fast settles after publishing work not yet observed by Slow, permit one
  further evaluation. This handles a hold made during active Fast work. An empty
  later Fast turn does not reconsider an old idle-time hold.
- A failed/refused canonical `edit_source` queues its exact attempted edit,
  supporting speech, target and diagnostic to Slow once per call. It permits an
  evaluation even with zero successful publications. Slow checks current state:
  Fast may already have repaired the issue. This is not an instruction to retry.
- Slow receives new recovery evidence only at a model boundary. Evidence received
  while Slow is finishing can cause a coalesced gate followup. Slow's own edits,
  passive speech and ordinary mailbox delivery do not independently wake it.
- Holds and decision errors consume that eligibility; no polling retry. New work
  can reopen it. Pause/history/practice controls retain their existing authority;
  undo and entering practice discard prior eligibility. A cancelled control-boundary
  edit is not converted into a recovery request.

This records observed failures; it is not a semantic completeness detector.
A model that silently omits material without attempting an edit still requires
content review. Neither `finish` nor structural readiness certifies faithfulness.

## Browser diagnostics

Contrast masks contain viewport pixels only. Fully off-canvas glyphs retain their
measured rectangles and produce blocking overflow findings, explicitly noting
that contrast must be rechecked once visible. Missing samples for on-canvas glyphs
still fail measurement. No invented backgrounds or success fallback is used.
Policy version is `browser-checks-v2` so historical check evidence is distinguishable.
