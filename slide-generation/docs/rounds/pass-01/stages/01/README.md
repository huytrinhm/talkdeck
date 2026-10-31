# Pass 1, stage 1 — edit-heavy failure, diagnosis and revision

Historical stage evidence within the [consolidated Pass 1](../../README.md). Original artifact names and trial outcomes are retained.


Date: 2026-10-31. Priorities: faithfulness first, then visible responsiveness. This exploratory iteration used the actual
62.438-second, 22-utterance `edit-heavy` talk at speed 1. Each run retained failures, full requests, source states, PNGs
and video. It is not the required five-talk × three-repetition comparison.

Frozen baseline: `5f970fbd0ad88451c72fe3d74a6b615ef4e8fffc` at `.artifacts/baselines/headless-pre-fix/`.
Baseline run: `.artifacts/runs/headless-round-01/baseline/edit-heavy/1/execution/slide-generation/.artifacts/run/`.
Exploratory candidate: `8df2d2a`, `.artifacts/runs/headless-round-01/candidate-context/edit-heavy/1/`.
Its manifest correctly records a dirty runner during failure-report instrumentation; the generator changes were committed.
This is not a clean qualification candidate or a formal speed comparison. The old prompt fingerprint omitted runtime
context strings; the actual speech-label change is explicit below and preserved in exact provider requests.

| Evidence | Baseline | Context candidate |
|---|---:|---:|
| Real calls | 76 | 77 |
| Observed input tokens | 614,025 | 798,361 |
| Observed output tokens | 455 | 713 |
| Fast generation responses | 27 | 31 |
| Visual edit attempts | 0 | 1, stale-anchor refusal |
| Accepted visual edits | 0 | 0 |
| Final slides | 3, all blank | 3, all blank |
| Durable raw receipts | 22/22 | 22/22 |
| Canonical Prompt retention | 22/22, includes wrong-target routing | 21/22; remaining original retained in pending inbox |
| Final structural readiness | true | true |
| Termination | settled | host-error: unresolved named target |
| Original automated score | 1/30, a vacuous absence pass | 1/30, the same vacuous absence pass |

**Neither run generated useful visible content.** The original absence check credited removing Draft from a blank
slide; that is an evaluator defect, not success. Those scores remain in the immutable raw reports. Revision `16a1671`
requires prior verified visible content for removal credit. New A/B runs use the same revised evaluator; old results
must not be silently compared with different scoring. No latency improvement is established.

![Baseline final slide is blank](screenshots/baseline-blank.jpg)

![Context candidate final slide is still blank](screenshots/context-candidate-blank.jpg)

## Hypotheses, evidence and changes

1. **Contradictory context:** baseline user messages labelled every utterance “Audience-facing narration, not instructions,”
   despite explicit editing commands and contrary agent instructions. `b9e57a0` makes canonical speech actionable.
   The candidate attempted an edit, but this single multifactor trial does not isolate causation or prove sufficient repair.
2. **Private-evidence anchor churn:** the candidate anchored visual insertion after a SpeakerNotes line. Incoming exact
   source input moved its closing tag before the edit arrived; strict hash matching correctly refused. Four rereads then
   `finish` left the slide blank. `fba8057` gives seed/new slides a stable blank line before the closing Slide tag and guides
   blank composition to that boundary. Regression: three incoming inputs between read/edit preserve exact notes and the
   valid visual insertion on both initial and newly created slides. No hash relaxation or transcript suppression.
3. **Missing broader-edit route:** Fast had slide-only rights and instructions to leave theme/library/cross-slide work
   to Slow, but no request tool; Slow eligibility depended on a Fast publication. `18e41e9` adds canonical-only
   `request_deck_edit`, accepting one complete verbatim retained utterance. The existing scheduler queues it to Slow
   without requiring publication. Negative tests reject invented requests and dropped negations. Fast rights stay scoped.
4. **Independent targeting/publication:** `b355fb4` resolves deleted selection before publication; `4546e81` routes named
   edits to actual live titles without moving audience selection. The candidate's unresolved renamed title was explicitly
   refused, with original input retained in the pending inbox. This still leaves canonical integration unfinished.

Individual evidence: [baseline case](cases/edit-heavy-baseline-01-no-visible-generation.md),
[candidate anchor case](cases/edit-heavy-candidate-context-01-anchor-conflict.md),
[absence audit proposal](absence-instrumentation-proposal.md), [deck request invariant](../../../deck-request-routing.md).

Decision: **revise; do not promote a quality or latency claim.** No new product decision is required for these reproduced
implementation/instrumentation defects. Source preservation, exact hash validation, bounded counting and provisional
asset integration remain unchanged. Repetition defaults are not waived: these bounded diagnostic trials precede the
full measurement set because the baseline still generated blank slides.

## Verification and next comparison

The candidate through `16a1671` passed TypeScript and all 302 tests, including Chromium, then was pushed after fetch/rebase.
The historical live pilot's transaction replay still matched exact source after routing/context fixes. Its recorded-event
actor replay passed before prompt changes; old responses cannot establish the revised model's behavior. The new explicit
delegation trace currently fails actor replay as unsupported rather than falling back to a real model.

Both baseline and candidate are frozen for iteration 2 under `.artifacts/baselines/`. The bounded serial A/B runner uses
verified execution copies, unchanged fixtures/model budgets, a common observer/evaluator and separate source/harness
fingerprints. Iteration 2 output is `.artifacts/runs/headless-round-02/`. Inspect its actual result before extending trials
or claiming these fixes improved generation. Full repetitions, audience/build capture, comprehensive design review and
separate refactoring passes remain unfinished.
