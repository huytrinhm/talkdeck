# Edit-heavy baseline 1: no visible content generated

Status: diagnosed from recorded live evidence; no fix or paid follow-up was performed by this reviewer. Frozen generator: `5f970fb`; current common evaluator/observer as recorded in the run manifest. One trial, not a qualification sample.

The run retained all 22 inputs but produced three blank slides. This is a severe faithfulness failure, regardless of the successful structural readiness check. The first requested checklist never appeared, so subsequent edits also lacked their prerequisite content.

## Evidence and first divergence

All times below are the recorded host monotonic milliseconds, not time since the talk began. Talk start was 7,904.395 ms.

| Event | Time | Observation |
|---|---:|---|
| First utterance delivered | 13,763.418 | “Create a slide titled Launch checklist. Add the three items Draft, Review, and Publish in that order.” |
| Durable receipt | 13,767.706 | Original text retained; routing selected `n10`. |
| First gate decision | 14,535.258 | Dispatch. All 22 revisions ultimately dispatched. |
| First Fast request | 14,543.393 | Correct command present in speech and notes; `edit_source` offered. Context also says `speechLabel: "Audience-facing narration, not instructions."` |
| First Fast response | 16,214.026 | `read_source({nodeId:"n10"})`, 20 output tokens. |
| First source read | 16,217.8 | Slide contains Transcript/SpeakerNotes and no visible children. A second utterance has already been retained. |
| Second Fast response | 17,900.249 | `read_speaker_notes`, despite source read already containing the words. |
| First finish response | 28,466.503 | `finish({})`, after eight reads and no mutation. Six directives present in that request remain unfulfilled. |
| Last Fast response | 72,296.926 | `finish({})`; still no mutation in the entire run. |
| Observation ended | 100,349.841 | Driver reports settled; no driver errors or pending receipts. |
| Final readiness | 100,830.297 | `ready:true`, no Pending/findings, but `textRuns:0` for all three slides. |

The concrete model-action failure occurs when Fast repeatedly reads and then finishes without attempting a visible edit. This is not a rejected hash transaction, browser refusal, publication loss, output-limit truncation, or missing tool: there were **zero `edit_source` calls**, all provider responses were HTTP 200, Fast responses had status `completed`, and the request budget was 8,000 output tokens with reasoning effort `none`.

Across 27 Fast requests the responses contain exactly 11 `read_source`, three `read_speaker_notes`, and 13 `finish` calls. The 455 reported output tokens are explained by these small calls (13–22 tokens each). There are no screenshot calls. Forty-nine Decisions requests plus these 27 Responses requests consumed 614,025 input tokens. Slow, Slow-decision and specialist calls were all zero. Twenty-seven speech gate results were discarded as stale; their costs remain in the totals.

## Actual visible result

All 14 captured frame projections contain `content:[]`. The final n10 JPEG was inspected and is entirely blank. All three final JPEGs are byte-identical, SHA-256 `1f7a443ed938c5f10563d0c9a28c852dfaf461893803ab04edbabd41aa589b8d`. Final JSX contains only source-retention containers inside the live slides. The final live IDs are `n10`, `n22`, `n33`; Parking lot was never deleted, so final count is three instead of two.

The automatic audit records 15 failures, 14 manual-review outcomes and one pass. That pass, `edit-heavy-a010`, is absence of Draft on an already blank slide. Its 11,551.867 ms observation is not evidence of useful generation or successful execution of the earlier add/remove sequence. The original metric remains preserved. Structural readiness proves neither requested-content coverage nor faithfulness.

There is no independent audience/build-reveal recording. Final server JPEGs and editor captures do not qualify audience build behavior.

## Root-cause hypotheses and independent defects

1. **Contradictory input semantics, confirmed in serialized context.** The headless role instructions explicitly authorize spoken editing commands, but the fresh context labels the same speech as narration rather than instructions. The Decisions prompt similarly says narration is not commands. This is a strong candidate for no-op behavior, not proven sole causation: all decisions still dispatched and a controlled next trial must demonstrate an accepted edit after removing the contradiction. Raw responses provide no explanation for choosing `finish`.
2. **Broad-work dispatch gap.** Fast's role instruction assigns theme/library and cross-slide work to Slow. The actual offered tools contain neither delegation nor a request to wake Slow. No Slow activation occurred. Reorder/delete requests therefore lack an observed handling path. Fixing the narration label alone would not demonstrate that this path works.
3. **Routing defects remain independently observable.** `edit-heavy-021`, explicitly “On Release checklist,” was routed to Owners (`n22`). `edit-heavy-016` names Owners but was retained on `n10`. The latter is a cross-slide reorder command, so expected navigation should be reviewed separately from which slide receives its durable command. No alias was rebound to hide either route. `edit-heavy-022` mismatch inherits the earlier incorrect working target; it is not another explicit named-target instruction.
4. **Repeated reads/context cost.** Frequent private-source revisions arrive during inference; the model responds by reading again rather than composing. This plausibly increases delay and context cost, but there are no conflict rejections to justify a claim of hash-conflict starvation. Record a post-fix accepted edit before optimizing context or introducing retries.

