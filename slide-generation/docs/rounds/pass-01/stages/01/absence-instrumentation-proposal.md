# Proposed next instrumentation version: distinguish removal from preexisting absence

Status: proposal only. The current round evaluator and all raw observations remain unchanged. Root review confirmed the absence-only pass in blank baseline/candidate decks violates the acceptance requirement against no-op success. See [baseline case](cases/edit-heavy-baseline-01-no-visible-generation.md) and [candidate case](cases/edit-heavy-candidate-context-01-anchor-conflict.md).

For an assertion requesting **removal**, a post-trigger empty frame alone is insufficient. Require either:

1. A qualifying pre-trigger frame on the independently bound target slide shows the exact old target; or
2. A recorded accepted post-trigger transaction proves removal of that exact native target from that same slide's authored visual content.

Then require post-trigger settled exact-DOM absence with verified text visibility, as today. For option 2, record `previouslyVisible:false/unknown` separately: an authored removal does not prove that the old target ever appeared on screen. A private Prompt/notes update, unrelated visual edit, disappearance caused by selecting another slide, or a blank deck cannot satisfy the guard. When multiple matching targets or semantic ownership prevent exact attribution, retain manual review rather than guess. Numeric token matching must retain current boundaries.

This applies to removal effects, not every invariant asserting that forbidden/invented content must never appear. Invariants need their own timeline coverage interpretation. Existing “absent” fixture records may not encode this distinction; add an explicit evaluator-side expectation classification/version instead of interpreting fixture aliases in the generator or changing asserted text to obtain a pass.

Tests for the next version should include blank-before/blank-after (miss), observed old target then actual removal (pass), accepted offscreen authored removal followed by correct target selection (pass with no prior-visible proof), unrelated commit (miss), notes-only mutation (miss), wrong-slide removal (miss), exit ghost until settlement (latency waits), duplicate ambiguous target (manual), and invariant absence (separate policy). Test fixture assertions and recorded-response replay must retain all original raw evidence.

Introduce a new evaluator hash/version and rescore both preserved baseline and candidate with that same version, keeping the original metrics beside the new outputs. Do not compare an old evaluator's 1/30 against a new evaluator's 0/30 as a product regression or improvement. No evaluator code changed in this proposal.
