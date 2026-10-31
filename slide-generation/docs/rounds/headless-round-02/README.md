# Iteration 2 — frozen A/B exposes a renderer failure

Baseline `5f970fb` and candidate `16a1671` ran the unchanged `edit-heavy` talk serially at speed 1, one fresh session each.
Both source exports are immutable and verified. Current measurement instrumentation was identical: runner
`0589d204…`, evaluator `4e499ad5…`, observer `c74bda23…`; exact hashes are in each manifest. The candidate contains the
documented context, insertion-boundary, delegation, targeting and publication fixes. This is a multifactor diagnostic
comparison, not a single-factor latency experiment or the full required repeated five-talk set.

Raw evidence: `.artifacts/runs/headless-round-02/` (see `batch.json` and per-version `run-location.json`).
Verified comparison: `.artifacts/comparisons/headless-round-02/`.

| Evidence | Frozen baseline | Frozen candidate |
|---|---:|---:|
| API calls | 77 | 74 |
| Observed input / output tokens | 724,010 / 547 | 691,788 / 1,464 |
| Model edit attempts | 0 | 5 |
| Accepted model edits | 0 | 0 |
| Exact canonical inputs | 22/22, with wrong-target attribution | 21/22; one original remains in durable pending input |
| Automated successes | 0/30 | 0/30 |
| Final slides | 3 blank | 3 blank |
| Structural readiness | true | true |
| Termination | settled | host-error |

There is no finite successful latency sample and no speed improvement claim. Fifteen checks failed and fifteen require
manual review in each run. Both final decks are byte-identical blank screenshots. Finalization/recording completeness,
durable raw receipts, canonical source integration and successful requested effects remain distinct facts.

## First divergence and fix

Candidate edit 1 used `color="--color-accent"` and was correctly refused; the model corrected it to `color="accent"`.
The next four attempts reached browser validation but received only a generic unavailable-stage error. Reconstructing
the first schema-valid proposal from recorded reads and literal edits reproduced the exact browser finding:
**native text was missing node identity or a typography role**. Four renderer-generated numbered markers lacked roles.
The transform-scaling suspicion was disproved; this was neither a permission failure nor an intentional content refusal.

`64f1e0d` assigns each marker its resolved list typography role while retaining the owning Bullets identity. Numbered,
disc and dash markers still receive typography and contrast measurements. The exact recorded draft now checks complete
with zero findings; regression tests include nested surfaces, scale normalization and low-contrast markers. No checker
was skipped. `31dc020` preserves actual baseline/candidate findings in incomplete-validation errors.

The image below is an **offline render of the recorded model draft after the marker fix**, not a frame published during
either live trial. Original failures remain preserved in `.artifacts/review/round02-validation-refusal/`.

![Recorded draft rendered after fixing marker measurement](screenshots/recorded-draft-after-marker-fix.jpg)

Other unresolved cases: Fast quoted eight concatenated utterances into a tool that required one original input, so no
actual Slow delegation occurred. A later named reference could not resolve the never-created title; its exact original
input remains in the outer inbox. See [individual case and evidence](cases/edit-heavy-pair-01-bullet-validation.md).

## Verification and decision

The two traces replayed successfully against their matching frozen transaction backends: baseline 40 steps, candidate
41 steps. Reports preserve the candidate's incomplete original recording/routing status. An artifact-only adapter
validated current manifest metadata against the older frozen protocol rather than rewriting the frozen code. This is
transaction replay, not actor replay and not evidence that the original live failures were repaired.

The marker fix passed TypeScript and the complete 305-test suite. Its exact recorded source passed real Chromium with
nine measured text runs, including four markers. A further live `edit-heavy` trial uses frozen source `734d84a` under
`.artifacts/runs/headless-round-03/` to test actual model behavior after the fix. The same frozen baseline remains available.

Decision: revise, retain the reproduced renderer fix, and verify live generation before spending the full repetition
budget. No settled product rule changes. Full five-talk repetitions, complete audience/build evidence, broad semantic/
design review and subsequent separate refactoring passes remain unfinished.
