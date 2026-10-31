# Motion and build qualification

The new [motion-builds-v1 fixture](../../fixtures/quality/motion-builds-v1.json) is an eight-slide, 26-utterance rehearsal with 35 existing-schema expectations. Its final utterance ends at 201,443ms, followed by a 12-second observation period. It has only received schema validation; no model or browser run is claimed here.

The fixture exercises model-authored additions/removals, stable item reorder/reparent, position/size/color edits, corrected Stats, short consecutive correction/movement requests, selection changes, and source build groups. Use its exact paced input through the real model pipeline with a frozen compatible baseline, recorded provider responses and actual viewer evidence. Preserve all failed and superseded intermediate requests in coverage denominators. Do not send evaluator aliases or expected answers to the model.

## Settled decisions

D32 retains movement, resizing, color, add/remove, reparent, Stat counting and slide crossfade behavior. D34 requires explicitly authored build groups, simultaneous equal-group reveals and reserved final geometry. D36 applies layout validation to final states; a temporary intersection during movement is not automatically a final-layout violation. Reduced motion remains deferred under D37 and is outside this work.

D56 is resolved: bounded intermediate Stat digits are animation, not invented factual claims. The model must still preserve exact source endpoints and qualifiers. Capture the intermediate digits, enforce bounds and settle on the exact target. First-correct-visible latency requires the requested exact value; neither an intermediate count nor the source value alone earns success. The fixture's `correctedValuesOnlyVisible` final check applies to the settled final state, not to prohibited intermediate digits.

## Paced cases and what they prove

| Slide | Spoken event IDs (suffixes) | Requested behavior | Required evidence beyond valid source |
|---|---|---|---|
| Arrival | 001–003, 023 | Add Gamma, remove Beta, retain Alpha; revisit | Entry/exit frames, unique retained identities, no Beta ghost after settlement |
| Reorder | 004–006 | One/Two/Three → Three/One/Two → Two/Three/One | Same IDs, trajectories, final visual order, exact words |
| Handoff | 007–008 | Move Approval from Planned to Complete | One surviving item, actual parent change, no duplicate old-parent exit paint |
| Focus | 009–011 | Move right, enlarge/change color, move back left | Sampled position/size/color continuity and exact final typography/wording |
| Counter | 012–015, 025 | 40% → 42% → 41.5% → 41.6% | Bounded actual displayed digits, exact settled target and label, no late reversion |
| Interruptions | 016–019 | Marker left → right → left → centered; foreground color | Retarget from the current painted state and one exact final Marker |
| Build pairs | 020–021 | Plan+Check group 1; Deliver+Review group 2 | Audience control log and pixel/DOM visibility per group; source grouping alone is insufficient |
| Finale | 022, 024, 026 | New selection and returns through Arrival, Finale, Counter, Finale | Actual selected-slide crossfade frames, attribution and stale-transition cleanup |

The pauses give model edits opportunities to publish, while the short correction/movement bursts exercise work arriving during active processing. They do **not** guarantee a publication lands inside a particular animation interval. If models coalesce a burst, record that outcome. Force early/middle/late interruption boundaries only in the separate controlled-browser tests, not by fabricating a successful paced-run transition.

## Audience/build controls missing from the current harness

The current fixture schema permits only utterance events. `GenerationHostSession` can select a slide and choose editor/presentation mode, but every normal publication initializes `build: 0` and `holdIds: []`. `createEvaluationHost` uses the default editor mode, and the timed driver has no audience next-build, previous-build, reset or hold control events. The viewer protocol and its isolated tests support build messages; that does not mean the live timed harness sends them.

Consequently, this fixture can test **authored grouping** and edit-mode geometry today. It cannot certify audience group reveal timing, equal-group visibility, reserved space while hidden, or build state survival across a live publication. A `build_groups` source/manual result is not an audience-visible pass. Report these as unexercised until the host can record and deliver controls.

A separate controlled runner needs to:

1. Enter presentation mode only with readiness proof for the exact published revision and select Build pairs by its actual stable ID.
2. Record explicit control sequence/revision, requested build level and hold IDs; send the real protocol message and correlate its actual applied/settled acknowledgment.
3. Sample build 0, 1 and 2: title visible immediately; both group-1 items reveal together; both group-2 items remain hidden until level 2. Confirm all reserved rectangles are unchanged within a stated pixel tolerance.
4. Interleave real build commands with an in-flight source update and with slide changes. Reject stale/wrong-revision controls, and verify a late settlement cannot reset the newer build level.
5. Keep control events separate from spoken content and from evaluator answers. Never inject a reveal request as model prose and call it an audience control.

