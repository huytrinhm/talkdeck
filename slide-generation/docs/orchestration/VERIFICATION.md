# Specification verification

Current scope includes the original single-slide behavior, Decision-gated Slow
activation, and the deck extension described in [DECK-CONTRACT.md](DECK-CONTRACT.md).
Earlier live evidence below is historical; it does not by itself verify the newer
deck controls. Frontend integration is explicitly excluded by the user.

| Requirement                                                                         | Implementation                                                        | Evidence                                                                                  |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Audio -> streaming transcript -> shared slide, no AI audio/automatic navigation     | `transcription.ts`, `runtime.ts`; no audio output/navigation tools    | Real root WAV replay; `transcription_event` logs and publication screenshots              |
| 200 ms evaluation without resetting on words/silence                                | `gate.ts` fixed interval                                              | Fake-clock test feeds words every 50 ms and observes calls at 200/400 ms                  |
| Replaceable pending full speech; corrections preserved; running inference immutable | `gate.ts`, actor latest slot in `runtime.ts`                          | Busy-Fast replacement and correction tests                                                |
| Corrections do not implicitly undo an accepted edit                                 | `publisher.ts` only mutates through edit                              | Already-displayed wrong claim remains until subsequent model action in test               |
| Persistent Fast/Slow histories, one inference per actor, independent concurrency    | `history.ts`, actor run loop                                          | Deferred-response serialization tests and live inference logs                             |
| Slow passive context never wakes/forces continuation                                | `runtime.ts` dispatch/finish rules                                    | Passive-context test; Decision-approved Fast publication or explicit followup wakes idle Slow |
| No active Slow per-publication broadcast; coalesced followup by observed watermark  | Publisher callback and actor completion                               | Three Fast publications during held Slow inference produce one wake/hold evaluation                   |
| Actual current source, PNG, geometry, diagnostics; two distinct observation bodies  | `renderer.ts`, `history.ts`, `publisher.ts`                           | Real Chromium test; image-history projection test and exact inference logs                |
| HTML/CSS/SVG/custom elements, immutable assets                                      | `renderer.ts`, `assets.ts`                                            | Registered shadow component/SVG asset tests; real specialist artifact in first live run   |
| Exact-once old match; insertion/deletion; original branch plus successful own edits | `merge.ts`, `publisher.ts`                                            | Absent/repeated/overlapping targets and sequential private-branch tests                   |
| Conservative disjoint/identical merge; conflict rejection                           | Token-atomic three-way merge                                          | Disjoint, identical, competing insertion, integer/decimal/unit conflict tests             |
| Serialized merge/validate/render/publish; previous frame retained on failure        | Publisher transaction chain                                           | Deferred render serialization, diagnostic rollback and thrown-render rollback tests       |
| One undo unit per accepted state-changing call                                      | Publisher undo snapshots                                              | No-op, batch, structure and restoration tests; frontend wiring remains out of scope                       |
| Stale Fast intent + supporting speech forwarded once; no automatic retry/precedence | Publisher conflict callback -> Slow mailbox                           | Same inference/call rejected twice produces one forwarding callback                       |
| Required component/reference/ID/execution validation; visual diagnostics advisory   | Chromium + reference validation                                       | Undefined component, external/fragment reference, duplicate ID and thrown-script tests    |
| No numeric tweening through invented intermediate values                            | Static render clock, animation suppression, scripted-timer validation | Timer animation rejected; numeric merge atomicity tests                                   |
| Focused private specialists, at most two active; only Slow integrates               | Runtime specialist tools + immutable artifact store                   | Deferred specialist tests and real specialist run logs                                    |
| Queue-only messages/completion, explicit followup and waiting-parent semantics      | Actor mailboxes, request flags and waiters                            | Idle queue test, active followup test, waiting-parent integration and shutdown tests      |
| Server-facing API without touching frontend                                         | `server.ts` HTTP/SSE                                                  | Local API lifecycle, screenshot, invalid input, SSE connection and delete test            |

## Live fixture evidence

