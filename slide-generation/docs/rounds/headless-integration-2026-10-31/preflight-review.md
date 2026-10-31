# Independent headless preflight review — 2026-10-31

Read-only inspection of the working tree based on `108b01c`, including in-progress headless host/runner changes. No
provider requests, source edits, fixture changes or runtime mutations were made for this review. The small executable
negative control below used synthetic in-memory objects and printed its result; it is not a model run or browser result.
Line numbers refer to the inspected tree; prefer the named symbols if subsequent edits move them.

The user authorized the combined package and explicit spoken new-slide/return controls. None of the findings below
reopens that choice. Fixes must operate on actual input and canonical identities, never on evaluator fixture aliases.
Preserve the first pilot as measured. Correct measurement defects separately and apply the same evaluator version to
both frozen-baseline and candidate evidence before drawing comparisons.

## Findings requiring attention before full baseline runs

### P1 — The evaluator can accept content on the wrong slide as successful target delivery

`src/headless/audit.ts`, alias construction around lines 85–92, uses every observed routing target as authority for the
expectation alias. That makes the route under test determine the answer: if an explicitly named target is misrouted,
correct words on the wrongly selected slide can pass the intended target's check.

Executed synthetic negative control:

- Input: `On Intended slide, add Exact claim.`; evaluator alias: `intended`.
- Recorded route: `wrong-selected-slide`; coherent painted frame there contains `Exact claim`.
- Actual output: `bindings.intended = "wrong-selected-slide"`, `firstCorrectVisibleAtMs = 20`, `settledAtMs = 20`.

The same mechanism also creates false misses. A previously correct alias becomes ambiguous when a later utterance for
that alias is misrouted; all its earlier checks are then marked manual review, retroactively hiding successful delivery.
This can happen when Practice was created correctly, but `On Practice, add ...` is subsequently delivered while Timebox
is selected. `ambiguousAliases` will contain both identities.

**Instrumentation proposal:** preserve separate `selectedSlideId`, `intendedWorkingSlideId`, actual retained target and
actual edited target. Resolve literal title references against canonical title/identity history at the event time; keep
missing/duplicate names unresolved. After the run, bind an evaluator alias from its observed creation/initial identity
and explicit title/rename evidence, then retain that stable binding. Do not overwrite it with later actual routes.
Compare subsequent routes/edits against the established identity and expose wrong-target observations. If the initial
identity cannot be independently established, mark it unresolved; never pick the first slide or trust the failed route.
The evaluator may use fixture aliases only for grouping its private assertions, not for host navigation or model context.

### P1 — Named working targets are currently conflated with selected slide

`src/headless/evaluation-host.ts`, `navigationCommand` and `deliverUtterance`, recognize new/create and return/go-back
commands. Other utterances are assigned `backend.selectedId` before `actors.deliverUtterance`. Thus a normal command
`On Practice, add a fourth point: Share the findings.` has no target resolution while Timebox is selected. Fast then
receives it as Timebox work and is correctly prevented by the canonical backend from editing Practice. Slow may recover
from the text, but routing, source attribution and the audit target have already diverged.

This is visible in the unmodified style-switch talk: creation of Timebox precedes an explicit `On Practice` update.
The general failure is any named offscreen target; the remedy must resolve actual spoken names while preserving
selection, not special-case that fixture. Keep source receipt durable regardless of routing failure, and record the
real delay and target resolution. A named edit need not move the audience selection.

### P1 — Deleting the selected slide leaves the publication session on a removed identity

`src/host/jsx-backend.ts`, `committed` around lines 109–118, changes its own `selectedId` when the selected slide disappears
but does not notify `onSelection`. Independently, `GenerationSession.enqueue` captures its selected ID at commit time
(`src/host/session.ts`, around lines 50–58). It then attempts to render that removed slide. The headless wrapper records
a permanent publication failure (`src/headless/host.ts`, lines 21–23); subsequent `settle()` throws even if later navigation
succeeds.

Concrete reproduction to add after the preserved pilot: create two slides through the canonical backend; select the
second; delete it with a legitimate deck hashline edit; assert backend and viewer session select the same surviving
identity, retain the deleted evidence in Archive, and settle without a removed-node publication. The edit-heavy talk's
Parking lot deletion exercises this general path. Do not suppress the error without repairing selection/publication
ordering and retaining the original failure evidence.

### P1 — Only the editor surface is connected during the integrated run

