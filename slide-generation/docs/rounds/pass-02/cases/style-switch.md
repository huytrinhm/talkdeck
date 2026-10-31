# Pass 2: style-switch breadth case

One serial real-model pair compared frozen baseline `734d84a` and candidate `7aee9be`. Existing recordings show more complete candidate final content, but later publication misses the audience's original slide visits. This is a case diagnosis, not a repeated qualification or proof that one context change caused every difference. No runtime changes, browser runs, API calls or tests were made for this case.

Evidence roots, relative to `slide-generation/`:

- Baseline: `.artifacts/runs/headless-round-05-breadth/baseline/style-switch/1/execution/slide-generation/.artifacts/run/`
- Candidate: `.artifacts/runs/headless-round-05-breadth/candidate/style-switch/1/execution/slide-generation/.artifacts/run/`

The literal provider requests, source commits, operations, routes, audit, metrics and viewer projections remain unchanged.

## Denominators and observed result

| Fact | Baseline | Candidate |
|---|---:|---:|
| Retained inputs | 15/15 | 15/15 |
| Provider calls | 77 | 86 |
| Input tokens | 901,113 | 1,514,495 |
| Output tokens | 2,949 | 3,427 |
| Fast / Slow inference calls | 28 / 13 | 31 / 22 |
| Speech / Slow-decision calls | 32 / 4 | 31 / 2 |
| Accepted / attempted model edits | 8/11 | 9/10 |
| Successful visible observations | **3/21** | **2/21** |
| Timed readiness observations | 0/1 | 0/1 |
| Final complete readiness / recording complete / settled | true / true / true | true / true / true |

There are 22 total observations: 21 visible plus one readiness. Reporting 3/22 or 2/22 as visible coverage mixes effects. Many visible checks remain manual, so these are automated observation counts, not a complete quality score. Cost remains unknown.

The readiness miss also needs qualification. The auditor uses the final exported readiness timestamp and requires it inside the observation window. Baseline final readiness is at 118,654.613ms, later than its 116,948.542ms deadline; candidate final readiness is at 121,799.506ms, later than 118,190.100ms. This does not mean final checks failed. Candidate also records a successful same-final-revision `presentation_readiness` tool result at 111,968.250ms, but the current timed-readiness audit does not consume that proof. Preserve the original scores and diagnose this evidence-selection limitation separately.

## First divergences and actual tool failures

Baseline first commits the opening title at 15,647.8ms; candidate at 16,264.3ms. The initial opening composition therefore does not establish a candidate speed improvement.

Baseline then forwards a concatenation of the opening and frame utterances through the old quote interface and is refused at 19,821.457ms. A subsequent exact frame request succeeds. Its remaining edit refusals are:

- At 22,982.250ms, a deck-scoped snapshot is reused with Theme node `n3`: `Read this node before editing` (`unknown_snapshot`).
- At 52,312.704ms, a Practice insertion refuses after validation retries: `Source changed repeatedly during validation; reread and retry`.
- At 94,562.480ms, another mismatched read scope is reused for opening slide `n10`, again `unknown_snapshot`.

Candidate's sole edit refusal is at 29,596.509ms: Slow tries to insert the subtitle immediately after an older title boundary after Fast has already added it. The exact insertion gap changed, so `Target must match exactly once inside its node` refuses the stale request. This prevents duplicate content; it is not a reason to weaken insertion matching.

Candidate uses 25 `read_source` calls versus baseline's 12, and makes 22 Slow inferences versus 13. It also asks for two `presentation_readiness` checks and one screenshot. These counts identify additional work and context use; they do not by themselves establish which work was unnecessary or prove the cause of latency.

## ID delegation and duplicate behavior

Candidate submits four `request_deck_edit` calls using utterance IDs. They create three tasks and one duplicate receipt, with no refusal:

- `style-switch-002`, theme/frame task, succeeds at 22,794.789ms.
- `style-switch-009`, keep the new point in the dark theme, succeeds at 59,857.775ms. Its routing problem is described below.
- `style-switch-011`, Workshop review frame label, succeeds at 66,958.056ms.
- Repeating `style-switch-011` at 70,738.111ms returns `duplicate:true` and the same ID, `92a4b4df-2f7b-49d8-b818-56ef6285b23e`. There is no additional delegation event/task.