The first complete live run is in `runs/2026-10-31T03-17-50-975Z/`.
It used the actual 85.5-second WAV, emitted 287 transcript revisions, produced five
published states, rejected one stale overlap, and ran a specialist that saved two
private artifacts. `audit.json` passes all 14 fixture-content/lifecycle checks.
Its final PNG was inspected: correct 48 completers and 4.4 rating, time and
first-visit comparisons, process diagram, staffing caveat and recommendation.

A second benchmark (`runs/2026-10-31T03-20-11-913Z/`) reduced first publication to
4.6 seconds from playback start, but was deliberately stopped after observing
low-value caption rewrites. It is not counted as a completed run. Role/completion
instructions were tightened based on that evidence.

## Initial full live verification (2026-10-31)

- `npm run check`: passed.
- `npm test`: **30 passed**, including real Chromium, local HTTP/SSE, local
  WebSocket streaming/cleanup, concurrency, private-asset integration permissions,
  rollback and numeric-merge tests.
- Final complete live run: `runs/2026-10-31T03-38-59-543Z/`.
  The actual WAV produced **286 transcript revisions**, all evaluated/dispatched,
  **six publications** and three rejected stale conflicts. Both agents finished
  idle; the final renderer returned no diagnostics.
- `npm run audit -- runs/2026-10-31T03-38-59-543Z`: **14/14 checks passed**.
  The PNG was visually inspected: three correct comparisons, corrected sample and
  rating, process diagram, staffing caveat, recommendation, no clipping.
- `npm run replay-publications -- runs/2026-10-31T03-38-59-543Z`:
  **nine recorded edit attempts replayed with identical outcomes and final source**
  through the final merge/renderer code.
- Root fixture files are unchanged. No frontend or other contributors' files were
  edited. Dependencies, implementation, tests and outputs are under `orchestration/`.

### Latency and failed-run findings

Recent live requests experienced substantial connection/request delays. The final
run recovered after gate timeouts, retaining the accumulated narration, and took
137.9 seconds overall. Its first publication was about 97.5 seconds after the
first transcript event; Fast inference p50 was 2.65 seconds. This is a correctness
and recovery pass, **not an acceptable interactive-latency benchmark**. An earlier
benchmark reached first publication 4.6 seconds after run start, but was stopped
for low-value caption rewrites and is not counted as a complete pass.

Other run directories preserve connection failures and an early-drain failure.
The fixture runner now waits for the final transcript revision to be evaluated
(including a valid hold), rather than silently closing the gate after 15 seconds.
A timeout is a reported failure, never an implicit dispatch. Network retries are
bounded; no failed live run is counted as a pass.

Live latency is provider- and load-dependent. A 200 ms scheduler is not a 200 ms
model response guarantee; this implementation does not claim a latency SLA.

## Recheck (2026-10-31)

Four additional defects were reproduced with failing regression tests and fixed:

- A stale edit could select an arbitrary copy after concurrent duplication.
  Ambiguous state-changing edits are now rejected, while already-applied identical
  changes remain accepted no-ops.
- Continuous narration could exhaust the activation's step budget despite fresh
  speech. Fresh work now renews the budget; a no-new-input tool loop still fails
  at the configured limit.
- Slow could finish without consuming a required specialist result that arrived
  during its final inference. Required results now remain outstanding until
  delivered at a subsequent model boundary.
- A specialist failure could fail settlement before Slow handled it, or after
  Slow recovered. Settlement now allows the active parent to observe the failure
  and finish; unhandled failures and main-agent failures still fail settlement.

Verification after these changes:

- Type check passed; **37 tests passed**, including seven new regression and
  negative-control tests.
- The saved live fixture's **nine edit attempts** replayed through the updated
  publisher and Chromium renderer with identical outcomes and final source.
- The saved fixture audit still passes **14/14 checks**.

This recheck did not run a new paid live API fixture. Saved-publication replay
checks publication behavior, not new live model behavior or latency. The latency
limitation above remains unresolved.

## Decision-gated Slow activation (2026-10-31)

The user requested that Fast changes no longer automatically wake Slow. The
runtime now uses a separate event-driven `wake`/`hold` Decision API call, with
current source and actual screenshot, for idle eligibility and coalesced
post-activation followups. Explicit work requests retain direct wake semantics.

