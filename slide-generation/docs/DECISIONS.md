# Decision ledger and continuation context

Authority: direct user answers in the design interview and subsequent handoff request, 2026-10-31. This ledger preserves
settled choices so another agent does not repeatedly ask them. SPEC.md is the detailed contract; the latest explicit user
instruction wins if there is a conflict. Implementation details proposed by the previous agent are not automatically
additional product decisions. Append decisions; mark supersession instead of deleting history.

## Settled decisions

| ID | Topic | Agreed behavior |
|---|---|---|
| D01 | Scope | Technical generation, manipulation, and rendering; not a new broad product-design interview |
| D02 | Mutation interface | Everything editable uses hashline JSX editing within a node; no separate style/text/layout/theme mutation tools |
| D03 | Hash anchors | A hash on each line, every affected line checked; accept unchanged targets despite unrelated changes |
| D04 | Relocation | Relocate a shifted range within its node only when the entire match is unique; ambiguous matches refuse |
| D05 | Transactions | Multiple granular node edits per transaction; whole-slide root allowed, but prompt agent to prefer granular edits |
| D06 | Node identity | Every element node has an ID, including definitions/metadata; IDs unique across entire deck |
| D07 | Ownership | Reject edits to system-managed fields and reject duplicate IDs; new IDs assigned by system |
| D08 | Reuse | References only for layouts/components; no empty-node content retrieval and no separate template concept |
| D09 | Expanded identity | Derive structural IDs from instance plus definition identity; slotted content keeps its ID |
| D10 | Shared changes | Latest definition updates all dependent slides; validate atomically, allowing fixes in the same transaction |
| D11 | Layout uniqueness | Reject equivalent slot shapes even if visual designs differ; kinds/counts matter, slot names do not |
| D12 | Free form | Retain an agent-written reason; unrelated edits do not expire it |
| D13 | Slot styling | Automatically normalize content roles/sizes to slot styling, including stored JSX |
| D14 | Character budgets | Remove slot text and Stat value character caps; rely on browser fit; structural item limits remain |
| D15 | Styling | Restricted class allowed inside Layout/Component definitions; instance overrides remain restricted |
| D16 | Validation | Browser checks on every edit; crash/timeout/unavailable validation refuses without changing source |
| D17 | Relative problems | Draft edits may leave unchanged existing errors; reject new/worsened ones |
| D18 | Editorial rules | Prompt guidance only; no runtime semantic heuristics or model judge. This supersedes earlier “hard error” answer |
| D19 | Repair | Remove automatic repair tool; report suggested fixes for agent-applied JSX edits |
| D20 | Fallback | Agent chooses next layout/edit after refusal; ignore proposed decision-API layout fallback |
| D21 | Source evidence | Cleaned speaker notes beside every slide, raw original transcript retained unaltered; expose read_speaker_notes |
| D22 | Notes cleanup | Only fillers, false starts, redundant repetition; preserve substantive original wording, facts and qualifications |
| D23 | Deletion | Archive deleted slide notes/transcript at deck level; removing visible content does not erase user source |
| D24 | Canvas | Fixed 1920x1080, scale to viewer without responsive rearrangement |
| D25 | Screenshots | Explicitly requested, same 1920x1080 resolution; no automatic screenshot feedback after each edit |
| D26 | Font floors | Apply to effective rendered font size after transforms |
| D27 | Palette failures | Unreadable color overrides refuse the transaction; no automatic dropping of overrides |
| D28 | Assets | Finished visuals including SVG, exact versions, automatically allocated boxes, contain only; transforms for ad-hoc changes |
| D29 | Asset checks | Internal visual readability through screenshot review only |
| D30 | Fonts | Shared custom-font assets for both renderers; default bundled font |
| D31 | Asset scope | Keep asset/provider integration provisional and open for future changes |
| D32 | Animation | Keep movement/resizing/color/add/remove/reparent/Stat-count/slide-crossfade behaviors; consider spring retargeting |
| D33 | Overshoot | Movement only; bound other animated values |
| D34 | Build groups | Explicit agent-authored build={n}, any rendered node, equal groups together, reserve final space |
| D35 | Presentation | Resolve all required slots before entering; complete deck must have no Pending or blocking errors, including preexisting |
| D36 | Geometry checks | Validate final layout only, not temporary intersections during animation |
| D37 | Reduced motion | Deferred |
| D38 | Depth | Limit authored and expanded visual trees, plus component nesting |
| D39 | Bootstrap | System starts with a minimal valid deck; agent generates through the normal edit interface |
| D40 | Persistence | One canonical JSX string in a JSON deck file; typed object props where appropriate |
| D41 | Grammar | JSX is data; no executable expressions/functions/spreads/fragments. Static typed object/array data is allowed by schemas |
| D42 | Stack | acorn/acorn-jsx, Hono JSX, Zod, Tailwind v4, Playwright Chromium; backend is Hono |
| D43 | Repository | Work directly on master; scope all changes to slide-generation/; fetch/rebase before every push, additional commits only |
| D44 | Commit organization | Split work into multiple focused commits |
| D45 | Improvement method | Seven-step cycle: measure, diagnose, decide together, plan/build, verify, re-measure, cleanup |
| D46 | Measurement | Real system/models, repeated runs of five stress talks, record the full visible experience |
| D47 | Timing | Deliver each utterance at speaking pace when finished, whether or not the system has caught up |
| D48 | Priority order | Faithfulness > responsiveness > consistency > visual correctness > design quality > stability |
| D49 | Fidelity principle | User words must not be lost, invented, paraphrased, or cut short; soften a conflicting fix, not the principle |
| D50 | Verification | Automated tests after each change, including replays of prior model responses without new model calls |
| D51 | Comparison | Same scripts against a frozen previous version, side by side; report improvement and remaining failures |
| D52 | Cleanup | Once stable, several refactoring passes, each checked independently |
| D53 | Icon representation | Dedicated Lucide Icon primitive; user answer: "icons are dedicated" |
| D54 | Icon discovery | Read-only searchable access to the full catalog; user answer: "agent have a searchable access to the full catalog" |
| D55 | Icon styling | Inherit text color plus optional theme-color override; no stroke customization; user answer: "inherit text-color plus theme-color overrides, no stroke" |

