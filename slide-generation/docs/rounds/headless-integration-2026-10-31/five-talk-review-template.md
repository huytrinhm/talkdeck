# Five-talk case review template

Prepared from the committed fixture definitions and current integrated-host/evaluator contracts. This is a review plan,
not a run result. Every outcome field below starts **NOT REVIEWED**. Populate it only from the actual run paths supplied
for the batch. Do not create model results, measurements or pass counts from these authored expectations.

## Corpus and expected review scope

These counts and times describe input schedules, not measured performance. Observation time is last utterance end plus
its final silence plus the configured post-talk observation period; the additional drain is bounded at 120 seconds.

| Talk | Inputs | Event assertions | Expected final slides | Scheduled observation end | Principal checks |
|---|---:|---:|---:|---:|---|
| long-technical | 58 | 90 | 34 | 363.400 s | Exact sustained content; eight sections with four recurring layout families; whole-deck consistency and source retention |
| numbers-business | 19 | 26 | 5 | 97.673 s | Signs, precision, ranges, labels, qualifiers, corrections, removal, obsolete-value exposure and no derived claims |
| narrative-keynote | 10 | 12 | 7 | 204.265 s | Verbatim quotations/bylines, sparse hierarchy, long pauses, no invented metrics and audience reveal order |
| edit-heavy | 22 | 30 | 2, with Parking lot archived | 92.438 s | Ordered edits, rename/reorder, target isolation, removal/restoration, selected-slide deletion and source archival |
| style-switch | 15 | 22 | 5 | 114.579 s | Whole-deck theme/frame changes, offscreen edits, stale work, analogous list design and final readiness |

For a new batch, verify fixture hashes and recompute this inventory if the authored inputs changed. Never change the
fixture to fit generated output. Target aliases remain private evaluator grouping data, never navigation/model inputs.

## Run record — copy once per talk/repetition/version

- Fixture / repetition / baseline or candidate: **NOT REVIEWED**
- Immutable run directory and manifest: **NOT REVIEWED**
- Generator SHA and clean/frozen source proof: **NOT REVIEWED**
- Common evaluator, observer, driver and runner hashes: **NOT REVIEWED**
- Fixture/prompt/tool/model/font/asset/check-policy compatibility: **NOT REVIEWED**
- Model role configuration and requested versus actually returned tiers: **NOT REVIEWED**
- Scheduled/actual delivery drift; retained/routed/applied input counts; pending IDs: **NOT REVIEWED**
- Termination and drain; budget limits/exhaustion; missing usage/errors: **NOT REVIEWED**
- Source/check/render recording completeness; finalization failures: **NOT REVIEWED**
- Viewer gallery/video and final per-slide JPEG paths: **NOT REVIEWED**
- Creation identity evidence and wrong-target route findings: **NOT REVIEWED**

Keep historical original artifacts immutable. Use the same current observer/evaluator for both generator versions and
record that distinction in manifests; do not describe current measurement code as frozen generator code. A historical
frame without required visibility metadata remains manual review, rather than receiving invented verification fields.

## Review sequence and evidence boundaries

1. **Faithfulness:** compare each original utterance with exact Prompt evidence, cleaned notes, accepted source and
   actual on-screen text. Check signs/units/qualifiers, exact quotations, unwanted derived metrics, unintended edits,
   corrections and visible obsolete claims. Inspect some automated passes as negative-control spot checks.
2. **Responsiveness:** only after validating the relevant observation, examine input-to-first-correct time, queue age,
   read/edit/refusal/check/publication/paint chronology, superseded inputs and unobserved work. Preserve denominators,
   misses and censoring. A fast wrong target or fast final export is not a visible success.
3. **Consistency:** compare genuinely analogous slides, shared definitions, frame labels and theme state throughout the
   deck, including earlier/offscreen slides. Record late stale-theme reappearance separately from final appearance.
4. **Visual correctness:** review actual 1920×1080 viewer and final frames for clipping, overlap, font fallback, contrast,
   overflow and inaccessible content. Match the screenshot to the checked source/artifact revision and resource bytes.
5. **Design quality:** assess hierarchy, restraint, useful whitespace, repeated structures and fit to the exact material.
   Do not improve design by dropping substantive source content or replacing the user's language.
6. **Stability:** inspect crashes, refusal loops, unmatched snapshots, repeated cosmetic work, publication failures,
   recording gaps and unfinished work. Preserve failed attempts as evidence.

### Automated assertions versus human decisions

| Evidence/result | What it establishes | What still needs review |
|---|---|---|
| Exact native visible content / Stat label/value / Quote/byline | A sampled, coherent frame contained the required native projection under the current matcher | Correct semantic target, unsampled intervals, hidden visual defects and unintended additions |
| `visible_exact` whole-node result | The current round's original exact native-node matcher passed or failed | An intact requested phrase embedded in a longer native label can produce an instrumentation-granularity miss; inspect it manually |
| Verified settled correction/absence | Requested final native value or absence after exact DOM settlement and conservative visibility checks | Earlier first-correct time, exit exposure and animation; conservative timing may overestimate latency |
| Exact-once raw Prompt retention | Original utterance identity/text survives in live or archived canonical source | Substantive cleaned-note completeness, suitable notes organization and unintended extra visible claims |
| Final complete-deck readiness | Mandatory checks passed the exact final canonical revision without blocking errors/Pending | Earlier visibility, audience reveal behavior, semantic correctness or design quality |
| Final JPEGs of every slide | Offscreen final render appearance and readable final content | Whether that slide ever reached the current viewer, and when |
| Editor timeline | What the packaged editor actually displayed | Audience build/reveal state when it differs |
| Audience/build evidence | Only what an actual readiness-gated audience surface and explicit reveals show | Currently unavailable from the ordinary integrated host; do not infer it from editor frames or final JPEGs |
| Unsupported semantic/design assertion | An explicit manual-review miss remains in reported coverage | A linked human case assessment; no automatic success should be manufactured |