- Type check passed; **44 tests passed**.
- Seven new tests cover hold/no polling, immutable snapshots and obsolete wake
  rejection, in-flight coalescing, active-Slow deferral, explicit-task invalidation,
  error/recovery, shutdown cancellation and the multimodal OpenAI request shape.
- No new paid live API fixture was run for this change. Earlier live runs and
  saved publication replays used the previous automatic-wake policy; they do not
  validate the new gate's real-model decisions or its additional latency.

## Explicit boundaries

- Overload: up to eight overlapping gate requests, 30-second request deadlines,
  occupied ticks skipped rather than queued; failures retain speech and back off.
- Model decides when an activation has no useful work. A 64-step safety bound
  applies between fresh work inputs and reports failure, not false success;
  explicit followup can recover a failed actor.
- The service is single-process/in-memory. Disk logs and artifacts support review,
  not automatic crash recovery or a distributed lease protocol.
- Visual diagnostics are advisory and successful validation does not establish
  factual correctness. Fixture audits are specific to the fictional library talk.
- Synthetic TTS tests do not establish noisy-microphone or multilingual accuracy.

## Deck extension verification (2026-10-31)

Final automated checks: **60/60 tests passed**, `npm run check` passed, changed
TypeScript files passed formatting checks, and `git diff --check` passed.

The active scope is the backend contract in `DECK-CONTRACT.md`; the user explicitly
excluded frontend work. The main `SlideRuntime` now owns an ordered deck while
retaining the same Fast/Slow histories across manual navigation.

| Requirement | Authoritative evidence |
| --- | --- |
| Manual next/jump with continued sessions | `runtime.ts` / `server.ts`; deferred Fast navigation test verifies the same two actors and retained history; real HTTP test exercises next/select and individual slide endpoints |
| Correct narration and in-flight edit routing | Stable branch `slideId`, per-slide speech gates/slots, captured audio segment routing; late-transcript test; real five-slide audio fixture retains distinct content |
| Pause/resume | Model/tool boundary barriers, speech/Slow-decision cancellation, publication pause epoch; tests cover pending inference, rendering across pause/resume, queued tasks, specialist image completion, queued eligibility and settlement |
| Refine past slides using later context | Full deck source/narration in model boundaries; Slow cross-slide edit test; live slide-4 correction changes slide 3 from 4.6 to 4.4 without selecting slide 3 for the edit |
| Broader edits, splitting and merging | Atomic `editMany`/`split`/`mergeSlides`; tests cover rollback, observation consistency, ID/selection survival, removed-target rejection, manual HTTP controls and the actual Slow tool loop |
| Image/component specialists | Two-child cap and queue-only completion retained; focused screenshots and target provenance supplied; private artifact integration permissions tested |
| Flare 2.5 exposed as a tool | SDK model type inspected; `image_generate` uses `gpt-image-2.5-flare`; mocked request asserts model/quality; actual live image generation, immutable storage and Chromium integration passed |
| Do not touch others' work / no frontend | All changes for this extension are within `orchestration/`; `git diff --name-only -- frontend` is empty |

### Complete live five-slide audio run

`runs/deck-2026-10-31T04-44-47-738Z/` is a complete real OpenAI run:

- Actual five-slide WAV, played at 4x for a stress test; one continuing Fast/Slow
  session, separate transcription segments bound to explicit fixture slide IDs.
- Explicit next, jump-back/return, and pause/resume exercised.
- **25 publications**, five distinct final slides, both agents idle, no renderer
  diagnostics, and **18/18 rendered-content/control-flow audit checks passed**.
- Final selection remained on slide 5. No publication occurred while paused.
- The correction spoken on slide 4 is reflected on slide 3: **3.2 → 4.4 / 5**.
- All five final PNGs were visually inspected: legible, consistent composition;
  distinct process/results/scenario/timeline layouts; no visible clipping.
- Run duration: **86.38 s**. First transcript to first publication: **4.43 s**.
  This is an accelerated fixture result, not a real-time microphone latency SLA.