D49 strengthens the operational fidelity criteria: use exact substantive excerpts and conservative formatting on slides,
not model-authored paraphrases of user claims. Explicit user corrections, deletions, renamed headings, and note cleanup
allowed by D22 are authorized changes, not loss. Notes/transcript preservation does not excuse failing to show content
that the user asked to display. Source fidelity includes numbers, units, signs, caveats, and quotes. Evaluation may audit
these facts exactly; D18 still prohibits turning generic semantic heuristics into runtime blockers without a new decision.

The user cited approximate prior latency improvements (5s to <3s typical; 16s to <6s worst) as the desired optimization
story. There is no evidence that this subsystem achieves them. Treat them as targets, not claims, and report live samples.

## Open decisions: do not assume an answer

| ID | Trigger / question | Current boundary |
|---|---|---|
| O01 (resolved by D56) | Approved Stat counting vs “never invented numbers” | User explicitly chose bounded counting on 2026-10-31; intermediate digits are animation rather than factual claims. See D56 and the preserved evidence/question below. |
| O02 (headless ownership resolved by D58) | Exact host API hooks and ownership for JSX publication, multi-slide attribution, frontend bridge | User authorized consolidating both packages and connecting the actual scheduler. Backend injection and headless publication are implemented. Product frontend integration remains outside this headless task. |
| O03 | Asset/font provider API and selected licensed bundled font | Provisional by explicit request. Use an injected versioned resolver; do not lock a provider/storage/cropping contract prematurely. Routine selection can be documented unless it adds a real product constraint. |
| O04 | Follow-up speech after a named offscreen edit | Asked from the Pass 2 Practice/Timebox routing failure. No answer yet; existing routing is not changed by the question. |

These are not reasons to pause all work. Continue independent milestones. Ask product questions only when the relevant
implementation/evidence makes the choice concrete. Do not ask the user to approve routine parser tests or isolated fixes.

## New decision entry template

```text
ID / date / round / evidence-case links:
Question (exact wording):
Options and concrete tradeoffs:
Recommendation and affected priority:
User answer (verbatim):
Resulting requirement:
Supersedes / depends on:
Spec/prompt/tests changed:
Status: open | accepted | superseded
```

Keep unanswered choices open. If a later user response changes a decision, preserve the older row as superseded and link
the replacement. A prior answer is persistent authorization; do not reopen it merely because another agent takes over.

## Historical O01 question — subsequently resolved by D56

The real Chromium viewer demonstration in [O01-stat-counting](rounds/implementation/cases/O01-stat-counting.md)
showed `$12.5 million` and `$12.6 million` between source `$12.4 million` and corrected target `$12.7 million`.
This is controlled viewer evidence, not a live-model evaluation. The exact question/options are preserved in that case.
Asked whether to show exact target digits immediately with nonnumeric motion (recommended under D49), or retain bounded
counting and explicitly treat intermediate digits as animation. User answer: pending. O01 remains open; D32 unchanged.

## D56 — bounded Stat counting is animation (2026-10-31)

Evidence: [O01 viewer case](rounds/implementation/cases/O01-stat-counting.md), including real Chromium intermediate
screenshots/video and sampled digits. Controlled viewer demonstration; not a live-model/talk result.

Question (exact): “The browser demo confirms open decision O01: animating a correction from ‘$12.4 million’ to
‘$12.7 million’ briefly displays ‘$12.5 million’ and ‘$12.6 million.’ How should Stat updates behave?”

Options: show exact target digits immediately with nonnumeric motion (recommended under the previous unresolved
fidelity interpretation); or retain bounded counting and treat intermediate digits as animation rather than claims.

User answer (verbatim): **“Keep bounded counting; treat intermediate digits as animation rather than factual claims.”**

