# Mixed-layout quality rehearsal v1

[The fixture](../../fixtures/quality/mixed-layout-v1.json) is authored fictional test input, not a successful run or a quality certificate. It adds varied composition and visual review to the existing five timed talks. Those five fixtures remain unchanged. Run both generator versions with the exact same fixture bytes and common observer/evaluator; retain the fixture hash, failures, and incomplete trials.

The fixture contains 20 utterances, 68 evaluator expectations, and 12 requested slides. Speaking durations are estimated at three whitespace-delimited words per second; they are not measured audio durations. Deliver each utterance at its recorded end without waiting for generation. The last utterance ends at 414,675 ms, followed by 15 seconds of silence and 20 seconds of observation. The nominal observation horizon is 449,675 ms; the bounded drain ends at 569,675 ms. Earlier pauses provide time to observe settling and unrequested changes. Scheduling does not promise that a model will finish before the next instruction.

The host receives only the normal initial context and spoken inputs. Aliases, assertions, manual-review answers, expected slide count, and this checklist remain evaluator-only. Creation and named-edit commands identify their targets in the actual spoken words.

## Intended compositions and exact facts

| Slide | Requested composition | Facts and review focus |
|---|---|---|
| Relay rehearsal | Sparse opening with restrained ring/dots motifs | Subtitle: “Fictional systems, explicit handoffs.” Warm light background, dark ink, teal accent initially; Relay / FICTIONAL frame and page numbers. |
| Manual and assisted | Reusable two-column comparison | Manual intake: 6 min, 4/4 checks passed, Ada. Assisted intake: 2 min, 4/4 checks passed, Lin. Preserve value/label/owner associations. |
| Release timetable | Horizontal timeline with aligned time/stage pairs | 09:00 Draft; 09:20 Review; 09:40 Publish, corrected to 09:45; 10:00 Monitor. A connector and sequence must be visible. |
| Three-step release | Three connected process steps | Capture / “Retain exact input.”; Validate / “Check the whole candidate.”; Publish / “Show the committed revision.” Dedicated discovered Lucide icons supplement the words. |
| Release decision | Two-path branch diagram | “Check passed?” branches left through Yes to Publish, and right through No to “Keep previous revision.” A flat list does not establish the requested relationship. |
| Service signals | Three-metric row | Median validation time: 120 ms → 118 ms → 125 ms → 123 ms. Availability: 99.95%, provisional. Unreviewed releases: 0. Caption: “Fictional 30-minute test window.” |
| Owner budget | Native text comparison grid | Headers Workstream / Owner / Budget. Storage / Ada / $120; Compute / Lin / $450 → $480; Support / Jo / $80. No total. |
| Operating rules | Dense two-column native text | All six exact sentences, assigned to the two requested headings; no summarization or truncation. |
| A promise at handoff | Sparse quote | “Clarity is a promise we keep at every handoff.” By Mara. Keep Quote semantics, not title styling; no invented content or empty panels. |
| System map | Two-by-two architecture grid | Intake: “Retains source words.” Queue: “Orders pending work.” Checker: “Validates candidate slides.” Viewer: “Shows committed revisions.” Direction is Intake → Queue → Checker → Viewer. |
| Pilot comparison | Same comparison family as slide 2 | Pilot A: 12 accounts, 3/3 checks passed, Ada. Pilot B: 18 accounts, 3/3 checks passed, Lin. Reuse definitions without changing slide 2 or duplicating equivalent slot shapes. |
| Next rehearsal | Sparse closing with successive builds | Base title; then “Confirm owners.”, “Rehearse handoffs.”, “Review exceptions.” No launch date. |

The final whole-deck theme uses amber in place of teal while retaining the warm background, dark ink, layout families, positions, frame, and facts. Ordinary icons inherit surrounding text color; process-step icons use the accent theme override. Follow [the settled Lucide contract](../LUCIDE_ICONS.md): dedicated Icon nodes, full-catalog discovery, explicit returned catalog version, original geometry, and no stroke customization. Decorative motifs are native Shapes, not generated assets. No image/font provider is selected or required by this fixture.

