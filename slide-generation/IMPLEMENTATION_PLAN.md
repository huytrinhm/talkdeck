# Slide generation implementation and handoff plan

Status: implementation plan, not a completion report. Prepared 2026-10-31 for the next implementing agent.

## Start here

Read, in order:

1. `AGENTS.md` — branch, directory, commit, and push rules.
2. `SPEC.md` — the agreed target behavior.
3. `docs/DECISIONS.md` — settled product decisions and the latest fidelity/optimization priorities.
4. `TECHNICAL.md` — what the scaffold actually does and does not do.
5. This plan — implementation milestones and their acceptance tests.
6. `docs/IMPROVEMENT_LOOP.md` — the required seven-step measurement and improvement process.
7. `fixtures/talks/README.md` and the five JSON fixtures — timed talks, expectations, and replay rules.
8. `docs/AGENT_PROMPT.md` — editing-agent instructions; version and log the actual prompt used in every live run.

The task is to complete the slide generation/manipulation/rendering subsystem and then improve it using real-model,
real-system evidence. Do not stop after unit tests or a visually plausible screenshot. Do not run paid model trials as
part of merely reading this handoff; when executing the live-evaluation milestones, check connectivity, credentials,
selected model availability, and the run budget, then record actual requests/results. Never claim a replay was a new
live-model run. No credentials belong in documents, manifests, or browser messages.

## Work boundaries and existing state

All new implementation, tests, fixtures, documentation, dependencies, logs, and benchmark artifacts belong to
`talkdeck/slide-generation/`. Work directly on `master`. Make focused additional commits. Before **every push** fetch and
rebase onto `origin/master`, rerun relevant checks, then push; never force-push. Do not modify adjacent packages to make
integration convenient. Coordinate a missing integration hook with its owner and record the blocker. You may continue
independent subsystem implementation while waiting. No branch/worktree is needed for frozen baselines: use immutable
exports into `.artifacts/baselines/` as described in the improvement-loop document.

At handoff the foundation consists of three commits (inspect current Git history; other work may have landed):

- `1c51378`: specification, technical documentation, agent instructions, and local implementation rules.
- `38738a5`: dependencies, parser, seed deck, hashline staging, and foundation tests.
- `733004e`: Hono routes, engine/validator refusal boundaries, and service tests.

Those hashes identify provenance, not the correct baseline for future comparisons. Always record the current actual SHA.
An earlier environment could not resolve GitHub during fetch; do not assume that condition still exists, or that any
commit remains unpushed. Inspect local status and fetch. The former workspace SPEC.md was removed and is superseded by
this directory's SPEC.md.

Existing commands: `npm ci`, `npm run check`, `npm test`, `npm start` from this directory. Node >=22.12.0. Initial
verification passed TypeScript and 47 individual tests in four files; rerun rather than trusting that historical count.
The test command uses `node --import tsx --test` to avoid the tsx CLI's extra IPC listener in restricted environments.
The local Hono development server binds `127.0.0.1:8875` (SLIDE_GENERATION_PORT overrides it).

Current API: GET /health, GET /source/:nodeId, GET /slides/:slideId/speaker-notes, GET /presentation-readiness,
POST /edits. A bootstrap slide has ID n10, but consumers must discover IDs instead of relying on that example.
All mutations intentionally refuse. Even an injected passing validator reaches `not_implemented`: versioned commit,
ID allocation, normalization, archival, durable storage, expansion, rendering, assets/fonts, and browser checks are
unfinished. No successful-render or live-model claims can be made for this package yet.

### Existing integration seams to inspect

| Existing code | Reusable concept | Mismatch / required work |
|---|---|---|
| ../orchestration/interfaces.ts | Exported runtime, model, renderer, log interfaces | They currently describe single-slide HTML, not canonical JSX decks |
| ../orchestration/src/runtime.ts | Immutable inference snapshots, actor queues, Fast/Slow lifecycle | Constructs Publisher internally; RuntimeOptions injects model/decider/renderer but not the JSX transaction engine |
| ../orchestration/src/publisher.ts, merge.ts | Serialized publication and conservative conflict handling | Exact old/new HTML edits and three-way merge must not become a second agent mutation API |
| ../orchestration/src/history.ts, log.ts | Stored model/tool context and observation history | New explicit-screenshot policy; distinguish evaluator recordings from agent feedback |
| ../orchestration/src/transcription.ts | Audio/transcript accumulation and corrections | Need stable utterance/slide attribution and source-preserving ingestion |
| ../orchestration/src/fixture.ts | Real-model runner and paced input | One talk/slide; needs five scripts, absolute deadlines, multi-slide evidence, new source tool contract |
| ../orchestration/src/replay-publications.ts | Re-executes recorded real edits without live inference | Old edit format; cannot directly replay hashline reads/snapshot handles |
| ../orchestration/src/renderer.ts | Chromium lifecycle and observation concepts | Old default is 1280x720; advisory visual checks; not the new mandatory 1920x1080 validation |
| ../frontend/docs/integration.md | Explicit frontend adapter ownership | Contracts remain unconfirmed; current synchronous reference interpreter is not a live job service |