Result: retain D32's bounded Stat counting. The transient interpolation is explicitly an animation exception to the
numeric-claim audit, not permission for the model to invent numbers. Source endpoints must remain exact; interpolation
must stay bounded and settle on the exact requested target. Preserve intermediate frames in recordings. First-correct
visible latency still requires the requested exact value, not a merely intermediate number.

Resolves O01; clarifies D49 without relaxing substantive source fidelity. SPEC.md and agent guidance updated. Accepted.

## D57 — Fast mode for API calls (2026-10-31)

User instruction (verbatim): **“use fast mode for all api calls”**. Accepted without reopening model selection.

All live model inference requests use `service_tier: "fast"`, as documented in the
[official Fast mode guide](https://developers.openai.com/api/docs/guides/fast-mode). Record requested service tier in
new evaluation manifests and retain the provider's actual tier in raw response evidence. Do not silently retry using
standard processing. Keep historical requests/results immutable for exact replay; service-tier changes are a changed
comparison condition, not a measured code-only speed improvement. Existing directory and shell-sourcing rules remain.

Verification: a shell-sourced, bounded one-request probe using the updated client and `gpt-6-luna` returned HTTP 200,
`service_tier: "fast"`, completed output `OK`, and 23 total tokens. Exact request/response/result evidence is under
`.artifacts/environment/fast-mode-2026-10-31T05-47-08-017Z/`. This verifies API configuration, not generation latency.

API capability clarification for the consolidated scheduler: Responses requests explicitly use Fast mode. The existing
Decisions endpoint does not expose `service_tier`; requests retain endpoint-default policy and report it separately.
No unsupported parameter, silent model substitution, or claim of universal served Fast tier is permitted. See
[provider evidence and policy](HEADLESS_PROVIDERS.md).

## D58 — consolidate and connect the headless scheduler (2026-10-31)

User instruction (verbatim): **“connect into a headless harness (combine two directories into a single directory), and
start the improvement loop, document each iteration, including statistics, hypothesis, improvements, and screenshots of
generated slides, fan out to many subagents if possible”**.

The combined package is `slide-generation/`, including the original scheduler under `src/orchestration/`. This explicitly
supersedes the earlier separate-directory ownership restriction for that consolidation. Use the actual scheduler with
an injected canonical JSX backend and the packaged headless viewer. Keep a single canonical editable deck, preserve
legacy artifacts as historical, and retain strict recording/budget/replay requirements. No product frontend is required
for the headless loop; its future bridge is not represented as implemented. Accepted.


## D58 — end-of-practice feedback and concrete proposals

User direction: record the rehearsal and review it at the end; generate proposals
at that time as well, with conservativeness controlled by the system prompt.
Follow-up: **“less tool, more context”**. Implemented in `src/practice/`: a frozen,
complete review context plus slide images goes into one tool-free structured
request. The response contains feedback and native transactions together. Backend
code validates each independent proposal privately and prepares exact previews.
Acceptance does not call an LLM. Practice narration does not drive generation;
explicit push-to-edit remains available. No frontend is included.

See [PRACTICE-REVIEW.md](PRACTICE-REVIEW.md) for source/notes evidence, proposal
versioning, stale acceptance, audio timing limitations and implementation evidence.

## D59 — canonical slide-design skill

User direction: **“adapt the skills to integrate as skills for design”** after
reviewing the local `presentation-skill-v2` work. The tracked adaptation lives in
`skills/slide-design/`; the original studies remain untouched. Common guidance,
styles and communication patterns are preloaded as role-specific context, not a
new retrieval tool or agent. Native JSX authoring/publication rules override recipe
preferences. Fast preserves incremental composition; Slow handles meaningful
refinement; end review returns existing native proposals. Pattern IDs are neither
registered Layout names nor evidence IDs. Record skill bytes/digests so historical
replay and finalized-review retry do not silently receive revised guidance.

See [DESIGN-SKILLS.md](DESIGN-SKILLS.md). No improved generation-quality or latency
claim follows from the standalone HTML study or prompt integration alone.

## O04 — follow-up focus after an offscreen named edit (pending)

Evidence: [Pass 2 style-switch case](rounds/pass-02/cases/style-switch.md). Both frozen versions route the explicit
Practice edit correctly while Timebox stays displayed, then route “Keep the new point in the new dark theme, even if an
older styling operation finishes late” to Timebox. The expected follow-up concerns the prior Practice point.

Question asked: “The style test exposed a routing choice: while Timebox is displayed, ‘On Practice, add a point’ correctly
edits Practice, but ‘Keep the new point in the dark theme’ goes back to Timebox. After an edit names another slide, where
should follow-up speech go until the user explicitly changes slides?”

Options: keep editing the named slide while leaving the displayed slide unchanged (recommended); return follow-up speech
to the displayed slide; or infer each follow-up target and ask when ambiguous. This is an editing-focus policy choice,
not permission to weaken source retention or use evaluator aliases as model context.

User answer: pending. Do not treat elapsed time as approval. Continue unrelated measurement and document current failures;
implement dependent routing behavior only after the answer. The current frozen runs and original recordings stay unchanged.