The budget is an aligned Grid/Row composition of native text cells. This fixture neither introduces nor claims support for a native Table primitive. Process, branch, and architecture relationships use existing Panels, Grid/Split/Rows, Rules, and dedicated direction icons; there is no claimed native connector-routing or diagram primitive.

## Automated evidence and manual checks

Native text, exact Stat value/label pairs, quote/byline text, retained raw source, measured geometry/contrast, and complete-deck readiness can provide automatic evidence. Source retention is independent from visible success. Readiness is not a content, diagram, theme, or design-quality verdict; a clean blank slide must not pass those reviews.

The current audit does not prove table-cell associations or diagram edges from text presence alone. Its labeled correction check expects native Stat associations, so timeline and budget corrections can remain manual-review even when all correct text is present. Review those corrections against the exact row/time association and original video. Do not change the layout into Stats merely to satisfy the evaluator, and do not change this fixture to fit output.

Record explicit pass/fail/unavailable evidence for these manual checks:

- **Relationships:** time/stage alignment; process order and direction; distinct Yes/No paths; budget row and column ownership; architecture positions and directed handoffs. A list containing all words is insufficient.
- **Layout variety and reuse:** the deck contains the requested distinct compositions, rather than a repeated title-and-list treatment. Slides 2 and 11 share a real design family with stable analogous hierarchy; they do not merely share a color. Inspect source definitions and both slides together.
- **Dense and sparse design:** all six operating-rule sentences remain readable in their assigned columns. The opening and quote use purposeful space without unused panels, clipping, invented captions, or reduced text below floors.
- **Theme and decoration:** inspect every final slide together. Confirm the latest amber theme, consistent frame/page behavior, restrained ring/dots decoration, unchanged factual text, and visible icons with appropriate inherited/override colors. Do not add an unagreed icon-specific APCA threshold.
- **Corrections and stability:** original values remain in raw input, while final visible values are 09:45, $480, and 123 ms at the correct targets. Record obsolete-value exposure and whether anything changes without a pending instruction during pauses. Intermediate requested 118 ms and 125 ms that never appeared remain superseded/missed observations, not zero-latency successes.
- **Motion:** retain actual viewer video during numeric corrections and theme changes. Check bounded counting, exact endpoints, retargeting if an update arrives mid-animation, unchanged labels, stable identities, no obsolete exit ghosts after settling, and no unsolicited repeat animation. [D56](../DECISIONS.md#d56--bounded-stat-counting-is-animation-2026-10-31) already treats bounded intermediate digits as animation rather than factual claims. Do not reopen that decision or count those digits as invented metrics. If no update actually overlaps animation, report retargeting unexercised.
- **Builds:** after timed generation, use the actual viewer controls to reveal closing groups successively. Verify base-title visibility, action order, identity retention, and exact final state. The timed driver does not itself issue reveal commands, so `build_groups` and `build_order` remain manual; hidden build content is not automatic visible-latency success. Label the later reveal review separately from timed observations.

## Required review artifacts and limits

Retain literal utterances, provider requests/responses, tool arguments/results, snapshots, canonical revisions, per-slide browser findings, actual viewer acknowledgments, screenshots, and video. Use the whole-deck contact sheet for cross-slide design comparison only when every expected live slide has its exact captured final image. Retain individual full-resolution captures for small-text and relationship review. Neither the contact sheet nor offscreen final renders establish what was visible during the talk.

This fixture does not test external image generation, asset-provider behavior, real audio transcription, responsive layouts, or a native table/diagram engine. Automated relationship, theme, icon-meaning, build, and animation judgments remain coverage gaps until reviewed with recorded evidence. One fixture/run is not the repeated five-talk qualification. No model or browser was run to author or validate this fixture; only JSON/schema and timing/content consistency checks were performed.