A renderer-only injection does NOT integrate the new edit protocol. Do not wrap JSX in arbitrary old HTML edits, weaken
validation, or fork an unobserved imitation of the actor scheduler and label it the real product. Define the necessary
host port here, provide a contract test/example, and have the owning package wire it. Record source SHAs of all packages
in integrated measurements. Model defaults mentioned in the neighboring README are observations, not requirements of
this plan; record and verify the actual configured models at execution time.

## Implementation discipline

Every milestone below should be split into small commits. For each behavior change: identify the invariant, add a
reproducing/negative-control test, implement the smallest change, run the relevant automated tests, then typecheck and
run the package suite before committing. Add an offline replay for defects discovered from real model responses. Keep
new code disabled behind an explicit incomplete capability until its required validators exist; do not introduce a
production flag that converts unavailable checks into success. Update TECHNICAL.md as features become real.

File names below are proposed organization, not an instruction to create empty files. Prefer small modules with one
responsibility, using the scaffold's exported contracts where practical. Avoid introducing abstraction layers without a
specific consumer. Label any command not yet implemented as planned in documentation.

## P0 — Establish baseline and observable contracts

Dependencies: none. Deliver a reproducible development environment and trace schema before changing behavior.

1. Inspect current master, package lock, tests, source, and integration owners. Record baseline SHA/status in a local
   run manifest. Install dependencies and Chromium when needed; obtain a distributable bundled font and record license.
2. Add typed event/diagnostic contracts under `src/telemetry/` with causal IDs and monotonic timestamps. Define source
   revision, utterance ID, transaction ID, inference/tool-call ID, asset manifest, and publication/render acknowledgment.
3. Define capability reporting: parser/schema/expander/renderer/browser/assets/commit/live-host readiness separately.
   Health is liveness; presentation readiness and mutation readiness are different capabilities.
4. Add a run-directory layout and fixture loader schema before a live runner. Validate the supplied talk JSON files.
5. Write the integration-port proposal and contract examples, making outstanding host hooks visible.

Tests: manifest serialization excludes keys; unknown fixture versions refuse; invalid/unsorted timing refuses; unique
IDs and assertion references; capability defaults cannot imply production readiness. Exit: current tests pass, fixtures
load, and a trace from an in-process read/refused edit can be linked end to end. No live-score baseline yet.

## P1 — Complete source grammar and strict primitive schemas

Dependencies: P0.

1. Introduce a strict Zod schema registry for every metadata and visual primitive in SPEC.md. Include typed structured
   props (scale maps, transforms, free-form reason, versioned assets), allowed build attributes, child rules, and defaults.
2. Preserve safe literal AST decoding; do not evaluate JSX. Define deterministic entity handling, numeric values, and
   text whitespace rules. Notes/transcript contents must not be accidentally trimmed during JSX formatting.
3. Validate wrapper placement/cardinality: one Theme/Library/Archive, notes/transcript per slide, visual children separated
   from metadata, definition names and ID namespaces. Define a metadata migration/version policy for persisted decks.
4. Check authored visual depth <=6, primitive counts/ranges, class allowlist (definition-only), direct-Shape/bleed placement,
   maximum two Shapes, and frame/palette token schemas. Character caps removed for slots/Stats stay removed.
5. Make parse/schema errors structured with source spans and nearest authored ID; bound resource consumption.

Tests: a matrix of valid/invalid primitive props and child forms; literal objects with executable payloads; aliases,
duplicate fields/IDs, nested metadata, unknown tags; six versus seven visual levels; class escape/arbitrary-value attempts;
text/quotes/entities preserve exact words. Exit: schema-valid canonical examples and precise refusal diagnostics, still
no rendering/commit success. Do not conflate syntactic validity with presentation validity.

## P2 — Harden hashline staging and source ownership

Dependencies: P1; keep current API recognizable.

