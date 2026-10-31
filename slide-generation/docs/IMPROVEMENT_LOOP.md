# Evidence-driven improvement loop

This is the operating procedure after the implementation milestones produce a working real host/model/engine/viewer.
It follows the user's requested cycle exactly: **measure -> diagnose -> decide together -> plan/build -> verify ->
re-measure -> clean up**. Read DECISIONS.md before proposing product changes. Do not substitute aggregate scores,
synthetic model output, or the final screenshot for evidence of the experience over time.

## Non-negotiable priorities

1. **Faithfulness:** preserve substantive user words, exact quotes and numbers, qualifications, corrections, and intended
   edits. No invented facts, paraphrasing, truncation, or source loss. Allowed speaker-note cleanup remains fillers,
   false starts, and redundant repetition only. Preserve raw input even when visible content is explicitly deleted.
2. **Responsiveness:** measure from finishing the relevant utterance to actually seeing its requested effect. Do not
   optimize server response time or first token in place of visible correctness. Investigate queuing before assuming a
   larger/faster model fixes it.
3. **Deck consistency:** reuse design for similar slide shapes without duplicate layouts accumulating.
4. **Visual correctness:** no overflow, overlap, unreadable native text, or unresolved final/presentation slots.
5. **Design quality:** consistent frame, purposeful color, intentional sparse layouts, appropriate large type, no empty boxes.
6. **Stability:** finished slides stop changing without a reason; useful background improvements are not systematically
   discarded. Distinguish legitimate explicit re-theme/reorder from unwanted churn.

Do not collapse these into an unqualified weighted average. Report a vector and enforce higher-priority regressions as
vetoes. If a fix for layout, speed, or style harms source fidelity, soften/reject the fix, not the fidelity requirement.
The historical latency examples in the user's request (roughly 5 -> <3 seconds typical and 16 -> <6 seconds worst case)
are **aspirational comparison points, not measurements from this code**. State actual sample sizes, distributions, misses,
and environment. An observed maximum from 15 runs is not an SLA.

## Before round 1

Complete P0–P10 in IMPLEMENTATION_PLAN.md. Verify the path is actual timed input -> real configured model(s) -> real
hashline tools -> canonical transaction -> real Chromium checks -> publication -> actual viewer. One passing unit test,
a renderer stub, a canned answer, or the old HTML-only orchestration is not this path.

Record the run budget/configuration; start with three fresh-session repetitions of each of five scripts (15 runs) per
version. For a release/qualification claim, five repetitions per script is the recommended expanded sample if budget
permits. These repetition counts are execution defaults, not product decisions requiring repeated confirmation. Report
when limits reduce them. Do not begin hundreds of unbounded paid calls; check configured limits and log cost/token totals.
Credentials come from the approved host environment and never enter logs. Verify configured model names at execution;
no model/version upgrade is smuggled into a code-only comparison.

Start each run from a fresh seeded deck, conversation state, ID allocator, input stream, and asset snapshot. Warm and cold
cache trials are separate labeled strata. Identical warmed browser/font/model-connection policy applies to A and B.
Record provider errors and retries; failed and interrupted trials remain in the corpus. Never rerun failures until a good
sample appears and omit the rest.

## 1. Measure

### Timed input, not polite input