- No speech or Slow-decision API errors; two stale edits were rejected.

Reproduce/audit with:

```sh
REPLAY_SPEED=4 npx tsx src/fixture-deck.ts
npx tsx src/audit-deck.ts runs/deck-2026-10-31T04-44-47-738Z
```

The earlier `runs/deck-2026-10-31T04-42-06-843Z/` was deliberately stopped after
Fast continued cosmetic/no-op edits. It is not a completed pass. An explicit
`finish` tool was added and the fixture rerun; the successful run used seven Fast
and three Slow finish calls. `finish` preserves the session and cannot skip
required child results or fresh pending work. Final automated checks additionally
cover a queued-decision pause race found after that live run.

### Live Flare + component integration

`runs/assets-2026-10-31T04-43-43-046Z/` verifies an actual **Flare 2.5** request and
real Chromium rendering with a generated image and registered custom element.
Both private specialists and Slow finished idle; final diagnostics were empty.
The final PNG was inspected. This smoke run deliberately uses deterministic
model choreography, not an LLM's autonomous asset-selection judgment.

```sh
npx tsx src/smoke-assets.ts
```

The audio run and asset smoke are separate checks; the audio run did not invoke
specialists. Automatic structure decisions are covered by the agent tool-loop
and HTTP tests, not claimed as observed behavior in that five-slide live run.

Remaining boundaries: no frontend wiring, no persistence/crash recovery, no UI
undo/redo, and no generalized speaker-note editor. Successful rendering or a
fixture-specific audit is not a general factual-accuracy guarantee.

## Fast service tier (2026-10-31)

Fast now explicitly requests Luna with `service_tier: "fast"` and reasoning
`none`; Slow/specialists retain their existing settings. A direct Responses API
probe with this account completed on `gpt-6-luna` and returned service tier
`fast`. The otherwise equivalent `ultrafast` request returned HTTP 400,
`Invalid service_tier argument`. These are availability probes, not latency
benchmarks. Model logs now record the tier actually served.

After this change: type check passed and **61/61 tests passed**. The earlier
five-slide live run used the previous unspecified tier; its timings are not
measurements of the newly configured Fast tier.

### Updated Slow configuration

Per the user's follow-up, Slow now requests **`gpt-6-sol` + `service_tier: "fast"`
+ reasoning `medium`**. Fast remains Luna/fast/none. Specialists remain
Sol/unspecified-tier/low. Type check and all **61 tests** pass, including adapter
assertions for all three roles. This configuration update has not been measured
in a new live deck run; earlier timings are not evidence for the updated settings.


## Push-to-edit and operational undo/redo (2026-10-31)

Implemented entirely under `orchestration/`; no frontend, dependency, fixture audio,
or other contributors' files changed for this addition. Existing model/tier settings
are unchanged. This verification uses deterministic model/Decision responses and
real Chromium in the HTTP test, not a new paid model or audio benchmark.

- `npm run check`: passed.
- `npm test`: **75 passed**; full output in ignored `runs/history-all-tests.txt`.
- `test/history-controls.test.ts`: 14 targeted regressions exercise prompt delivery
  to Slow without narration mutation or Decision calls; fixed targets across
  navigation; paused comments; empty/invalid input; content/frame and stable-ID
  restoration; slide creation, batch, split and merge; redo invalidation; no-op,
  render and log failure behavior; immutable assets; stale ABA branch rejection;
  uncooperative model/Decision/image providers; cancellation of sibling tool calls
  with valid history pairing; pause preservation; resurrected narration/revisions;
  fresh comments during restoration; empty stacks; serial repeated controls; and
  obsolete removed targets; and cancellation of an in-flight manual split.
- `test/api.test.ts`: real local HTTP/Chromium lifecycle now also verifies history
  status, empty undo, split/merge undo/redo, restored-slide screenshot availability,
  push-to-edit validation/receipt, and cancellation of queued comments while
  paused. The dummy key ensures this test needs no paid model requests.

These tests prove orchestration contracts, not the quality of arbitrary generated
edits. Prior live latency measurements above do not measure these new controls.
