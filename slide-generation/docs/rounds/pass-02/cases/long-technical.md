# Pass 2: long-technical — baseline timed out; candidate user-skipped

**Incomplete pair result.** Baseline `734d84a` timed out; the user explicitly skipped candidate `7aee9be`, and its process tree has stopped. The earlier checkpoint below is retained with its original partial counts and timestamps. Do not turn partial receipt counts, growing delays or a valid intermediate deck into a completion/quality verdict. This checkpoint preserves evidence for continuation; it does not authorize a fix or another live batch.

Baseline evidence root, relative to `slide-generation/`:

`.artifacts/runs/headless-round-05-breadth/baseline/long-technical/1/execution/slide-generation/.artifacts/run/`

Read-only sources used: `pending-input/*.json`, `scheduler.jsonl`, existing `states/*.json`, and current `runtime/deck.json`. These files continue to grow during the trial. The measurements below are anchored to original event IDs and monotonic timestamps so they can be rechecked after export. No model/browser/test/replay runs or runtime changes were made for this diagnosis.

## Terminal baseline update

`batch.json` marks baseline job 7 `status: "timeout"`, `exitCode: null`. There was no additional model retry. The driver and outer watchdog have separate boundaries:

- `driver-result.json` records deadline 485,842.722ms and `finishedAtMs: 485844.222203`, `termination: "deadline"`, `settled: false`, `recordingComplete: false`. Its error is `Recording did not complete before the drain deadline`.
- All **58** input outcomes in that driver report are `retained`, with empty pending/undelivered lists. These refer to outer durable receipts, not delivery into canonical source or Fast.
- Work continued during finalization/draining after the driver's deadline. The batch controller ultimately timed out the process at approximately **603,400ms**, as observed by the parent run controller. The last saved scheduler event is at **603,202.920ms**. The recorded batch status is authoritative; do not interpret absence of a normal exit code as success.
- The last saved `runtime/deck.json` contains **20 live slides and 34 Prompts**, versus the fixture's **34 requested slides and 58 utterances**. The outer `pending-input/` directory contains **58** durable records, and the scheduler contains **34** canonical `utterance_retained` events. Thus **24** retained original inputs had not reached canonical Prompt/actor delivery in the saved state. The newest slide had been created without its first input yet being delivered.
- Last canonical receipts are inputs 032/033/034 at 559,360.445 / 559,390.848 / 559,436.862ms. They occur after the driver's deadline; the final saved state must not be described as the state at 485,844ms.

Normal final exports are missing: `final/` is empty, and there is no `metrics.json`, `audit.json`, `operations.json`, `commits.json`, `provider-cassette.json`, `provider-statistics.json`, or normal `review.md`. The driver report, partial scheduler/model/tool/state/viewer files and saved runtime source remain available. Total model usage, final readiness, complete visible coverage and final publication/recording integrity are **not established**. Do not invent aggregate usage or treat the valid saved JSON as a completed deck.

Missing normal commit/operation/provider exports prevent the standard complete transaction-replay and comparison paths. Any later evidence-only recovery must use a new output location and remain labeled partial/timeout; it cannot repair this trial into a completed compatible sample. There is no complete paired result; the candidate interruption is documented below.

## Terminal candidate update: user-skipped

The user explicitly requested “skip this example.” `user-stop-request.json` in the batch root records semantic classification **user-skipped**, the original SIGTERM request and the parent's later forced stop of the selected nine-process tree when SIGTERM did not exit. `batch.json` reports job 8 mechanically as `failed`, `exitCode: null`; that process status must not be misreported as a second independently observed timeout or a completed quality trial. No replacement trial was launched.

The stopped candidate's saved `runtime/deck.json` has **13 live slides and 22 Prompts**. There are **43** outer durable input records and **22** canonical `utterance_retained` events; its last scheduler timestamp is **251,242.708ms**. Thus 21 delivered/externally retained inputs had not reached canonical source in the saved state, and the remaining 15 of the fixture's 58 events were not delivered before the stop. These counts are later than the interim 13-slide/21-Prompt/41-receipt observation while shutdown was still pending.

Candidate `final/` is empty. It has no normal `driver-result.json`, metrics, audit, commit/operation export, provider cassette/statistics or final report. Partial model/tool/viewer/state files and original retained input remain available. No total usage, completed readiness, full coverage or paired quality comparison is inferred. Its backlog is a partial observation censored by the user's stop, not an autonomous deadline outcome.

Neither long trial is eligible for the standard complete transaction replay because required exports are absent. Offline replay work is restricted to the six completed shorter breadth trials, in new output directories; neither incomplete long recording will be repaired or retried to produce a pass.

## Separate outer retention from canonical delivery

At the inspected checkpoint, 29 outer durable input files existed but only 15 `utterance_retained` scheduler events had reached the canonical actor path. The original words were retained externally; the remaining inputs had not yet reached Fast. Earlier counts such as eight slides/14 Prompts versus 21 receipts are earlier checkpoints, not final outcomes.

