# Edit-heavy pair 1: renderer metadata blocks otherwise schema-valid edits

This is one real timed A/B pair, not qualification. Frozen baseline `5f970fb` and candidate `16a1671` ran sequentially at authored pace. The current evaluator, observer and runner hashes match across both manifests. Their harness source SHAs differ because a documentation commit landed between launches; the three recorded implementation hashes are identical. No fixture assertions or raw outputs were changed for this review.

| Recorded result | Baseline | Candidate |
|---|---:|---:|
| Provider calls | 77 | 74 |
| Input tokens | 724,010 | 691,788 |
| Output tokens | 547 | 1,464 |
| Fast model calls | 29 | 27 |
| Decisions calls | 48 | 47 |
| Model visual edit attempts | 0 | 5 |
| Accepted model visual edits | 0 | 0 |
| Final live slides | 3 | 3 |
| Canonical input retention | 22/22 | 21/22 |
| Automatic expectation passes | 0/30 | 0/30 |
| Fail / manual-review | 15 / 15 | 15 / 15 |
| Driver termination | settled | host-error |
| Final structural readiness | true | true |

All final JPEGs on both sides share SHA-256 `1f7a443ed938c5f10563d0c9a28c852dfaf461893803ab04edbabd41aa589b8d`. The candidate n10 JPEG was inspected: an entirely blank canvas. Each run has 14 captured native projections, all empty. Thus no useful generation improvement or visible-correct latency improvement is established. The current absence guard correctly gives no automatic credit for deleting content that never appeared. This is a shared evaluator change, not a product regression from the earlier round's vacuous 1/30.

## Candidate first divergence

Times below are recorded host monotonic milliseconds.

1. At 23,214.075 ms, Fast requests title/list insertion before the stable `</Slide>` line. This avoids the private-notes anchor conflict from the previous candidate. The proposal includes `Text color="--color-accent"`; schema correctly refuses the token spelling. The next proposal uses `color="accent"`.
2. At 26,750.911–27,049.662 ms, the first schema-valid insertion is refused with `All required validation stages must complete before an edit can commit`. The model receives no underlying finding. The proposal has title Launch checklist at scale 1.2 and numbered bullets Monitor, Draft, Verify, Publish.
3. At 39,172.283, 43,321.966 and 49,965.733 ms, further proposals account for the rename, order and caption instructions, but receive the same generic validation-unavailable error. No visual proposal commits.

This is not evidence that browser permissions were blocked. After the live pair ended, the rendering agent reconstructed the exact first schema-valid refused candidate using its issued read, verified hashes and source state. Fresh handle remapping is recorded; source candidate SHA-256 is `0f9c6963fa07391e175eaf8f5df9c65fb0d0257515a77224e30708a5d52f901c`. No paid call was made and the frozen generator was not edited. Actual Chromium validates the empty baseline successfully, then fails candidate measurement with:

```text
Native text is missing node identity or typography role
```

DOM inspection identifies all four numbered markers, e.g. `<span class="td-bullet-marker" aria-hidden="true">1.</span>`. They resolve to Bullets node `b23` but have no typography role. They are rendered text at 32px, even though excluded from assistive content by `aria-hidden`. The renderer and checker contract disagree. The appropriate repair is truthful role/identity metadata and regression coverage for measured markers, preserving native geometry/contrast checks. Weakening validation or calling this a model refusal would conceal the product defect.

The engine also loses actionable diagnostics: its incomplete-report branch throws the generic message rather than returning/recording the actual validation findings. Repeated model retries cannot diagnose a missing marker role from the supplied error. Preserve staged candidate and full reports with the transaction result in a separately tested observability fix.

## Other unresolved failures

At 30,129 ms Fast calls `request_deck_edit` with eight cumulative utterances joined in `sourceQuote`. The tool requires one exact complete retained utterance and refuses. There are no Slow, Slow-decision or specialist model calls. This shows a failed handoff attempt, not evidence of Slow-generation behavior. Expose the exact quoting contract clearly and verify a genuine cross-slide task reaches Slow; do not relax source provenance to arbitrary paraphrases.

`edit-heavy-021` still names Release checklist before a rename has successfully committed. Routing rejects the unresolved title; its raw pending-input receipt survives but canonical Prompt retention fails. This repeats the earlier context-candidate case. Three blank slides remain, including undeleted Parking lot. The candidate driver reports `recordingComplete:true` alongside host-error, while the final review/failure correctly records aggregate completion false. Those fields must distinguish trace/receipt completion from successful host processing and canonical integration.

No independent live audience build sequence was exercised. Final empty screenshots and structural readiness cannot qualify faithfulness, layout/design quality, or audience behavior. Differences in total tokens/calls are descriptive only; there is no successful-work speed or cost comparison.

## Verification required

Fix marker metadata in isolation and test a real numbered/disc list through render, actual browser checks and accepted engine transaction. Replay the refused candidate after the fix to establish the defect is removed; preserve the old raw refusal. Add a negative control that still refuses genuinely unowned native text. Verify the diagnostic-preservation change separately. Then remeasure a new frozen candidate against the unchanged baseline and current common evaluator. Do not claim these repairs resolve all-talk behavior before actual evidence.

## Evidence

- [Batch manifest/status][batch]
- [Baseline report][baseline], [candidate report][candidate], [candidate failure][failure]
- [First schema-valid refused tool call][tool], [failed deck-edit handoff][handoff]
- [Exact reconstruction and provenance][reconstruction], [full browser reports][browser], [missing-role DOM leaves][dom]
- [Candidate final screenshot][image], [candidate original viewer timeline/video][gallery]

[batch]: ../../../../../../.artifacts/runs/headless-round-02/batch.json
[baseline]: ../../../../../../.artifacts/runs/headless-round-02/baseline/edit-heavy/1/execution/slide-generation/.artifacts/run/review.md
[candidate]: ../../../../../../.artifacts/runs/headless-round-02/candidate/edit-heavy/1/execution/slide-generation/.artifacts/run/review.md
[failure]: ../../../../../../.artifacts/runs/headless-round-02/candidate/edit-heavy/1/execution/slide-generation/.artifacts/run/failure.json
[tool]: ../../../../../../.artifacts/runs/headless-round-02/candidate/edit-heavy/1/execution/slide-generation/.artifacts/run/tools/1bb35389148998a5614553957ad900961a55a38c78cb2ecde1cc1d7932eaa5b6.json
[handoff]: ../../../../../../.artifacts/runs/headless-round-02/candidate/edit-heavy/1/execution/slide-generation/.artifacts/run/tools/dd3942385e589f8e7427d99deeb566b8379c1ae1ee5354ed0a9de21f3153436c.json
[reconstruction]: ../../../../../../.artifacts/review/round02-validation-refusal/reconstruction.json
[browser]: ../../../../../../.artifacts/review/round02-validation-refusal/browser-report.json
[dom]: ../../../../../../.artifacts/review/round02-validation-refusal/missing-role-dom.json
[image]: ../../../../../../.artifacts/runs/headless-round-02/candidate/edit-heavy/1/execution/slide-generation/.artifacts/run/final/slide-n10.jpg
[gallery]: ../../../../../../.artifacts/runs/headless-round-02/candidate/edit-heavy/1/execution/slide-generation/.artifacts/run/viewer-gallery.html
