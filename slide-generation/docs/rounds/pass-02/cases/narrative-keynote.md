# Pass 2: narrative-keynote breadth case

One serial real-model pair compared frozen baseline `734d84a` and candidate `7aee9be`. Both produced seven content-bearing slides, preserved the two exact quotations and authored the requested build order. The candidate's one additional automatic miss is terminal subtitle punctuation, not a missing slide or quotation. Audience build execution and design/stability review remain unqualified.

This report uses only completed evidence. No API calls, browser runs, tests or replay were performed while the remaining breadth jobs were live.

Evidence roots relative to `slide-generation/`:

- Baseline: `.artifacts/runs/headless-round-05-breadth/baseline/narrative-keynote/1/execution/slide-generation/.artifacts/run/`
- Candidate: `.artifacts/runs/headless-round-05-breadth/candidate/narrative-keynote/1/execution/slide-generation/.artifacts/run/`

## Recorded outcomes

| Fact | Baseline | Candidate |
|---|---:|---:|
| Input events retained | 10/10 | 10/10 |
| Model calls | 59 | 63 |
| Input tokens | 716,123 | 911,741 |
| Output tokens | 1,424 | 1,546 |
| Speech-decision / Fast / Slow-decision / Slow calls | 26 / 26 / 7 / 0 | 24 / 31 / 8 / 0 |
| Accepted / attempted model edits | 8/8 | 8/8 |
| Automatic visible passes / visible observations | 8/12 | 7/12 |
| Automatic visible failures | 0 | 1 |
| Manual-review observations | 4 | 4 |
| Final slide count | 7 | 7 |
| Settled / recording complete / final mandatory readiness | true / true / true | true / true / true |

All 12 observations are in the visible-effect denominator; this fixture has no separate timed-readiness observation. Final readiness is a different check. Both audits have no wrong-target routes and pass exact retained Prompt text by utterance ID. Cost is unknown. This single pair does not establish a speed or quality improvement.

## Requests, commits and first divergence

Neither trace has a refused edit, malformed tool call, incomplete browser-validation result or delegation. Baseline calls `read_source` nine times, `edit_source` eight and `finish` nine. Candidate calls `read_source` eight times, `edit_source` eight, `finish` nine and `read_speaker_notes` six. Candidate's extra read/inference activity is observable; whether it was useful requires examining the individual contexts rather than treating every read as waste.

Every accepted model edit is Fast. There are no Slow inference calls in either trace, despite seven/eight Slow eligibility decisions. Consequently, this case does not demonstrate that richer Slow context improves a sparse narrative deck.

Baseline's first accepted edit is at 14,557.267ms and its first verified opening frame at 15,406.868ms (`viewer/frame-000004.png`). Candidate's first edit is at 15,244.959ms and its first verified opening frame at 16,073.505ms (also `frame-000004.png`). The source/text distinction appears in that first composition:

- Baseline subtitle: `A fictional story about listening`
- Candidate subtitle: `A fictional story about listening.`

The `visible_exact` expectation requires the first string and the exact-string auditor therefore fails candidate a001. Actual verified frames and final source contain the full subtitle with an added period. Preserve the strict original result; classify it as a punctuation-level comparison difference requiring an explicit evaluator policy, not as evidence the opening content was absent. No broad semantic matching or retrospective score repair was applied.

Baseline accepted edit-result times are 14,557.267; 32,164.373; 60,554.240; 76,946.252; 97,943.433; 126,932.827; 153,565.782; and 191,133.075ms. Candidate times are 15,244.959; 32,634.726; 60,305.546; 79,870.370; 100,095.639; 128,650.161; 156,207.918; and 194,483.783ms. These are edit-return timestamps, not necessarily first-visible or settlement times. The fixture includes long pauses; it must not be treated as evidence of equivalent performance under the denser edit-heavy workload.

## Source faithfulness and visible checks

Both final sources contain:

1. The quiet handoff, with the requested fictional-listening subtitle (candidate adds the period).
2. The room, with `Nobody asked for another dashboard.`
3. What Mara said, with a real Quote element attributed to Mara: `We do not need more alerts. We need to know who is holding the problem.`
4. The pause, with `Listening changed the question.` as its main content.
5. The handoff, with `Name the owner.`, `State the next action.`, `Confirm the handoff.` in order.
6. A second voice, with a Quote attributed to Noor: `I can wait when I know someone has heard me.`
7. Leave a clear next step, with `A good handoff leaves nobody guessing.`

The individual exact quotation and quote-role observations pass in both audits. The candidate uses a heading rather than title role for “What Mara said”; the quotation itself remains a Quote, not a title. The main sentences and the three handoff phrases are observed exactly. Final source inspection finds no Stat or invented numeric claim; the broader “no invented metrics” and “no derived numbers” audits remain semantic/manual checks, not automatic proofs.

The four manual observations in each run are sparse design for The pause, authored build order for The handoff, no derived numbers, and sparse design for the closing. They are not demonstrated failures and must not be collapsed into missing-content counts. Conversely, a final source with the right text is insufficient to certify intentional hierarchy, absence of empty panels, or no unrequested churn during the talk's pauses. Those require the recorded images/video and history review.

## Build authoring is present; audience reveal is not exercised

Baseline assigns build 1/2/3 to `t43`, `t44`, `t45`; candidate assigns build 1/2/3 to `t44`, `t45`, `t46`. In both cases they correspond exactly to Name the owner, State the next action, Confirm the handoff. The final source therefore expresses the requested sequence.

All inspected visible-frame evidence has `surface: "editor"`. The timed fixture contains only utterance events; the headless host does not enter presentation mode and issue next-build controls. Its normal publications initialize build 0, and the current session/recording transport does not expose the audience build-control path. The live run thus does **not** demonstrate that these phrases appeared one at a time for the audience, that their final space was reserved while hidden, or that group state survived a concurrent publication. A rendered final slide or `build={n}` attribute is not reveal evidence. The `build_order` manual-review outcome is appropriate.

Use a separately recorded, controlled audience pass with exact final-source/dependency provenance and real build messages for that qualification. It must not overwrite this run, change its first-visible timings, or call a source-only replay an audience-control replay. No such pass was run for this case.

## Limits and general implications

This quieter narrative shows that both versions can preserve exact fictional quotations and complete sparse source content without edit refusals. It does not cancel the dense-talk attribution, stale-anchor or offscreen-completion failures found elsewhere in Pass 2. Candidate consumes more input tokens and Fast inferences here without improving the strict visible score; the only strict score difference is punctuation, so neither wholesale regression nor broad improvement follows from that score alone.

Keep the existing frozen artifacts and distinguish exact-text comparisons, semantic review, design review and actual audience-control coverage. The newly authored quality fixtures and their controlled-browser matrix remain authored, not live-validated. No new implementation or additional model batch is proposed as part of wrapping up this pass.
