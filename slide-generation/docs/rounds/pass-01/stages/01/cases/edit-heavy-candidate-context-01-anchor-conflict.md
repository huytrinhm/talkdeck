# Edit-heavy candidate-context 1: private-input anchor conflict, then no recovery

Status: reviewed from completed real run. This candidate includes the speech-label, routing and deletion changes; it is **not** a pure speech-label ablation. No code, evaluator or fixture assertions were changed during this review.

The candidate attempted one visible edit, which correctly failed exact-hash validation after new speaker notes changed its anchor. It never retried a mutation. All three final slides remain blank, and a later named-target routing failure leaves one received utterance outside the canonical source. This trial does not demonstrate an improvement in useful visible output.

## First divergence and causal evidence

Times are recorded host monotonic milliseconds. Talk start: 2,005.034 ms.

| Event | Time | Evidence |
|---|---:|---|
| First checklist instruction delivered | 7,864.598 | Correct raw text and working slide `n10`. |
| First Fast inference starts | 8,473 | Context now says “Speaker content and explicit slide editing requests. Apply the requested changes while preserving original source evidence.” |
| First `read_source` completes | about 10,044 | Snapshot `e3cf2731-c5dc-4b6f-a588-86e8ae57f3ac` includes first and second inputs. |
| Extra `read_speaker_notes` response | 11,479 | Repeats source evidence already supplied in the read. |
| Edit inference starts | 11,486.287 | Model has the old source snapshot. |
| Third input delivered | 11,863.784 | “Change Review to Verify. Change nothing else.” |
| Third input source commit | 11,878.331 | Changes the closing speaker-notes line; no visual content changes. |
| `edit_source` executes | 13,737.985–13,741.742 | Refused: `Target must match exactly once inside its node`. |
| Four subsequent reads | 13,745–19,792 | Fresh source is obtained, but no revised edit is sent. |
| First `finish` response | 21,308 | Unfulfilled visible instructions remain. |

The proposed insertion contains the title Launch checklist and bullets Draft, Review, Publish, Monitor. It anchors `insert_after` to source line 4, hash `0fc8e6554bac73cdfa339b096e9c443f1d2d9c7bf68845131b997872b80ebb00`, whose issued text was:

```jsx
Add an item called Monitor after Publish.</SpeakerNotes>
```

The third input changes that part of the source to:

```jsx
Add an item called Monitor after Publish.
Change Review to Verify. Change nothing else.</SpeakerNotes>
```

The old whole-line anchor no longer exists. Exact rejection is required and correct; accepting a guessed or weakened match would violate the hashline contract. The failure is the choice of a mutable private-notes anchor for a visual insertion, followed by no mutation recovery. The candidate never reaches schema/browser validation for this edit, so this case does not establish whether the proposed layout would pass those checks. The correction arriving during inference would also require eventual Review→Verify handling if the old visual insertion had committed.

## Final result and secondary failure

The final run has 77 model calls: 31 Fast Responses and 46 Decisions, with 798,361 input tokens and 713 output tokens. Tool calls are 14 `read_source`, six `read_speaker_notes`, ten `finish`, one rejected `edit_source`. There are zero accepted visual edits, screenshot requests, Slow calls, Slow-decision calls or specialist calls. All 14 captured native projections are empty. Each final JPEG has the same SHA-256 as the inspected blank baseline JPEG: `1f7a443ed938c5f10563d0c9a28c852dfaf461893803ab04edbabd41aa589b8d`.

At 61,014.983 ms the user says “On Release checklist, reveal Monitor and Draft together, then Publish and Verify together.” Durable pending-input receipt succeeds at 61,063.002 ms. Since the earlier rename was never performed, the named-target router rejects `Release checklist` with `Named editing target does not match a live slide title`. Its exact words remain in the pending-input journal, but no Prompt for `edit-heavy-021` enters canonical live/archive source. Driver receipts therefore report 22/22 retained while the exact canonical-source audit correctly reports only 21/22. These are distinct guarantees. The trial ends `host-error` at 94,445.056 ms, with `recordingComplete:false`; the error is preserved in `failure.json`.