1. Add typed range-resolution results including original/current node spans, every line hash, exact stored bytes, and
   relocation evidence. Keep scope-bound unique exact matching; never normalize whitespace for matching.
2. Validate insertion gaps at node boundaries. In the current scaffold an insertion before/after a selected node's root
   line can escape the node scope; reject that or require targeting its parent. Test inline siblings and multiline attrs.
3. Test/handle every overlap case across parent/child scopes, adjacent replacements, duplicate insertions, empty nodes,
   whole-root changes, CRLF ingestion, Unicode, identical lines, and multiple changes against one snapshot.
4. Protect against ID forgery/retagging, mutation of system fields, and evidence edits. New elements omit IDs. Existing
   identities may move only as actual source nodes, never as empty content references.
5. Define snapshot eviction/restart behavior (reread required), node/source limits, multi-deck ownership, idempotent retry
   behavior, and fresh-context failure results. Idempotency keys are transport bookkeeping, not a second edit surface.

Tests: all current hashline cases plus scope escape, insert-anchor drift, ancestor deletion, cross-slide moves, fresh
unrelated changes, repeat requests, unknown snapshot ownership, and byte-for-byte rollback on any failed batch. Property
or randomized tests should compare staged source with a simple reference implementation for disjoint edits. Exit: every
candidate respects authorized scope and current target hashes, without committing anything yet.

## P3 — Canonical evidence, ID allocation, normalization, and storage candidates

Dependencies: P1–P2. Implement pure candidate transformations before durable publication.

1. Build an index of authored nodes, slide ownership, definitions, and system fields. Persist a monotonic ID high-water
   mark in canonical source. Allocate IDs without reusing deleted IDs; include metadata and definitions.
2. Implement trusted utterance ingestion with stable IDs, exact original text, correction events, target slide attribution,
   and idempotency. Ingestion must not wait behind a long model operation merely to preserve source evidence. Serialize
   its source writes correctly with edit transactions; retain pending input durably before expensive validation.
3. Initialize/update cleaned notes without paraphrasing substantive wording. Preserve immutable raw transcripts, including
   commands/corrections; notes may retain original substantive prose while excluding non-content editing commands.
4. Implement slide deletion archival as a system-owned transformation, preserving note/transcript IDs and source-slide
   association. A user-visible deletion of content must not delete its original evidence. Support archived notes reads.
5. Implement formatting-preserving source surgery for inserted IDs and specified normalizations. Return exactly the
   normalized source/hashes. Never pretty-print the entire deck after a local edit.
6. Define a canonical JSON repository port with atomic replacement/CAS, transaction journal or sufficient recovery evidence,
   and version advancement only on successful commit. Start single-process; document deployment limits.

Tests: crash/failure before publication leaves old source; ID allocation stays monotonic across reload/deletion; new ID
injection preserves text; duplicate input delivery is idempotent; correction history retained; raw evidence cannot be
forged/removed; deleting a slide moves evidence exactly once; no notes lost during source normalization or a stale edit.
Exit: candidate creation/archival/storage tested independently, but production commit remains disabled until P6–P7.

## P4 — Definition expansion and layout contracts

Dependencies: P1/P3.

1. Implement symbol tables, reverse/transitive dependencies, cycle detection, nesting limits, and duplicate slot-shape
   checks that ignore slot names. Keep the agreed duplicate-shape restriction even for visually different layouts.
2. Expand Layout/Component instances, slots, Each, Item, and Index. Distinguish metadata from visual children. A layout's
   Slide root sets the visual ground while the authored slide retains notes/transcript metadata.
3. Normalize slot roles and Stat sizes back into authored source. Enforce accepts/min/max and one-child slots. Produce
   deterministic Pending structures/warnings for missing required content; no character budgets.
4. Generate stable structural IDs from instance paths + definition IDs + repeated-item identity. Slotted content retains
   authored IDs. Maintain reverse mappings for precise error locations and animation identity.
5. Check expanded depth <=6 as well as authored depth, plus component nesting <=6. Carry build attributes and inherited
   parent visibility without confusing definition IDs with instance nodes.
6. Track free-form reasons persistently. References resolve to the latest definition; editing it affects all dependents.

Tests: nested instances, repeated-item reordering, collision avoidance, slot normalization idempotence, pending ranges,
cycle/unknown reference, wrong placement, shared edits breaking one dependent, and batch fixes that restore all slides.
Exit: deterministic expanded trees with stable IDs, dependency invalidation, and source normalization diffs.

