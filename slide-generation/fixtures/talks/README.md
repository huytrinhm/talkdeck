# Timed talk fixtures

These five JSON files are authored inputs and evaluator expectations, **not recorded successful runs**. No model was
called to create or validate results. All claims, people, numbers, and scenarios are fictional test material supplied to
the system as speaker input. Version the fixture files with the implementation; hash them in run manifests.

| Fixture | Stress | Expected final slides |
|---|---|---:|
| long-technical.json | Sustained input; repeated section/list/metric/caveat shapes across a deck | 34 |
| numbers-business.json | Rapid figures, corrections, precision, signs/units/caveats, removal | 5 |
| narrative-keynote.json | Exact quotes, sparse slides, long pauses, no invented numbers | 7 |
| edit-heavy.json | Rapid scoped changes, reorder/rename/highlight/resize/remove/restore, archival | 2 plus archived Parking lot evidence |
| style-switch.json | Whole-deck theme change while later content arrives; stale work and consistency | 5 |

## Schema and delivery semantics

- schemaVersion: 1; stable id/title/purpose; initialContext may be supplied to the model as normal setup.
- timing: speaking-rate provenance, speed=1, post-talk observation duration, bounded drain timeout.
- events: unique id, startMs/endMs, kind=utterance, exact text, targetAlias, silenceAfterMs.
- expectations: unique id, triggerEventId, targetAlias, kind, and kind-specific data.
- finalExpectations: whole-run checks including count, source retention, and readiness.

The harness must deliver **only event.text** (plus genuine runtime input IDs/timestamps/context) at event.endMs. It must
not wait for the system to catch up. startMs documents when speaking began; endMs is when that line is available as
completed speech. Silence after a line is real time with no input; continue observing churn. Values were estimated from
the fixture's wordsPerSecond, not measured from audio. The final silence must be honored before ending observation, in
addition to settlement/drain handling. See docs/IMPROVEMENT_LOOP.md for full timing and audio distinctions.

Target aliases, expectations, final answers, and intended layout-family annotations are evaluator-only. Do not feed them
to the model, navigate the app for it, pre-create its slides, or silently select targets from the answer key. Spoken
commands explicitly identify target slides. Resolve aliases to actual generated slide IDs from observed state/content;
if a required slide was never created or a target is ambiguous, report failure rather than binding an arbitrary match.
The `deck` alias means a deck-wide operation, not a slide title.

Input commands and content may share an utterance. Raw transcript must preserve the entire utterance. Cleaned notes
preserve substantive source prose/figures, with only the agreed cleanup; source retention checks inspect transcript too.
Display checks exclude note/archive text, metadata, invisible build groups, and offscreen slides when measuring visible
latency. Counting retained words in notes alone is not evidence that requested on-slide content appeared.

## Evaluator expectations

This corpus defines the expected behavior; the evaluator that implements these checks is planned in P10. Not every
kind can be checked automatically from string matching. Use semantic associations and human video review where noted.
Do not turn these fixture-specific audits into forbidden generic runtime editorial blockers.

| Kind | Evidence / evaluation |
|---|---|
| visible_exact | Requested strings appear as native visible content; whitespace wrapping may differ; substantive words/punctuation remain intact |
| number_exact | Exact value linked to the right label, unit, sign, qualifier, and correction state; never count a substring from another number |
| correction | Prior active value replaced by new one at the intended target; old value remains in source evidence; measure obsolete-value exposure |
| visible_absent | Removed/incorrect content absent from active visible content; exact or standalone numeric matching as specified |
| must_preserve_qualifier | Qualifier visibly attached to the intended figure, not merely elsewhere in notes |
| source_retained | Original words recoverable in notes/raw transcript/archive as appropriate |
| no_derived_numbers | No unsolicited computed metrics, forecasts, counts, or percentages; frame page numbers/build indexes are allowed decoration |
| quote_exact / quote_role | Body/byline exact, with only renderer-added quote marks/line wrapping; quote not promoted to title |
| layout_family / consistent_pair | Compare analogous slide design using resolved definition/style; do not prescribe a pixel-perfect layout |
| sparse_design | Human screenshot review of hierarchy and empty-box avoidance; preserve exact sparse content |
| ordered_text / slide_order | Read visual/list order or deck order using stable identities; ensure unrelated content is untouched |
| unchanged_except | Diff actual content/identity/style before and after command; allow listed changes and necessary layout consequences only |
| style_target | Inspect target node styles/effective size plus screenshot; color/readability and typography floors still apply |
| relative_position | Inspect measured layout and screenshot for requested spatial relation |
| slide_deleted_archived | Slide absent from deck; notes/transcript present once in archive with source association |
| build_order / build_groups | Inspect build attributes and controlled viewer reveals after final deck exists; do not pre-supply groups during generation |
| no_churn | Observe during the pause; separate delayed completion of requested work from new unsolicited changes |
| theme / no_stale_theme | Compare resolved tokens and visible slides; theme intent is human-audited, latest valid state must not revert |
| frame | Frame labels/page behavior consistent over all slides, including earlier slides |
| no_duplicate_layouts | Canonical slot-shape signatures do not duplicate; track refused attempts separately from committed defects |
| presentation_ready | Actual complete-deck readiness endpoint passes and rendered deck has no Pending/blocking errors |

Event expectations are temporal, not all final-state assertions. A value intentionally corrected later must appear in
its appropriate interval or be recorded as superseded-before-display; do not require obsolete values in the final deck.
A later delete legitimately removes a prior visible phrase, but a lost initial addition remains observable in the timeline.
Overlapping commands during backlog must not simply cancel earlier intentions without accounting for the ordered final
requested state. Use ordered source events and the final expectations to distinguish legitimate supersession from loss.

For ambiguous duplicate-number situations, inspect claim identity: a page number, quoted number, list index, or intentional
comparison is not automatically a duplicated claim. Never infer a metric from the script's scheduling timestamps or
expected slide count. Audit animation digits separately under open decision O01; do not silently exclude them from the
recording to make the numbers test pass.

Do not rewrite fixtures to fit a candidate's output. If the user changes expected behavior, version the fixture and
rerun both baseline and candidate under the common version. Keep historical artifacts and their old expectations.