The final deck still has three slides, no deleted Parking lot archive, and structural `ready:true`. As in baseline, the only automatic pass is absence of Draft from an already blank slide; the remaining results are 15 failures and 14 manual reviews. No latency or qualification improvement follows from that absence-only pass. The audience/build surface remains untested.

## Diagnosis and next verification

- The context change coincides with a first edit attempt, unlike the baseline's zero attempts. Multiple code changes and one trial do not prove the label change alone caused that difference.
- Private input invalidated a private anchor while visual geometry remained unchanged. Prefer stable visual/closing-slide anchors for inserting visible content, and preserve exact-hash conflict semantics. Stable private-container formatting may reduce accidental contention but needs separate tests and replay.
- Re-reading after conflict is insufficient if the actor then finishes without the requested visible result. Add a focused regression/replay demonstrating conflict recovery through an actual accepted transaction and visible frame; do not force meaningless edits merely to satisfy a count.
- An unresolved spoken title must remain durable and explicitly unresolved. Avoid routing to an arbitrary different slide to make the audit pass. Inspect whether actual user-origin rename history can identify the intended stable slide without consulting evaluator aliases; distinguish unresolved input from canonical integration success.
- Broad reorder/delete work still has no observed Slow activation path; the label fix does not address that separate issue.

Classification: hash conflict, model recovery, routing/source integration. Severity: no useful visible output in this trial, plus one canonical input integration failure. Preserve this failed sample and the unchanged evaluator before another controlled diagnostic. No paid follow-up or implementation was performed by this reviewer.

## Original artifacts

- [Report][report], [driver][driver], [failure][failure], [provider totals][provider], [audit][audit]
- [Exact edit request/response][request], [tool call and refusal][tool], [intervening third-input source state][state]
- [Unresolved utterance's durable receipt][pending], [final source][source], [final blank n10][image], [viewer gallery/video][gallery]

[report]: ../../../../../../.artifacts/runs/headless-round-01/candidate-context/edit-heavy/1/review.md
[driver]: ../../../../../../.artifacts/runs/headless-round-01/candidate-context/edit-heavy/1/driver-result.json
[failure]: ../../../../../../.artifacts/runs/headless-round-01/candidate-context/edit-heavy/1/failure.json
[provider]: ../../../../../../.artifacts/runs/headless-round-01/candidate-context/edit-heavy/1/provider-statistics.json
[audit]: ../../../../../../.artifacts/runs/headless-round-01/candidate-context/edit-heavy/1/audit.json
[request]: ../../../../../../.artifacts/runs/headless-round-01/candidate-context/edit-heavy/1/model/cedcc91fe619e16af61ef58c717177cd06d3d24720114aa702d2ac04a42e3670.json
[tool]: ../../../../../../.artifacts/runs/headless-round-01/candidate-context/edit-heavy/1/tools/1aac43a28c0ed3851f139afcafb544abd8ec2957b050aed7ac18fcb830675e5c.json
[state]: ../../../../../../.artifacts/runs/headless-round-01/candidate-context/edit-heavy/1/states/bc99a6efd76692c528c35769219568b997ea906deb8f17132c23a29a7f149c4d.json
[pending]: ../../../../../../.artifacts/runs/headless-round-01/candidate-context/edit-heavy/1/pending-input/000021-cfbd4ef8aba056e4d2672975b9da20e62540359be7992f4982048f7ba96a75b1.json
[source]: ../../../../../../.artifacts/runs/headless-round-01/candidate-context/edit-heavy/1/final/deck.jsx
[image]: ../../../../../../.artifacts/runs/headless-round-01/candidate-context/edit-heavy/1/final/slide-n10.jpg
[gallery]: ../../../../../../.artifacts/runs/headless-round-01/candidate-context/edit-heavy/1/viewer-gallery.html
