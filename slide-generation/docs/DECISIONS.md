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
| O02 | Exact host API hooks and ownership for JSX publication, multi-slide attribution, frontend bridge | Integration contract with neighboring owners remains unconfirmed. Do not assume current RuntimeOptions can replace Publisher/tools. Work within scope and document missing hooks. |
| O03 | Asset/font provider API and selected licensed bundled font | Provisional by explicit request. Use an injected versioned resolver; do not lock a provider/storage/cropping contract prematurely. Routine selection can be documented unless it adds a real product constraint. |

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

## O01 evidence and pending question — 2026-10-31

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