The host constructs `HeadlessRecordingSession` with its default editor mode and never publishes presentation mode or
mounts a separate audience viewer. Final JPEG export is an offscreen checker capture. `IMPROVEMENT_LOOP.md` requires
capturing editor and audience where their states differ; build groups are exactly such a difference. In the editor all
build content is visible, whereas an audience publication can hold it. Current run evidence cannot establish audience
reveal correctness or an audience first-correct latency.

Keep editor observations explicitly labeled; do not reinterpret them as audience. Add a real audience capture/reveal
review with same-revision readiness and explicit supported build controls before claiming that acceptance gate. Do not
pre-supply fixture build groups to generation.

### P1 — Native DOM projection is insufficient proof that all requested text was visible

`src/headless/viewer.ts`, projection around lines 103–127, accepts an element when any of its bounding box intersects the
viewport and its ancestors are not display:none/visibility:hidden/zero-opacity. It then records the entire textContent.
It does not measure character ranges against clipping ancestors, occluding paint, or readability during near-transparent
motion. A phrase can therefore be scored in full when only its first pixel/character is visible, or when an overflow clip
hides it. Final mandatory checks do not prove every intermediate animation frame was fully readable.

The projection also walks only `#stage [data-node]`. Visible exit copies live in `#exits` and deliberately lose those
identity/content attributes (`src/viewer/client.js`, `freezeElement`, around lines 134–141). `visible_absent` and correction
checks can consequently pass while old words remain visibly fading in an exit or crossfade. The documented manual-video
limitation does not make that automatic absence assertion true.

Negative browser controls should move text partly outside the viewport, hide it behind an ancestor clip, and remove an
old numeric node while it fades out. Measure real visible glyph/clip evidence or conservatively defer those frames;
track transient text separately so positive-content and absence/correction checks cannot silently ignore it. Preserve
video and capture timestamps. Avoid turning evaluator heuristics into product validation rules.

### P1 — Actor settlement can end observation before the final viewer work completes

The host's `settled()` checks routing, providers, gates and `actors.settle(1)`, then returns true. It does not include
queued `GenerationSession` publication checks or pending browser/frame work. `runTalk` stamps `finishedAtMs`; only later
does `finish()` await `recording.settle()`. Auditing rejects frames after `finishedAtMs`. A final valid model edit can
therefore receive a false visible miss because its publication or screenshot was still queued when actors became idle.

The same placement makes timed presentation-readiness observations impossible: readiness is measured in `finish()`,
after run completion, while the audit accepts `readyAtMs` only through the observation end. Final readiness still has
value, but its timestamp cannot establish readiness latency during the run. Include actual publication/frame drain in
bounded settlement, and record readiness events during observation; never backdate final checks or widen the window
silently after seeing the result.

## Additional precision issues

- `navigationCommand` splits a title at the first `.`, `!` or `?`, even inside quotes. Executed input
  `Create a slide titled "Q3.1 results". Add the subtitle.` returned `{ type: "new", title: "Q3" }`. Parse quoted names
  faithfully and reject unresolved ambiguity instead of truncating substantive title characters.
- The audit sets `firstVisibleAtMs` to the first eligible target frame, even if that frame contains none of the requested
  content. Only first-correct is currently used for reported latency, but the first-visible field is misleading. It
  needs a defined meaningful-content predicate or should stay unset.
- The viewer's zero-duration path emits `settled` synchronously after scheduling the paint acknowledgment. The headless
  capture marks such a coherent settled sample painted without independently requiring the paint acknowledgment. Its
  PNG capture eventually forces a rendered frame, but the earlier DOM sample timestamp is not proof of an earlier
  paint. Preserve that distinction when adding no-motion performance cases.
- Raw exact-once Prompt retention is checked; substantive cleaned-note fidelity remains an explicit human/semantic
  review. A passing raw retention check must not be reported as a passing notes-completeness check.

## Proposed separation of follow-up work

1. Preserve the current pilot, trace and screenshots without rewriting them. Label its measurement limitations.
2. Correct instrumentation target binding and terminal observation/clock semantics in focused changes with negative
   controls; replay the unchanged original evidence where possible. Freeze compatible evaluator/config versions for
   both baseline and candidate. Report evidence that cannot support a corrected measurement as unavailable.
3. Fix actual product routing/selection failures independently, then verify canonical-source/control tests and recorded
   transaction replay. Do not use expected fixture answers for routing or layout.
4. Add audience/build and transient-frame review before claiming viewer acceptance. Retain unsupported semantic/design
   checks as manual review. `qualificationComplete` remains false until the full measured/reviewed process is completed.