## P5 — Theme, Hono JSX, Tailwind, and shared asset/font resolution

Dependencies: P4. This milestone renders but does not certify layouts.

1. Implement theme token resolution, required pairs, derived colors, scale defaults/floors, frame/motif context, and
   deterministic color math. Pin the APCA implementation/version and threshold policy; include reference test vectors.
2. Resolve a licensed bundled default font and exact custom-font versions; provide identical bytes to server and client.
   Implement a provisional in-memory/test resolver and provider port without building asset management.
3. Render every primitive through Hono JSX. Propagate fill/foreground, card/list context, frame/page, build state, and
   origin mappings. Render metadata nowhere. Escape user text/inline bold-italic-code safely.
4. Compile Tailwind v4 in trusted code using explicit allowed utilities and deck tokens. Prevent arbitrary CSS/URLs from
   source props/classes. Cache only with complete source/theme/compiler/font/asset keys.
5. Render content transforms with zoom plus translate; enforce effective font floors after cumulative scale without
   changing the user's words. Implement only the agreed normalizations; unreadable overrides refuse later validation.
6. Supply embed-ready self-contained asset/font bytes. Contain only, automatic boxes; no explicit crop/size API. Require
   sanitized SVG from the resolver boundary and reject missing versions. Keep the provider contract provisional.

Tests: every primitive's DOM/attributes/context; font/asset version pinning; inline markup injection; generated CSS token
coverage; nested surfaces; frame exclusion/page numbering; scale-floor boundaries and cumulative transforms. Compare
Hono output semantics deterministically, then inspect a representative 1920x1080 gallery. Exit: real HTML/CSS plus shared
font bytes, not a fake renderer. Document which renderer guarantees remain pending.

## P6 — Mandatory browser checks and screenshot feedback

Dependencies: P5.

1. Add a bounded Chromium pool with page-authored JS disabled, network aborted, deterministic viewport 1920x1080, fonts
   awaited, and images decoded. Static final layouts have animations disabled. Collect measured results through trusted
   automation even though page-authored scripts are disallowed.
2. Implement overflow, text overlap, Stat wrap, effective text floors, composited APCA contrast, and solid-Shape-under-text
   checks with stable IDs and quantitative severity. Avoid ancestor/descendant double-counting of the same text.
3. Return `complete=false` or a typed failure when a required check fails to run. Browser timeout, crash, missing font,
   or unresolved asset refuses an edit/readiness; never downcast infrastructure failure to a warning.
4. Build relative-error comparison with a per-check documented magnitude definition. Group keys alone cannot let an
   existing overflow grow. Clear baseline caches on every relevant renderer/check/dependency change.
5. Implement explicit screenshot(slideIds), max four, JPEG exactly 1920x1080. It captures the same final render artifact
   used for checks. No screenshot is automatically included in every edit response.

Tests: adversarial golden slides for every threshold, variable font weights, text clipped inside a card, transforms,
multiline Stats, translucent backgrounds, hidden build geometry, empty Pending, missing/corrupt assets, timeouts/crashes,
and source/HTML/CSS/font equivalence between measurement and capture. Inspect sample images manually. Exit: every
required check has a real browser integration test and inability to measure consistently refuses.

## P7 — Atomic successful transactions and complete read/tool API

Dependencies: P2–P6.

1. Wire staging -> ownership/evidence -> ID allocation/normalization -> expansion -> schemas -> render -> browser checks
   -> relative-error comparison -> versioned durable commit. Treat these as one transaction, including archive changes.
2. Validate current dependencies and all transitively affected slides. Initially full-deck validation is acceptable;
   optimize only after dependency tests prove equivalent coverage. Cache only complete baseline reports.
3. Use per-deck serialization/CAS so no validated candidate overwrites newer input/dependency state. Accept unchanged
   target ranges despite unrelated edits. Do not hold a model inference inside the mutation lock.
4. Increment deck/definition/affected-slide versions consistently. Define no-op responses without inventing state changes.
   Return fresh anchored normalized source, new IDs, affected IDs, versions, warnings, and diagnostics.
5. Expose source, notes, library, palette, render, check, screenshot, and whole-deck readiness tools through Hono. Add typed
   host tool definitions for the unified edit interface; no legacy specialized agent mutation tools.
6. Add durable load/recovery and multi-deck separation, bounded requests, exact error taxonomy, and honest capability
   reporting. Source evidence stays private to editing/host APIs; audience render responses contain no notes/transcript.