| Input | Delivered at (ms) | Canonical actor receipt at (ms) | Difference (ms) |
|---|---:|---:|---:|
| long-technical-001, opening | 12,643.259 | 12,672.2 | 29.0 |
| long-technical-002, new slide | 18,642.8 | 19,877.0 | 1,234.1 |
| long-technical-003, new slide | 24,945.4 | 27,487.7 | 2,542.3 |
| long-technical-007, new slide | 36,943.8 | 43,946.9 | 7,003.1 |
| long-technical-008, new slide | 45,343.8 | 52,277.0 | 6,933.1 |
| long-technical-009, new slide | 55,743.2 | 68,512.1 | 12,768.9 |
| long-technical-010, new slide | 62,043.4 | 87,660.0 | 25,616.6 |
| long-technical-011, continuation | 63,643.5 | 87,691.2 | 24,047.7 |
| long-technical-012, continuation | 65,243.6 | 87,718.5 | 22,474.9 |
| long-technical-013, continuation | 66,843.5 | 87,736.8 | 20,893.2 |
| long-technical-014, new slide | 73,643.0 | 109,778.4 | 36,135.4 |
| long-technical-015, new slide | 80,042.959 | 135,287.984 | 55,245.025 |

The three continuations after input 010 reach canonical delivery within approximately 77ms of that input, despite having waited more than 20 seconds each. This is direct evidence of a preceding routing/creation bottleneck, not three independent long speech-decision or model calls. By contrast, inputs 005 and 006 in an earlier unblocked interval reach the canonical actor path in about 18ms and 23ms.

The host first writes durable outer input, then processes a serialized routing tail. A new-slide command awaits creation and selection before calling `actors.deliverUtterance`. See [evaluation-host.ts](../../../../src/headless/evaluation-host.ts). Do not confuse the early outer retention acknowledgment with canonical Prompt retention or Fast eligibility.

## Delay persists after slide creation

`deck_changed`/`published` scheduler events identify successful structural publication before the new slide's first canonical utterance. The interval to that utterance grows with the deck:

| Structural event at (ms) | Following input | Canonical receipt minus structural event (ms) |
|---:|---|---:|
| 19,080.632 | 002 | 796.3 |
| 25,978.503 | 003 | 1,509.2 |
| 40,557.055 | 007 | 3,389.8 |
| 48,306.013 | 008 | 3,970.9 |
| 63,837.776 | 009 | 4,674.4 |
| 82,221.269 | 010 | 5,438.7 |
| 103,625.032 | 014 | 6,153.4 |
| 128,278.067 | 015 | 7,009.917 |

For input 015, the new slide `n77` already exists at the 128,278ms structural event. Its utterance does not reach the canonical actor path until 135,288ms. The cause cannot be described solely as model reasoning before creating that slide.

The concrete awaited path is [JsxBackend.createSlide/navigate](../../../../src/host/jsx-backend.ts) → headless `onSelection` → [GenerationSession.selectSlide](../../../../src/host/session.ts). Selection queues render/full-deck validation and publication and waits for the session tail before the routing call continues to input delivery. Creation and model edits also share the backend mutation serialization queue. These code paths explain why successful structural creation does not immediately release the waiting input.

Existing independent state-check artifacts show actual browser work across the growing deck: the state at 128,266.053ms checks nine slides with summed per-slide `durationMs` of approximately 3,475.6ms; the state at 147,011.194ms checks nine slides with approximately 5,198.7ms summed duration; the state at 155,897.913ms checks ten slides with approximately 3,888.4ms. These are recorder state-check spans, **not** a decomposition of the preceding tool or routing wait. Different validation/publication/recording work can overlap; do not add these sums to other wall-clock intervals or claim an unrecorded engine-stage timing.

## Fast has its own additional backlog

Canonical receipt does not imply immediate model work. Actual Fast inference contexts show:

- Input 014 is canonical at 109,778.4ms on `n67`; Fast's first subsequent inference targeting `n67` is at 120,254.938ms, about 10.48 seconds later.
- Input 015 is canonical at 135,287.984ms on `n77`; Fast's first subsequent inference targeting `n77` is at 147,034.212ms, about 11.75 seconds later.

These intervals include eligibility/scheduling and preceding active work; they are not attributed entirely to model service latency. Recorded completed Fast edit calls expose growing tool durations:

| Edit started at (ms) | Tool result at (ms) | Recorded duration (ms) |
|---:|---:|---:|
| 63,432.601 | 76,346.405 | 12,913.8 |
| 80,402.414 | 96,749.154 | 16,346.7 |
| 100,539.100 | 120,252.054 | 19,712.9 |
| 124,719.080 | 147,031.133 | 22,312.0 |

These are successful edit operations and include time awaiting serialized mutation work and validation. Source reads in the same interval finish in roughly 1–2ms. Slow performs read/finish cycles between these long edits. The available events establish both upstream routing backlog and downstream Fast work backlog; they do not provide exact per-stage engine queue/render/check/CAS durations.

## Completion follow-up still required

Both trial processes have now stopped, with the incomplete outcomes above. Preserve partial retention, routing, source and viewer evidence without fabricating the missing final exports. Preserve any externally retained inputs that never reached canonical source as a distinct failure; do not count them as model-visible just because their outer receipt succeeded. The final candidate snapshot uses the same outer/canonical distinction. Any later evidence-only inspection must remain separate from the original recordings and retain the user-skipped classification.

No source/scheduling/cache change is proposed or performed during this checkpoint. The user's scope is to finish and report the current pass, then stop.
