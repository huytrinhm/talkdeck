# Pass 2: numbers-business breadth case

One serial real-model baseline/candidate pair completed against frozen `734d84a` and `7aee9be`. This case was diagnosed from existing artifacts while the other breadth trials continued. No browser reproduction, replay, API call or test was run for this write-up. In particular, the glyph-coverage cause below remains a hypothesis pending a controlled reproduction.

Raw evidence keeps its original directory names:

- Baseline: `.artifacts/runs/headless-round-05-breadth/baseline/numbers-business/1/execution/slide-generation/.artifacts/run/`
- Candidate: `.artifacts/runs/headless-round-05-breadth/candidate/numbers-business/1/execution/slide-generation/.artifacts/run/`

Use each root's `provider-cassette.json`, `scheduler.jsonl`, `operations.json`, `commits.json`, `metrics.json`, `audit.json`, `viewer/*.json` and `final/deck.jsx`. No artifact or original score was rewritten.

## Recorded outcome

| Fact | Baseline | Candidate |
|---|---:|---:|
| Inputs retained / delivered | 19/19 | 19/19 |
| Calls | 82 | 79 |
| Input tokens | 929,597 | 1,020,211 |
| Output tokens | 2,857 | 3,061 |
| Fast / Slow inference calls | 31 / 7 | 24 / 14 |
| Speech / Slow-decision calls | 39 / 5 | 36 / 5 |
| Model edit attempts / accepted | 13 / 5 | 13 / 11 |
| Automated successful visible observations / expected | 6/26 | 8/26 |
| Live slide count | 5 | 5 |
| Settled / complete recording / final mandatory readiness | true / true / true | true / true / true |

Cost remains unknown in both recorded metrics. This one pair does not establish a statistically reliable speed or quality improvement. Several automatic failures are comparison limitations; others are real missing or late content. The final readiness pass confirms required validation, not faithfulness or that every requested state reached the audience.

## First request/tool divergences

Both actors initially request source. Baseline then spends another inference on `read_speaker_notes`; candidate proceeds to an edit and commits at 11,950.475ms. Baseline's first edit at 12,860.574ms refuses a stale insertion anchor, and its first accepted edit arrives only at 37,694.053ms on the customer slide. Baseline never successfully composes the overview: its final overview slide remains blank.

Baseline has six `stale_anchor` refusals at tool result times 12,860.574, 16,189.935, 29,158.742, 33,643.637, 44,933.979 and 80,368.887ms. Each recorded transaction inserts before a single empty line in its slide snapshot. Empty-line insertion also checks the original neighboring boundary, which can change as speaker notes grow. The refusal codes and exact anchors are established from `operations.json`; no browser experiment was needed to identify them. This is not permission to weaken exact insertion boundaries.

Candidate has only two edit refusals, at 19,537.259ms and 35,494.880ms, both `unknown_snapshot` with model-facing text `Read this node before editing`. The model supplied snapshot IDs issued for deck `n1` but changed `nodeId` to slide `n10` or `n23`. Both retain deck-relative closing-slide line numbers. These are scope/handle misuse, not unavailable browser checks. A diagnostic improvement should identify the issued scope rather than merely repeat a generic reread request; the source/handle binding must remain strict.

The candidate subsequently makes nine Fast and two Slow accepted edits. It also calls `screenshot` three times and `check` once; baseline calls `check` once and `send_message` once. More accepted transactions alone do not prove greater audience coverage.

## Baseline glyph-coverage refusals: recorded failure, unconfirmed cause

At 20,031.342ms and 25,264.454ms baseline receives incomplete mandatory validation with these exact messages:

- `No native glyph coverage could be measured for t22:text:0`
- `No native glyph coverage could be measured for t26:text:0`

The two proposed overview insertions stack a title, three full-size Stats and two body paragraphs. The first contains revenue `$12.4 million`, growth `42%`, gross margin `61.5%`; the second uses corrected growth `40.2%`. Completely clipped/off-canvas text in a tall layout is a plausible explanation, **not a reproduced diagnosis**. The candidate produces the overview without this error in this run.

A concrete diagnostic gap is visible in code: `src/browser/measure.ts` throws when no glyph-mask pixels are found; `BrowserValidationPipeline.inspect` only calls `evaluateMeasurement` after `measurePage` completes. Thus earlier measured geometry is lost on this path and the model receives `validation-unavailable` without useful overflow findings. The comment claiming off-canvas text still gets geometry findings does not describe this throw path.

Next controlled check: reconstruct both exact refused candidates, inspect their measured bounds and mask coverage, and record the actual cause. If geometry is available, preserve its findings alongside an explicit unavailable contrast sample. Validation must remain incomplete and the transaction refused; do not manufacture a passing contrast result or infer the missing geometry from this report.