The exact original words remain in each `deck_edit_requested.sourceQuote`; the model does not supply task text. Baseline's five quote calls include one concatenation refusal and four accepted tasks, including two separate theme requests for `style-switch-007` across different speech snapshots. Candidate's successful deduplication only proves the actual same-snapshot retry case tested here.

## Wrong target after an offscreen named edit

Both audits identify the same attribution failure:

1. `style-switch-008`: “On Practice, add a fourth point: Share the findings.” correctly targets Practice while the audience remains on Timebox.
2. `style-switch-009`: “Keep the new point in the new dark theme, even if an older styling operation finishes late.” is a continuation of that edit, but has no explicit title prefix.
3. The host falls back to the selected audience slide and retains the continuation under Timebox instead of Practice.

`routes.json` records baseline Practice `n29` then Timebox `n33`, and candidate Practice `n23` then Timebox `n33`. `audit.json.wrongTargetRoutes` independently identifies `style-switch-009` in both trials. The candidate later delegates that ID from Timebox, so the delegation correctly enforces its stored provenance but inherits the host's wrong attribution. Stronger ID validation cannot recover the intended editing target after the host has chosen the wrong one.

This is a general distinction between audience selection and a continuing named editing target, not a reason to hardcode Practice or this fixture's aliases. A future routing change must preserve original words, handle explicit navigation/retargeting, and avoid silently attributing ambiguous speech. Evaluator `targetAlias` must never be used to steer generation.

## Complete final source arrives after visible opportunity

Candidate final source contains all five requested slides, including Practice's fourth item and `30 minutes` labeled Practice time. Baseline's Practice and Timebox remain content-empty, although both carry the shared frame. Both final decks contain the correct opening/subtitle, Prepare and Reflect lists, enlarged opening title, dark navy/light/amber palette, Workshop/Workshop review frame labels and page numbers.

However, candidate completion is late relative to original slide visits:

| Candidate slide | Recorded opportunity / last settled frame | Later first content commit |
|---|---|---:|
| Prepare | Practice is created at 33,684.046ms; last Prepare frame `000012` at 34,831.354ms is blank | 37,964.9ms edit result |
| Practice | Timebox is created at 43,548.261ms; last Practice frame `000020` at 45,628.753ms has frame labels only | 54,631.749ms canonical commit |
| Timebox | Reflect is created at 73,567.732ms; last Timebox frame `000026` at 76,064.453ms has frame labels only | 98,041.413ms canonical commit |
| Reflect | Last Reflect frame `000028` at 77,987.154ms has frame labels only before the audience returns to the opening | 92,987.968ms canonical commit |

Baseline Prepare instead commits at 33,974.9ms before Practice is created at 36,252.274ms, and its list is observed. That explains the baseline's extra visible pass despite its worse final completeness. The candidate's later source improvements cannot be counted as content the audience already saw.

The dark theme first enters canonical source at 68,617.168ms baseline and 84,551.517ms candidate. Candidate final colors are background `#111d32`, foreground `#f5f2e9`, accent `#d99a45`; baseline uses `#101b2c`, `#f6f4ec`, `#e7ad50`. Both end with the right frame labels. During the earlier content-empty visits, settled viewer projections still show Rehearsal rather than the eventual Workshop review label. Final contact sheets can show the correct finished palette, but cannot establish timely re-theming or consistent audience-visible transitions during the talk.

## General follow-up, not fixture shortcuts

The case supports investigating queue/context work, snapshot-scope diagnostics, continuing offscreen edit attribution, and readiness evidence selection. Correct identity-based delegation has not solved publication timeliness. Any proposed queue/context change must be tested against the other breadth cases, preserve original-input attribution and exact edit permissions, and compare both visible opportunities and final content.

Keep incomplete final-source and delayed audience-visible outcomes separate. No model trial or browser replay was repeated for this report; image/design review, unsupported actor-replay paths and semantic/manual checks retain their explicit limits.