Classification: model intent/context, orchestration capability, routing. Highest affected priorities: faithfulness and responsiveness. Severity: blocks useful output throughout this trial. Recurrence: all three slides and all positive-content expectations in this one trial; no cross-run frequency claim.

## Verification needed before broader repetitions

Preserve this failed trial. Add deterministic regressions for actual serialized command semantics, available broad-work dispatch, and named-target routing. Replay the original recorded tool responses without live fallback to verify the observed no-op path remains reproducible. A small fresh live diagnostic should then prove at least one requested visible edit reaches the real viewer, with source, check, publication and frame evidence. Only that new evidence can test the causal hypothesis; deterministic replay cannot invent a counterfactual model response.

Do not adjust fixture assertions, exclude missing content, or promote readiness to faithfulness. Keep broader five-talk qualification false until the required runs and manual reviews exist.

## Immutable artifact references

- [Run report and original metric interpretation][review]
- [Driver delivery and termination record][driver]
- [Initial model request/response, provider-request-4][request4]
- [Second request with issued source read, provider-request-7][request7]
- [First finish request/response, provider-request-25][request25]
- [Exact scheduler trace][scheduler], [provider accounting][provider], [route table][routes], [audit][audit]
- [Final JSX][jsx], [final readiness][readiness], [final blank slide n10][image], [original viewer gallery/video][gallery]

[review]: ../../../../.artifacts/runs/headless-round-01/baseline/edit-heavy/1/execution/slide-generation/.artifacts/run/review.md
[driver]: ../../../../.artifacts/runs/headless-round-01/baseline/edit-heavy/1/execution/slide-generation/.artifacts/run/driver-result.json
[request4]: ../../../../.artifacts/runs/headless-round-01/baseline/edit-heavy/1/execution/slide-generation/.artifacts/run/model/031a43d7ada96b78aa4859747e26bd801cc9c463d1b265aede0a8a3d2fa86594.json
[request7]: ../../../../.artifacts/runs/headless-round-01/baseline/edit-heavy/1/execution/slide-generation/.artifacts/run/model/ed055138729758edfd3e8564c2dc72b3b8e6608111c2a899b3970e12dfca8403.json
[request25]: ../../../../.artifacts/runs/headless-round-01/baseline/edit-heavy/1/execution/slide-generation/.artifacts/run/model/c83dde5dc3e35c56de1d65ec05d0a411b23acc2bd9cab06139366d1d2825b2d5.json
[scheduler]: ../../../../.artifacts/runs/headless-round-01/baseline/edit-heavy/1/execution/slide-generation/.artifacts/run/scheduler.jsonl
[provider]: ../../../../.artifacts/runs/headless-round-01/baseline/edit-heavy/1/execution/slide-generation/.artifacts/run/provider-statistics.json
[routes]: ../../../../.artifacts/runs/headless-round-01/baseline/edit-heavy/1/execution/slide-generation/.artifacts/run/routes.json
[audit]: ../../../../.artifacts/runs/headless-round-01/baseline/edit-heavy/1/execution/slide-generation/.artifacts/run/audit.json
[jsx]: ../../../../.artifacts/runs/headless-round-01/baseline/edit-heavy/1/execution/slide-generation/.artifacts/run/final/deck.jsx
[readiness]: ../../../../.artifacts/runs/headless-round-01/baseline/edit-heavy/1/execution/slide-generation/.artifacts/run/final/readiness.json
[image]: ../../../../.artifacts/runs/headless-round-01/baseline/edit-heavy/1/execution/slide-generation/.artifacts/run/final/slide-n10.jpg
[gallery]: ../../../../.artifacts/runs/headless-round-01/baseline/edit-heavy/1/execution/slide-generation/.artifacts/run/viewer-gallery.html