## Final source and actual on-screen evidence differ

| Slide | Baseline final source | Candidate final source |
|---|---|---|
| Overview | No visible content | Correct title; `$12.4 million` Revenue; `40.2%` Revenue growth vs Q3 last year; `61.5%` Gross margin; revenue-not-profit qualifier |
| Customers | `1,248` Preliminary active accounts; `108.3%` Net revenue retention; `0.8%` Monthly churn | Same final measures and preliminary qualifier |
| Cash | `-$240,000` Operating cash flow; `$1,234,567.89` Cash balance; cloud cost removed | Same |
| Service | `99.95%` Availability; `245 ms` 95th percentile response time; `84 ms` Median response time; `0` Data-loss incidents | Same |
| Forecast | `$13.0 million to $13.8 million`; `Forecast, not a commitment` | Same range; `Forecast, not a commitment.` |

Candidate's settled overview frame `viewer/frame-000010.png` at 26,111.728ms contains those requested final overview values. Baseline's overview has no corresponding successful content publication; its blank final source is a genuine fidelity failure.

Candidate's final customer source is correct, but the last settled on-screen customer frame, `viewer/frame-000018.png` at 40,806.228ms, still contains only `1,248` Active accounts and `108.3%` Net revenue retention. The churn Stat and preliminary label first enter canonical source at 46,181.190ms, after the customer view has been left. Therefore candidate's churn/qualifier visible misses cannot simply be repaired from final source. Baseline's settled customer frame `viewer/frame-000010.png` at 40,531.396ms does show all three measures including Preliminary active accounts.

Both recorded final sources remove cloud cost as requested. Earlier on-screen frames still contain the corrected `$18,540` value after the removal request while processing continues. Source removal does not establish that the audience saw the removal before selection moved away. The absence/correction audits appropriately retain manual-review limits around settlement and transition evidence.

## Automatic false misses and limits

The existing audit compares whole native strings and exact Stat labels. It does not implement semantic equivalence or case-insensitive label association. Keep the original 6/26 and 8/26 results until a separately verified evaluator revision is applied consistently to both traces.

| Check | Recorded visible content | Why the automatic failure is not evidence the value was missing |
|---|---|---|
| Candidate a003, requested `42%` / Revenue growth | Frame `000006` at 18,478.928ms: `42%`, label `Revenue growth vs Q3 last year` | Exact label equality rejects a more qualified label even though the exact value is visible before the correction deadline. |
| a008, `1,248` / active accounts | Baseline frame `000010`: Preliminary active accounts; candidate frame `000018`: Active accounts | Qualifier and capitalization change the exact label match. The actual count is present; candidate's later preliminary-qualifier timing remains a separate real issue. |
| Baseline a012–a013, preliminary qualifier | Baseline frame `000010` includes label `Preliminary active accounts` | The qualifier is in a Stat label, not a standalone text run. Exact-string lookup misses it. Candidate does not share this on-screen evidence. |
| a022–a023, `84 ms` / median and `0` / data-loss incidents | Baseline frame `000024`, candidate frame `000036`: `Median response time`, `Data-loss incidents` | Label expansion/case differs, while exact requested values are visible. |
| a024, separate `$13.0 million` and `$13.8 million` | Baseline frame `000028`, candidate frame `000040`: one text run `$13.0 million to $13.8 million` | Whole-string matching requires two separate runs and rejects the visible exact range endpoints in a combined sentence. |
| a025, `a forecast, not a commitment` | Same forecast frames show `Forecast, not a commitment` (candidate adds a period) | Article/case/punctuation differ; the noncommitment qualifier is present. Treat this as semantic review, not exact-verbatim success. |

Candidate a004 similarly asks for standalone `compared with Q3 last year`, while the visible Stat label says `Revenue growth vs Q3 last year`. That is a semantic wording difference requiring review, not an exact-string pass. Do not loosen matching so that changed units, omitted negation, changed time periods or dropped qualifiers can pass.

## Follow-up scope

The evidence supports general diagnostics for scoped snapshots, stale versus ambiguous anchors, and preserved geometry when a later measurement stage is unavailable. It also shows that final-source correctness and on-screen correctness need separate reporting. Broader changes should wait for the other completed breadth cases and use their failures too, rather than optimize this fixture alone.

No replay is claimed in this case. Candidate explicit screenshot calls and baseline messaging are outside current bounded actor-replay coverage. Any later transaction or actor replay must retain the literal recordings, dependency/prompt compatibility and explicit coverage limits. Visual design review and the remaining semantic/manual checks stay unfinished.