This is a missing harness capability, not a request to reopen the settled build semantics or implement it in this fixture-only pass.

## Controlled-browser regression matrix

The existing test names below were inspected, not rerun during the active timed batch. They are evidence of implemented checks, not a claim that all listed gaps are covered. Use the real packaged viewer, real browser acknowledgments, before/during/after images and video; save sampled geometry, opacity, colors and displayed numbers with revision/sequence/timestamps.

| Behavior | Existing test coverage | Additional controlled evidence needed |
|---|---|---|
| Add/remove and cleanup | `test/viewer.test.ts`: “actual movement/resize/color interruption retargets and settles to exact DOM with no exit identities”; `test/headless-viewer.test.ts`: “exit transition samples do not assert exact final DOM before settlement” | Independent add/remove/re-add bursts with stable identities; sample intermediate opacity/paint, no duplicate ghost words, exact final DOM and empty exit layer |
| Reorder | Movement/reparent cases indirectly exercise changing geometry | Real renderer artifact with three stable siblings reordered at 25%, 50%, 75% progress; verify IDs, visual order and exact final boxes without snapping to an obsolete target |
| Movement, size and color | `test/viewer.test.ts`: “actual movement/resize/color interruption retargets and settles to exact DOM with no exit identities” | Explicit sampled computed foreground/background color and size trajectories; interrupted targets at several progress points; final exact requested colors/boxes |
| Reparent under nested transforms | `test/viewer.test.ts`: “nested zoom/translate reparenting retargets at early and late progress with bounded size and opacity” uses 25/140/280ms delays and tests one painted copy | Extend with removal of the old parent during a second reparent and with renderer-authored layout changes; retain current no-duplicate and bounded geometry checks |
| Numeric counting | `test/viewer.test.ts`: “numeric counting is bounded; record actual intermediate digits under D56 animation exception”; “numeric precision changes remain bounded and nonnumeric Stats crossfade as exact strings” | Interrupted ascending/descending/decimal/negative corrections, changing affixes or nonnumeric target; bounds for each active retarget interval, exact target at settlement, preserved label/qualifier, no stale timer overwrite |
| Slide crossfades | `test/viewer.test.ts`: “build command during motion survives settlement and a slide-key switch clears old DOM”; headless packaged viewer records actual frames/video | Explicit A→B→C and A→B→A before settlement; old/new opacity samples, selected-ID attribution, no leftover slide DOM after final settlement. A final cleared DOM alone does not prove a crossfade occurred |
| Hidden geometry and nested groups | `test/viewer.test.ts`: “real sandbox displays fixed canvas and enforces reserved geometry for nested builds” | Two equal-group siblings plus later group under a parent; compare all final-space rectangles at levels 0/1/2 and sample simultaneous reveal paints |
| Build during motion | `test/viewer.test.ts`: “build command during motion survives settlement and a slide-key switch clears old DOM” | Level change during movement and during a newer same-slide publication; exact revision correlation, hold/unhold, no reveal rollback on late ack |
| Stale/unsafe publication | Protocol rejection test; “newer publication supersedes a pending resource wait without showing the stale target”; corrupt asset/font tests | Combine resource-wait supersession with active motion/build commands and verify the last legitimate target remains displayed; no fabricated success ack |
| End-to-end model transition | `test/headless-viewer.test.ts`: canonical recording session and publication transport tests | Paced fixture with real responses, stable-ID diff, visible frames and settlement linked to the exact accepted transaction; offline replay of supported behavior with explicit unsupported-control limits |

For deterministic interruptions, publish the second valid target at specified progress while retaining the same relevant IDs. Observe an actual nonfinal sample before interrupting; a delayed machine that already settled must not count as an interruption test. Evaluate final visual correctness using mandatory checks after settlement, while measuring transient motion separately. Record actual artifacts and failed assertions; do not relax target bounds or relabel a skipped animation as passing.

## Qualification and reporting

Run the controlled matrix separately from live talk timing so CPU/browser contention does not contaminate latency. Run models serially under the frozen baseline/candidate protocol; retain every repetition. Report authored effects, actual publications, first exact visible targets, animation settlement and user controls as separate events. A smooth valid transition to the wrong content fails faithfulness before motion quality is considered.

After a measured defect, preserve the exact source pair and response cassette, make one small fix, replay, and compare again. Actor replay presently has unsupported lifecycle/navigation/control cases; transaction replay must not be presented as audience-control replay. No final animation, build or eight-slide quality qualification is asserted by this document or by the fixture passing schema validation.