The pilot qualifier case is the reference instrumentation caveat: a requested exact phrase embedded in a longer Stat
label is not evidence that the model dropped the phrase. Preserve the original automatic result for this round and add
a separately linked manual explanation. Do not rewrite `visible_exact`, artifacts or benchmark denominators to improve
that score. No additional product decision is needed to document this distinction.

`qualificationComplete` remains false while required human reviews, audience/build acceptance, complete repetitions or
compatible frozen comparisons are missing. Do not claim a completed improvement loop from successful transport alone.

## Talk-specific case checklist

### Long technical — NOT REVIEWED

- Walk all 34 final slide JPEGs, then spot-check their first visible frames against exact incoming lines.
- Compare all section openers, three-point lists, single metrics and single statements as four distinct families;
  inspect shared definitions and duplicate slot shapes. Similar appearance alone does not prove shared structure.
- Check eight exact metric values with their labels; retain the nearby caveat words without converting them into facts.
- Inspect speech backlog across successive new-slide commands: durable input, creation, target identity, queued Fast/Slow
  work and actual selected-slide publication. Offscreen completed work remains separate from visible coverage.
- Verify final frame consistency and complete source retention; do not use expected slide count to generate content.

### Numbers/business — NOT REVIEWED

- Check original and corrected growth values in their proper intervals, exact active-account count, preliminary
  qualification, negative operating cash flow, cloud-cost correction/removal, availability and forecast range.
- Inspect Stat labels and nearby words, not isolated numeric substrings. Values in notes or another claim do not count.
- Review real video for obsolete digits, exit copies and D56-approved bounded counting. Animation exception does not
  authorize invented model numbers; first-correct requires the requested endpoint.
- Confirm removed cloud cost remains in source evidence while absent from active visible content.
- Classify intact embedded qualifier phrases separately from actual omissions; retain automated matcher outcomes.

### Narrative keynote — NOT REVIEWED

- Compare both quote bodies and bylines verbatim; keep them in quote roles instead of promoting them to titles.
- Review sparse composition and empty-box avoidance without inventing decorative facts or metrics.
- Inspect long silent intervals for unsolicited rewriting versus completion of previously requested work.
- Audience reveal order requires actual presentation/build observations. Record that gate unavailable if only editor
  frames exist; do not navigate/reveal from evaluator answers during generation.

### Edit heavy — NOT REVIEWED

- Track stable identities through Draft removal/restoration, Review→Verify, list reorders and title rename.
- Check selective highlights, title size and caption position while preserving all unrelated words and geometry intent.
- Distinguish selected slide, intended named target, actual retained source target and actual edit target.
- Review Owners placement relative to Release checklist and per-owner corrections without changing unrelated names.
- At Parking lot deletion, inspect canonical archive evidence, backend selection, viewer selection and any refused
  publication. A later successful Return command must not hide a prior publication failure.
- Confirm final two-slide order, archive retention and no-churn interval. Build grouping remains an audience review gap
  unless actual controlled audience captures are present.

### Style switch — NOT REVIEWED

- Inspect the theme switch on earlier and later slides, including all frame labels and page behavior.
- Track the named Practice update while another slide may be selected; verify expected identity independently of the
  route being tested. Report correct offscreen work separately from current-slide visible success.
- Check the Timebox correction and frame-right-label change without stale operations restoring prior colors/text.
- Compare Prepare and Reflect list structures/styles; inspect duplicate layout definitions, not just screenshots.
- Confirm final readiness independently of the timed readiness assertion. A check measured after observation ended is
  final evidence, not a timestamped success during the run.

## Individual case — copy for every meaningful failure or ambiguous pass

```text
Case ID / talk / repetition / generator / evaluator versions:
Original utterance and actual/scheduled end times:
Requested effect and independently established target identity:
Selected / intended working / retained source / edited / displayed slide IDs:
Automatic outcome and evidence (unchanged):
Manual observation and classification (separate):
First incorrect/missing visible state, revision, publication, frame/video time:
What was actually displayed, including qualification/units/byline/transients:
Raw Prompt retained? Cleaned notes complete? Archived evidence correct?:
Trace: receipt -> routing -> Decision -> actor inference -> read -> tool ->
       candidate/refusal -> mandatory checks -> commit -> publication -> paint:
First divergence and root-cause hypothesis:
Evidence supporting it / evidence that would disprove it:
Category: input | target routing | model intent | context | hash conflict |
          schema | layout | notes/archive | queue | browser | animation |
          publication | harness/evaluator | incomplete evidence
Affected priority / severity / recurrence:
Recorded-response or transaction replay reproduction:
Proposed smallest change; predicted observable effect; tradeoff:
Relevant regression / negative control / unchanged-fixture replay:
Baseline/candidate evidence and unresolved limitations:
```

## Per-run conclusion — leave blank until actual review

- Faithfulness assessment and unresolved cases: **NOT REVIEWED**
- Validated visible coverage/misses/censoring and p50/p90/p95/observed maximum: **NOT REVIEWED**
- Readiness observations versus final offscreen readiness: **NOT REVIEWED**
- Consistency, visual correctness and design assessment: **NOT REVIEWED**
- Audience/build acceptance: **NOT REVIEWED / NOT ESTABLISHED BY EDITOR-ONLY EVIDENCE**
- Model calls, observed/unknown tokens, cost availability and actual served tiers: **NOT REVIEWED**
- Baseline compatibility, repetition uncertainty and replay result: **NOT REVIEWED**
- Required next case/fix/refactor pass: **NOT REVIEWED**
- Full qualification: **NOT ESTABLISHED**