Tests: successful small edit; several granular edits; failed last check rolls back every field; archive+delete; shared
layout edit plus fixes; unrelated stale edit accepts; target conflict refuses; failed check never commits; concurrent
input/edit; notes reads after archival; duplicate request; state survives reload. API contract tests cover all tools.
Exit: first real source-to-browser-to-commit vertical slice. Remove unconditional scaffold failures only now.

## P8 — Sandboxed viewer, builds, and retargetable motion

Dependencies: P5/P7. Package the viewer under this directory; leave frontend wiring to its owner.

1. Implement an iframe document and parent bridge with sandbox allow-scripts only, nonce CSP, embedded assets/fonts,
   sender/window/channel checks, versioned messages, and validated payloads. External network stays denied.
2. Fit the fixed canvas to the host viewport without responsive rearrangement. Instrument accepted revision, first
   content-visible frame, target arrival, and animation settlement in the browser's monotonic clock.
3. Implement build groups on any rendered node, unmarked/zero visible, ascending groups, equal groups together, hidden
   ancestors gating descendants, and final-space reservation. Preserve existing geometry during builds.
4. Implement same-parent FLIP, additions/exits, color interpolation, reparenting morphs, Stat counting, and slide-key
   crossfades. Retarget running motion from current visual state/velocity; do not queue every obsolete frame.
5. Overshoot movement only. Bound sizes, opacity, colors, and numeric interpolation. Handle reduced-motion work as deferred,
   not silently completed. Track the numerical-animation/fidelity product question in DECISIONS.md.
6. After settling, compare actual DOM against committed HTML plus explicit build visibility state and remove transient
   wrappers/styles. Block entry to presentation until whole-deck readiness passes; do not publish an unready live revision
   into a presentation. A validated previous revision may remain displayed while the agent resolves a new one.

Tests: actual browser animation interruption at multiple progress points; reorder/reparent retains identity; no duplicate
nodes after exits; bounded Stats/sizes; late font response; slide switch during motion; hidden groups reserve space;
malformed/cross-session postMessages; screenshot dimensions and final DOM equivalence. Capture animation video for human
review. Exit: real user-visible viewer with first-frame/settlement telemetry, not just server screenshots.

## P9 — Real model and host integration

Dependencies: P7/P8; coordinate host hooks identified in P0.

1. Bind the actual model tool calls to the engine, not to mocks or the old HTML edit publisher. Use the agreed agent
   instructions, literal JSX schema, and explicit notes/source reads. Preserve complete model responses for replay.
2. Expose multi-slide routing and stable utterance-to-slide association through an agreed host seam. Forward user commands
   and target context; do not pre-apply expected fixture edits outside the model path.
3. Preserve host immutable inference snapshots, latest pending speech with full evidence, and serialized valid commits.
   Rebase/relocate disjoint hashline targets normally; stale overlaps return actionable context to the agent.
4. Ensure incoming speech is recorded even while the model/validator is busy. Coalesce redundant scheduled work, never
   user content or original commands. Version deferred background improvements against all real dependencies.
5. Connect the packaged viewer to actual publication events and acknowledgments. Record every user-visible version and
   rejection/loading/error state, not only final HTML. Wire explicit screenshot requests into model observations.
6. Keep the existing dispatch/Decisions implementation outside this subsystem unless its owner changes it. The user
   removed the proposed decision-API layout fallback; layout choices are editing-agent choices, not a new service.

Tests: host contract tests plus a local integrated browser run with controlled recorded responses; real tool schemas;
slow model with new utterances; stale background result; explicit edits preserve unrelated content; reconnect/snapshot
resync; notes never reach audience. Exit: one live-model request produces a validated visible change through the actual
host/engine/viewer. If a host hook remains absent, report integration blocked, not “real system verified.”

## P10 — Timed talk harness, recordings, and offline replay

Dependencies: instrumentation begins P0; full harness requires P7–P9.

1. Implement planned CLI commands `eval:talks`, `eval:replay`, `eval:compare`, and `eval:report`; document exact arguments
   only once implemented. Keep package scripts here and all outputs under `.artifacts/`. Pin fixture schema/version.
2. Schedule each utterance against an absolute monotonic start clock at its endMs, regardless of pending inference,
   rendering, or publication. Record planned/actual delivery drift. Dispatch acceptance is not completion. Do not await
   system settlement between utterances. Continue recording for a bounded drain after the last utterance.