Use fixtures/talks/*.json. `endMs` is when the speaker has finished the line, relative to one monotonic run start.
Schedule each input independently of downstream completion. A line's text is the only scripted utterance fed to the
system; assertions, semantic slide aliases, facts, and expected outcomes are evaluator data, not model context.

Conceptual driver (planned code, not an existing API):

```ts
const start = clock.now();
for (const event of fixture.events) {
  await clock.until(start + event.endMs); // absolute deadline; no accumulated sleep drift
  const deliveredAt = clock.now();
  logDelivery(event.id, start + event.endMs, deliveredAt);
  // Enqueue through the real input adapter; do not await a model/edit/render result.
  inflight.add(host.deliverUtterance(event.id, event.text, deliveredAt));
}
await observeUntilSettledOrDeadline({ maxDrainMs: 120_000 });
```

The delivery API must return promptly with ingestion acknowledgement, not hold the loop until generation completes.
If delivery itself blocks, schedule timers/dispatch independently and measure ingestion delay; never hide it. An overloaded
host still must retain source input. Log duplicate/reordered delivery, clock drift, dropped events, queue age, and incomplete
work. Keep long pauses as actual silence and continue recording spontaneous slide churn during them. Accelerated playback
is an additional stress test, explicitly labeled; primary results use speed=1 at speaking pace.

For audio, pre-align utterance end times against the actual audio waveform. Record playback completion, speech-to-text
provisional/final revisions, corrections, and downstream events. Use actual spoken utterance end as the user-facing origin;
report ASR delay separately. The supplied timed text scripts test generation/editing, not acoustic robustness.

### Record what the user saw and what caused it

Each run writes under `.artifacts/runs/<round>/<version>/<script>/<repetition>/`:

| Artifact | Contents |
|---|---|
| manifest.json | Full source/dependency/prompt/tool/model/font/asset/check/fixture manifest and environment |
| input.jsonl | Scheduled and actual delivery, immutable original words, corrections, stable utterance IDs |
| events.jsonl | Ordered causal trace; monotonic timestamps plus wall-clock start for alignment |
| model/ | Exact inference requests/responses, role/model settings, IDs, token usage, timings, errors/retries |
| tools/ | Calls, raw arguments, returned reads and snapshot handles, candidate/refused/accepted outcomes |
| states/ | Every committed JSX/JSON revision, normalized diffs, checks, HTML, CSS, dependency manifest |
| viewer/ | Frame acknowledgments and video or equivalent full visible timeline, including transitions/errors/loading |
| screenshots/ | 1920x1080 key states and explicitly requested review frames; source revision and time attached |
| final/ | Whole deck, per-slide images, notes/transcript/archive exports, readiness report |
| audit.json | Automated expected-claim/edit/identity checks and their evidence references |
| review.md | Human visual/semantic observations linked to timestamps and frames |
| metrics.json | Per-event, per-run, per-script statistics and all missing/censored observations |
| failure.json | Terminal error, unresolved work, partial artifacts and termination reason, if any |

Preserve even the frames that were later corrected. Capture the editor and audience surface where their states differ;
record which slide/build group was actually visible. Offscreen rendering is not the same as a visible slide update.
Record accepted commits that never reached the viewer separately. Do not put speaker notes/transcripts in audience HTML.
Evaluator video/screenshots do not go to the model unless the model explicitly requests the screenshot feedback tool.

Use a shared monotonic clock or a measured bridge offset between server/browser clocks; include uncertainty. A server
`published` timestamp is not proof of paint. Record a browser acknowledgment after DOM application and paint opportunity;
use video review to validate sampled acknowledgment accuracy. Distinguish first visible, first **correct** visible,
and settled states. Never count a Pending shimmer, speculative wrong value, invisible build, or bare loading message as
successful content delivery.

### Required metrics

| Priority | Measurements |
|---|---|
| Faithfulness | Raw-input retention; substantive notes coverage; exact quotes/numbers/units/signs; invented/duplicate/truncated claims; unintended edit changes; correction latency and obsolete-value exposure |
| Responsiveness | Per-utterance visible-correct latency; p50/p90/p95/max; visible coverage; missed/deferred/censored events; first meaningful slide; drain duration; speech/backlog age |
| Consistency | Intended shape reuse, canonical slot-shape duplication attempts, layout churn, theme/frame/type consistency across analogous slides |
| Visual correctness | New/worsened errors refused; accepted visible violations; final whole-deck error/Pending count; check availability/failure rate |
| Design quality | Frame discipline, color purpose, sparse-slide hierarchy, typography, meaningful asset use, empty-box avoidance, documented human ratings |
| Stability | Unrequested changes to settled slides, changes during pauses, reverted edits, animation interruptions, useful background proposals landed/discarded with reasons |
| Resource/context | Calls/tokens/cost, retry count, browser time, render/compile cache hits, input delivery drift, queue age and time per stage |

For each relevant utterance define the requested observable effect and target, then compute:

`latency = firstCorrectVisibleAt - actualUtteranceEndAt`.

Also report scheduled-end-to-visible latency so a slow test driver cannot improve the result by redefining delivery time.
Break delay into input/ASR -> ingest -> dispatch wait -> model wait/inference -> tool/read/retry -> validation wait/checks
-> commit -> transport -> browser paint -> animation settlement. Sum spans carefully when stages overlap; do not double
count parallel work. Track critical-path spans and raw timestamps for diagnosis.

Unseen requested content remains a miss, not a zero or excluded success. At deadline record right-censoring and count the
miss; never report a finite “worst-case latency” without it. For events intentionally waiting for a requested reveal or
an offscreen slide selection, report readiness latency separately from later visibility; show the denominators. Empty
or zero-event samples are undefined, not perfect. Aggregate per-run/per-script first, then show totals without hiding
outliers. Repetitions are the unit for uncertainty, not hundreds of correlated node updates.

## 2. Diagnose from evidence

Read failures one by one. For every failed/missed expectation and every refused loop, inspect original words, exact model
context/response, read snapshot, hash anchors, validation findings, publication, and the corresponding video frames.
Find the first divergence, not only the final symptom. A correct final deck after a wrong number was visible for ten
seconds still has a faithfulness failure. Notes-only retention does not satisfy a request to show something on a slide.

Create a case file at `docs/rounds/<round>/cases/<case-id>.md` (small portable summaries) linked to immutable raw artifacts:

```text
Case ID / script / repetition / versions:
User utterance and end time:
Expected observable effect and why:
First incorrect/missing visible state (time, revision, frame):
What was actually displayed:
Causal trace: input -> inference -> tool -> transaction -> checks -> paint:
First divergence and root-cause hypothesis:
Evidence supporting it / evidence that would disprove it:
Classification: input | model intent | context | hash conflict | schema | layout |
                notes/archive | queue | browser | animation | publication | harness
Reproduction: deterministic recorded response or minimal local case:
Affected priorities / severity / recurrence:
Options and tradeoffs:
```

Check whether a supposed model failure is really stale input, wrong target attribution, a lost pending command, an
unavailable tool, or a failure to publish a completed improvement. Check whether a layout failure is rendered with the
same fonts/assets as the screenshot. Compare native text to image-contained text separately. Verify instrumentation
before optimizing a measured number. Audit some passing runs to catch missing assertions and score gaming.

## 3. Decide together

Write a round findings report before changing product rules. Present concrete evidence, two or three options, effects
on the priority order, and a recommendation. Ask the user only about real unresolved product tradeoffs. Examples:

- Whether visible intermediate numeric animation counts as invented numbers (existing tension in DECISIONS.md).
- Whether an explicitly requested style should override editorial prompt advice in a demonstrated case.
- Whether a new layout category changes the agreed duplicate-slot-shape policy, if evidence demonstrates that limitation.

Do not repeatedly ask about canvas size, hashline vs search/replace, ID scope, mandatory checks, placeholders at
presentation, or other already-settled decisions. Routine implementation choices, deterministic bug fixes, and tests do
not need permission. Continue independent work while a necessary product decision is pending; do not implement its
assumed answer after a timeout.

Append the exact question, options, user's verbatim answer, date, source/evidence, affected requirements, and status to
DECISIONS.md. Mark superseded decisions explicitly without erasing history. Update SPEC.md and agent prompts only when
a real decision changes them. Preserve baseline prompt/spec copies for comparison. A question left unanswered stays
open, and the dependent candidate must not be presented as agreed behavior.

## 4. Plan, then build

For each selected fix write a small implementation card:

```text
Hypothesis and linked cases:
Invariant / expected before-and-after behavior:
Files and integration owner:
Steps (each a small independently reviewable change):
Regression tests and saved-response replays:
Expected metrics / potential higher-priority regressions:
Rollback or disabling condition:
Product decision dependency, if any:
```

Prioritize causal queue fixes when traces show stale work dominating latency: coalesce pending scheduling using complete
retained source, shorten unnecessary serialization, avoid obsolete retries, and let validated disjoint background work
land. Do not drop utterances, skip browser checks, silently mutate source, or let an unvalidated target reach the viewer
for speed. Never discard a background result merely because a global version changed if its validated target ranges and
dependencies remain applicable. Conversely, do not apply stale overlapping edits because they look nicer.

Implement directly on master in slide-generation/. Keep raw baselines immutable. Make focused commits; do not combine
model changes, prompts, queue policy, and renderer changes into one unexplained experiment. If several factors must
change, record them and consider an ablation before assigning credit to one. Add telemetry needed to disprove the
hypothesis, not only telemetry that makes the candidate look better.

## 5. Verify after every change

Run relevant automated tests immediately after each behavior change, then package-wide typecheck/tests before commit.
Tests should enforce the real invariant rather than mirror implementation details. Extend browser/animation tests when
rendering behavior changes. Keep all earlier critical regression cassettes passing unless an explicitly recorded product
decision changes their expected behavior.

Two complementary replay modes are required:

1. **Transaction replay:** initialize recorded source/evidence/assets, replay the exact recorded reads and model tool
   calls into the current engine, and compare acceptance/refusal, normalized source, identity, and final render/checks.
2. **Actor/tool replay:** supply recorded model responses at their recorded or virtual latencies to the real host
   scheduler, retaining intervening user input, tool calls, rejected attempts, and wakeups. This tests races/backlog and
   whether the same response is published correctly. Never call a real model as a fallback for a missing cassette.

Record tool schema/prompt/source versions and the mapping from recorded ephemeral snapshot handles to deterministic
replay handles. Compare read content/hash state before remapping a handle. Replay retains exact literal output strings;
do not repair malformed recorded answers to make a test pass. If prompts/tools materially diverge, fail the cassette
compatibility check and keep transaction-level/minimal regression coverage; a historical response cannot establish that
a newly prompted model will behave the same. Newly captured real responses seed new cassettes.

Replays can prove local handling of recorded behavior, not new model quality or live provider latency. Browser-dependent
checks still run in the replay when they are what the fix affects. Virtual-time queue tests cannot claim a real end-to-end
latency improvement. Include negative controls (wrong number, missing notes, wrong target, stale interior range, unavailable
check) so a pass cannot come from a disabled assertion or an always-refuse engine.

## 6. Re-measure against a frozen previous version

Freeze **the complete relevant source**, package locks, prompts/tools, fixtures, resolved assets/fonts, and runtime/check
versions. The baseline must be the previous working version, not the current candidate given an old label. Do not check
out another branch in the shared workspace. Suggested procedure from repository root:

```sh
BASELINE_SHA=$(git rev-parse HEAD)  # do this BEFORE candidate changes; record it durably
mkdir -p "slide-generation/.artifacts/baselines/$BASELINE_SHA/repo"
git archive "$BASELINE_SHA" | tar -x -C "slide-generation/.artifacts/baselines/$BASELINE_SHA/repo"
```

Use a task-specific variable name; no HOME/CODEX_HOME overrides. Export source is immutable after provisioning. Install
locked dependencies/build outputs in its isolated runtime or documented writable cache; never change baseline tracked
source. Give baseline and candidate separate ports, storage, browser contexts, sessions, and output paths. Both use the
same model configuration and fixture/assets; credentials are injected at runtime and never copied into artifacts.
Record the baseline's own API/tool protocol and replay harness version. If an old protocol is incompatible, do not adapt
it silently; document the bridge and verify it, or select the first compatible functioning baseline.

Rerun the **same scripts** at the **same speaking pace**, fresh sessions, several repetitions per version. Alternate A/B
or randomize balanced run order to reduce time-of-day/provider-load confounding. Do not run them simultaneously under
resource contention unless that is explicitly the experiment. Pair by script/repetition/conditions; shared model seed,
where supported, does not guarantee identical output. Record model aliases and available resolved version metadata;
provider changes mean the comparison is qualified, not controlled.

Create synchronized side-by-side visible timelines keyed to script clock, with scrubbing to utterance, first-correct
frame, and corresponding source/model/tool state. Include final deck contact sheets and per-slide 1920x1080 images.
A later-corrected bad frame remains in both timelines. Report before/after per talk and repetition, medians/quantiles/max,
coverage/misses/timeouts, costs, fidelity/visual audits, and uncertainty. Link the exact cases fixed and any new failures.

If a fixture, expected behavior, or model configuration changed, rerun both versions under the new common condition and
label it a separate comparison. Keep the original result; do not rewrite baseline data. If a baseline run cannot finish,
report that fact rather than manufacturing an after/before ratio. Report speed gains only when the user-visible correctness
criterion and delivered-work denominator are comparable.

### Round report template

```text
Round / date / objective / prior decision IDs:
Baseline SHA + complete manifest:
Candidate SHA + complete manifest:
Scripts, repetitions, pace, order, budget, failed/aborted runs:
Change hypotheses and commits:
Before/after table per priority, per script, with coverage and sample counts:
Side-by-side timelines and representative frame pairs:
Every failure case and first-divergence diagnosis:
What improved / what regressed / what remains unresolved:
Automated tests and offline replays (exact commands/results):
Live measurements (distinct from replay outcomes):
Product questions, options, recorded answers:
Decision: keep candidate | revise | reject; reasons in priority order:
Next small actions and responsible integration seams:
```

## 7. Clean up after stability

Stability means repeated full-script runs have no newly introduced fidelity failures, qualified decks pass readiness,
critical replays/tests pass, and remaining misses/latency/design issues are explicitly documented. Never announce that
all goals are met just because results stopped changing. If a product blocker remains, continue diagnosis or report the
blocker rather than hiding it in cleanup.

Perform several separate refactoring passes, each with its own commit and checks:

1. Schema/parser/normalization: remove duplicate validation and clarify literal data boundaries.
2. Transaction/evidence: simplify ownership, ID/version updates, rollback, and archival without changing behavior.
3. Render/check pipeline: consolidate common font/asset/HTML/CSS inputs and complete cache keys.
4. Queue/publication: make pending/running/committed/visible states explicit; simplify cancellation and stale work paths.
5. Telemetry/replay: unify causal identifiers, remove redundant logs without losing diagnosis/reproduction evidence.
6. Dead code/public API/docs: remove superseded tool paths, unsupported options, and inaccurate readiness claims.

For each pass: choose one responsibility, state invariant, run targeted tests and the saved regression corpus before and
after, inspect the diff, typecheck, and commit separately. Re-run the live A/B set when performance paths or model context
change. Do not change prompt policy/model settings as an incidental refactor. Preserve decision history and immutable
run artifacts. If a refactor changes behavior, split the behavior change into its own diagnosed and verified fix.

## Continuing, qualifying, and handing off

Continue rounds while real evidence shows meaningful failures within scope. A candidate with new substantive fidelity
regressions is not promoted, even if faster. Qualification should include all five scripts, repeated live runs, actual
viewer review, no final readiness errors/Pending, and declared latency outcomes against the desired targets. Unresolved
product choices or external integration/network constraints remain explicit blockers/limitations, not inferred approval.

A handoff records: current branch/SHAs, completed milestones, exact commands, immutable artifact manifests, live vs replay
results, open cases/decisions, latest user's answers, cost totals, last comparison, and the next smallest useful action.
Before each push fetch/rebase then push additional commits; do not push if synchronization fails. This procedure creates
an auditable improvement history that another agent can resume without re-asking settled questions.