3. Capture complete source/HTML/CSS/publication history, user-visible video, explicit screenshots, errors/warnings, exact
   inference inputs/outputs/tool payloads, read snapshots, mappings, asset/font manifests, queue spans, API timing/cost,
   and browser first-visible/settled acknowledgments. Respect the explicit-screenshot tool policy: evaluator capture is
   telemetry and must not secretly become agent feedback.
4. Implement deterministic offline transaction replay and actor/tool replay with virtual time. Preserve/remap ephemeral
   snapshot IDs bijectively from recorded reads; never fuzzy-match a recorded patch or execute a recorded system prompt.
5. Implement metrics and claim/quote checks, diagnosis drilldowns, and a side-by-side comparison viewer per the loop doc.
   Fixture expectations are evaluator-only; never leak the answer key into model input.
6. Add an audio suite when aligned audio exists. Paced text isolates generation/editing behavior; it is not a microphone,
   speech recognition, or noisy-environment benchmark. Report those separately.

Tests: blocked inference does not delay next scheduled input; slow ingester produces recorded delivery drift; hung run
fails after drain deadline; no-op/rejected/hidden updates cannot count as visible success; failed calls recorded;
record/replay roundtrip reproduces outcomes; no network/model fallback during offline replay; mismatched cassette schema
fails clearly; missing visible output remains a miss rather than vanishing from latency summaries.
Exit: one reproducible script trace, offline replay, full visible timeline, and trustworthy latency attribution.

## P11 — First complete qualification and frozen baseline

Dependencies: P10.

1. Run each of the five provided talks with the real configured models and the actual host/engine/viewer at speaking pace,
   at least three independent fresh-session runs each as the initial default (15 runs). Record actual budget and failures.
2. Follow the seven-step process in docs/IMPROVEMENT_LOOP.md. Read every failure and representative clean runs; screenshots
   alone do not establish content preservation or queue latency. Compare raw input, notes, visible content, and trace.
3. Freeze the first complete functioning version and its dependency/model/prompt/fixture manifest. The scaffold is not a
   valid speed/quality baseline; the old single-slide HTML system is a separately labeled historical comparison only.
4. Produce a round report with evidence links, failure diagnoses, product options, and a decision ledger update. Ask only
   genuinely unresolved product questions. Record decisions with dates and the exact user answer.
5. Turn confirmed defects into deterministic regression/replay tests, then execute targeted fixes through P1–P10 seams.

Exit: honest complete first-round report, passing reproducible checks, and an immutable before version. Performance may
still miss goals; do not declare success because all runs merely finished.

## P12 — Evidence-driven improvement, then cleanup

Run the seven-step cycle repeatedly. Preserve priorities: faithfulness, responsiveness, consistency, visual correctness,
design quality, stability. A speed/design gain that damages facts, quotes, or source evidence is rejected. The desired
latency examples (<3 s typical, <6 s observed worst case) are targets for this work, not measured results or universal SLAs.

Only after the functional/evidence gates stabilize, perform separate refactoring passes: source/schema boundaries;
transaction/evidence ownership; renderer/check reuse; queue/publication lifecycle; telemetry/replay organization; dead
code/documentation cleanup. Keep each pass behavior-preserving and independently tested. A changed behavior discovered
while refactoring becomes its own diagnosis/fix, not an unreviewed cleanup side effect. Re-measure if performance paths
or user-visible timing change. See IMPROVEMENT_LOOP.md for continuation, regression, and stop criteria.

## Completion checklist for the next handoff

- Every spec requirement maps to an implementation and a test/evidence artifact; open/deferred items remain explicit.
- No placeholder renderer, fake validation success, hidden no-op mutation path, or unimplemented tool is advertised ready.
- Every user utterance survives in raw transcript; cleanup is limited; archived slides retain evidence; all 5 talks have
  claim/quote/edit outcomes audited. Unshown requested content is a failure even if preserved privately in notes.
- Every production edit uses the unified node-scoped hashline transaction and mandatory browser checks.
- Real-model runs and network-disabled replays both exist; errors/timeouts and failed repetitions are included.
- Side-by-side frozen-baseline comparison includes visible histories, per-talk/per-run metrics, and unresolved problems.
- Full-deck presentation readiness is enforced; no Pending or blocking final layout errors remain in qualified decks.
- Refactoring passes are separately verified, no scope creep occurred, and updated docs distinguish evidence from intent.
- Finish with exact commit SHAs, checks run, live-run manifests/budget, artifact locations, known limits, open decisions,
  and the next concrete action. Fetch/rebase before pushing additional commits; report a failed push honestly.
