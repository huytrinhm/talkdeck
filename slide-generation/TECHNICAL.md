# Slide generation technical documentation

`SPEC.md` is the behavior contract. The subsystem now has a working canonical-source → Hono/Tailwind → Chromium checks
→ durable commit path, exercised by real-browser integration tests. The packaged viewer also has real Chromium tests.
The actual actor scheduler is now connected through an injected canonical JSX backend in this consolidated package.
A real headless iframe records viewer acknowledgments and frames without a product frontend. The integrated three-input
pilot and exact offline actor replay completed. The four diagnostic stages are consolidated in [Pass 1](docs/rounds/pass-01/README.md). Its final frozen pair
completed but retains fidelity failures. The broader [Pass 2](docs/rounds/pass-02/README.md) closed with six completed runs, one timeout and one user-skipped run; repeated five-talk qualification
and separately verified refactoring remain unfinished.
Passing integration tests or structural readiness does not establish faithful visible generation.

Read `AGENTS.md`, `IMPLEMENTATION_PLAN.md`, `docs/DECISIONS.md`, `docs/LUCIDE_ICONS.md` and
`docs/IMPROVEMENT_LOOP.md` when continuing. The current checkpoint is `docs/continuation/README.md`; superseded permission checkpoints are under `docs/history/`.

## Development and scope

Work directly on master, keep all changes under slide-generation/, and make focused additional commits. Before every
push fetch/rebase origin/master, run relevant checks, then push. Never force-push. On 2026-10-31 the user explicitly
authorized merging the previous orchestration package here, superseding the earlier ownership boundary for that move.
There is one package manifest/lockfile: `src/orchestration/`, `test/orchestration/`, `fixtures/legacy/`, and
`docs/orchestration/` hold its moved code and history. Current changes stay here; frontend work remains separate.

```sh
npm ci
npm run check
npm test
npm start
```

Node >=22.12.0. The development service listens on127.0.0.1:8875 (`SLIDE_GENERATION_PORT` overrides it). Storage defaults
to `.artifacts/decks/default/`; `SLIDE_GENERATION_DIRECTORY` must remain inside this package. The development routes
are private editing/host APIs, not an authenticated multi-tenant deployment. Use one process per canonical storage path;
path aliases/symlinks and concurrent external writers are unsupported.

Credentials are environment-only in new subsystem runners. The user explicitly requested shell sourcing:

```sh
set -a
source ./.env
set +a
# Run the desired command in this shell.
```

`.env` is ignored and untracked. Subsystem code must not read or parse it, record credentials, or put them in browser
messages. Model access and a 16-token Responses inference succeeded after sourcing on 2026-10-31. A subsequent bounded
direct generation smoke passed using six real requests, real edits/checks and the packaged viewer; see
`docs/rounds/subsystem-smoke-2026-10-31.md`. This does not establish five-talk qualification; it predates the now-tested actor-host adapter.

## Implementation map

| Area | Implemented | Remaining boundary |
|---|---|---|
| parser/schema | acorn literal JSX, strict Zod props/children, identities/spans, placement/depth/class rules | Broader adversarial/regression work continues with model evidence |
| hashline | issued exact lines/hashes, unique in-scope relocation, gap/overlap checks, no scope escape | Snapshots are bounded and expire on restart |
| source candidates | formatting-preserving IDs/normalization, system ownership, exact evidence, corrections, archival, versions | Semantic notes fidelity remains agent responsibility |
| expansion | definitions, cycles/depth, duplicate slot shapes, Each/slots/Index, stable derived IDs, dependency graph | No automatic layout repair or fallback |
| renderer | Hono JSX primitives, Tailwind v4, paired/derived theme colors, font floors, exact font/image/catalog bytes | Asset/provider contract intentionally provisional |
| browser | mandatory measured overflow/overlap/wrap/contrast/floors/shape checks, bounded pool, JPEG captures | See quantitative policies and unsupported measurement cases in docs/BROWSER_CHECKS.md |
| engine/storage | normalized validated CAS commit, revisioned reads, durable inbox, restart recovery, input/edit races | Single process; host owns stable input/slide attribution |
| tools/API | unified edit_source plus source/notes/library/palette/icons/render/check/screenshot/readiness tools | No legacy specialized mutation tools |
| viewer | sandbox/CSP/channel protocol, fixed canvas, builds, retargeted motion, exact settlement, headless acknowledgments/video | Product frontend wiring remains separate |
| orchestration | Persistent real Fast/Slow actor scheduler, Decision gates, backend injection, canonical JSX tool/context adapter and control epochs | Live quality and provisional specialist assets require measurement |
| headless/evaluation | Real packaged iframe, durable input routing, bounded recorded providers, paced driver, audits/reports, replay and comparison foundations | Pilot and actor replay recorded; full-talk faithfulness, repeated comparison and human semantic/design qualification unfinished |

## Canonical source and safe data language

The JSON envelope is exactly `{schemaVersion:1,source:string}`. Theme, definitions, slides, notes, original prompts and
archive live in that source. Parsing/expansion/rendering are derived. Literal parsing never evaluates source JavaScript.
Duplicate attributes/object keys, prototype keys, executable expressions, raw SVG, unknown entities and malformed data
refuse. Source length is bounded to2MB; literal nesting16 and parser nesting64 are independent of visual/component depth6.

Every persisted element has a unique authored ID. New nodes omit IDs; source allocation writes tag-prefix IDs and the
monotonic Deck.nextId high-water mark. Existing IDs cannot be forged/retagged. Structural expanded IDs use a disjoint
`@` namespace containing instance/definition/item identity; slotted user content retains authored identity. Source surgery
updates only required attributes/children instead of pretty-printing the entire document. Exact substantive text,
whitespace, Unicode and encoded CR/braces survive ingestion and archival.

Raw transcripts/archives are system-owned. Trusted host ingestion appends exact original utterances and corrections;
cleaned notes remain editable through hashline JSX. No runtime semantic judge claims to prove notes completeness.
Deleting a slide archives its original notes/transcript atomically, preserving IDs and source-slide association.

## Editing and persistence

`read_source(nodeId)` returns snapshotId, nodeId, sourceRange, revision SHA256 and numbered `{number,hash,text}` lines.
Convenience scopes deck/theme/library resolve actual IDs. Each edit identifies every affected issued line hash plus
snapshot ID, operation and literal replacement text. Replacements may delete with empty text. Insertions check both gap
neighbors. Relocation is exact and unique within the selected node; repeated/missing/changed/unseen ranges refuse.
Sibling insertion/deletion targets the parent. No empty-element content retrieval exists.

`SlideEngine` stages all ranges against current source, checks protected fields/evidence, allocates IDs, expands and
normalizes, advances versions, and runs the complete baseline/candidate browser pipeline. New or quantitatively worsened
errors refuse; unchanged draft errors may remain. Readiness always requires every slide to have zero errors/Pending.
Independent `Finding.subject` values distinguish overlap partners and bounds so one improvement cannot hide another
regression. A failed/unavailable check never counts as a valid baseline.

Browser work does not hold the short source-write lock. Durable input receipts and final CAS/deletion are ordered through
that lock; newly retained evidence is drained before final edit commit. Disjoint edits are restaged against fresh source
up to a bounded retry limit. Target changes refuse. Idempotency keys cache the original result for256recent requests
within an engine lifetime; conflicting key reuse refuses. Restart/eviction requires rereads rather than guessed retries.

`FileDeckRepository` writes a fsynced temporary JSON file, atomically renames and syncs the containing directory. It
compares expected source digests and stores no duplicate editable state. Pre-replacement failure leaves old source.
Post-replacement durability uncertainty is explicit; callers reload rather than falsely claiming rollback. Repository
and engine normalize source line endings consistently; raw original CR is encoded in source text.

`EvidenceInbox` records input durably before expensive work and preserves receipt order, including tied timestamps.
Duplicate payload conflicts refuse. Stale/missing target events remain durably blocked with explicit IDs/errors instead
of silently moving to another slide or preventing unrelated valid input from draining. Host routing must resolve those
cases. Acknowledged pending evidence is distinct from an applied canonical revision.

The default bare `new SlideEngine(createDeck())` remains fail-closed. Production local service construction is
`createLocalRuntime`, which wires real renderer normalization, catalog resolution, browser checks, repository and inbox.
Unit-test validators are labeled mocks and do not establish browser correctness.

## Rendering, icons and assets

`HonoSlideRenderer.normalize/render` resolves canonical typography and layout, then produces a slide fragment, compiled
CSS, normalized source, dependency digests, fonts and Pending IDs. Audience fragments never include notes/transcripts.
All clients receive the same embedded Noto Sans default bytes or explicitly versioned resolved custom font. Font decode
and glyph coverage checks refuse fallback to unmatched host fonts. Native font floors apply after cumulative zoom.
Custom font reference is provisional `Theme font={{id,version}}`; assets use injected exact-version resolution.

The complete pinned Lucide1.55.0 catalog contains1,877canonical icons and264aliases. `search_icons` browses/searches the
full catalog with bounded query-bound pagination; `read_icon` returns exact identity/version and trusted SVG preview.
Icon is dedicated, childless and inline Hono SVG: currentColor inherits surface foreground, optional color is a theme
token, original stroke geometry/width stays fixed. Unknown versions/names or stroke/fill/path/size overrides refuse.
The static catalog is extracted as data without executing React. Digests/licenses/provenance: `assets/README.md`.

APCA uses pinned apca-w3@0.1.9 with official reference vectors. Explicit brand colors remain unchanged; derived fills
are adjusted to readable foreground pairs. Image assets are embedded, contained and automatically allocated. SVG must
arrive sanitized/self-contained; boundary checks reject executable/external content. No asset management, cropping,
OCR or provider-specific storage contract is introduced.

## Browser and viewer

Browser validation uses real Chromium1920x1080, page JavaScript disabled, external requests aborted, exact fonts awaited
and images decoded. It measures leaf native-text ranges, actual composited background pixels and Shape paint masks.
Every required measurement must complete. Explicit screenshot requests return at most four JPEGs at1920x1080 from the
same immutable artifact. Internal measurement images never become automatic model feedback. Details and quantitative
severity definitions are in `docs/BROWSER_CHECKS.md`.

The viewer iframe uses sandbox allow-scripts without allow-same-origin, a nonce CSP, embedded resources, and strict
sender/channel/version/payload checks. Presentation accepts only a complete-deck readiness proof for the same revision.
Build groups reserve final geometry and obey ancestor gates. Motion retargets; final DOM removes transient styles and
exit clones. Applied/painted/settled acknowledgments include publication/revision identity; paint opportunity telemetry
still needs timeline review to establish actual user-visible correctness.

D56 resolved O01: keep bounded Stat counting and treat intermediate digits as animation rather than factual claims.
Source endpoints/final target stay exact, intermediate frames remain recorded, and first-correct latency requires the
requested target value. Reduced-motion support remains explicitly deferred.

## Verification and remaining work

The historical standalone implementation run passed 185 individual tests, including real renderer/browser/viewer/runtime
integration. Focused real tests cover successful durable edits, overflow refusal/rollback, archive deletion, reload,
actual JPEG dimensions, composited contrast, font/image failures, timeouts/crashes, sandbox messages, interrupted motion,
reparenting and build changes. The exact output is `.artifacts/environment/final-implementation-suite.tap`; use current results rather
than treating this count as permanent. Artifacts live under ignored `.artifacts/`.

Publication checks can reuse browser evidence for exactly matching rendered artifacts within a bounded,
in-memory cache owned by the browser pipeline. Every lookup resolves the current render dependencies;
HTML, CSS, source, fonts, asset/dependency digests, pending IDs, artifact key and check-policy versions
participate in the key. Failed inspections are evicted. Normal authoring and practice validation stay
fresh; only publication opts into reuse. This avoids remeasuring the entire unchanged deck on navigation.

`GenerationSession` remains a publication/ack adapter. The actual `SlideRuntime` is under `src/orchestration/` and accepts
`GenerationBackend`; `JsxBackend` binds its immutable inference contexts and role-scoped tools to the canonical engine.
`createEvaluationHost` connects that scheduler, recorded providers, durable input routing and `HeadlessRecordingSession`.
Explicit new-slide/return commands control harness selection from actual input, never evaluator aliases. The legacy HTML
publisher remains available only as an explicit alternate backend. See `docs/HOST_PORT.md`.

The consolidated tree through `16a1671` was pushed after typecheck and all 302 tests passed; exact output is
`.artifacts/environment/pre-push-headless-suite.tap`. Tests cover injected actor scheduling, canonical checked edits and
control boundaries, requested-only screenshots, real editor/audience iframe frames and video, typed model records, shared
budgets and offline provider replay. Test-level audience coverage is not evidence of audience build behavior in the live
talk harness. Counts identify a verified revision, not a permanent guarantee for later edits.

The integrated pilot used 26 real calls, retained three inputs and committed two visual edits. Its reported qualifier miss
was manually traced to whole-node exact-match granularity; original results remain unchanged. The recorded-event actor
replay verified 26 exact provider requests, 12 tools and six commits with final source SHA-256
`35a6018667fb0162a1dec61a33c1ab3ea9d2973cb548cf1c7caad4d2541010de`, real browser checks and no live fallback.
Evidence: `docs/rounds/headless-integration-2026-10-31/README.md` and
`.artifacts/review/actor-replay-pilot-attempt3/report.json`. Replay does not measure live response times.

Round 01 full edit-heavy baseline/candidate trials produced blank slides despite ready=true. Baseline made no edits;
the context candidate made one correctly refused private-notes anchor edit, then failed to recover. A later unknown
renamed target remained durably received but absent from canonical source and ended the candidate with host-error. Cases
are in `docs/rounds/pass-01/stages/01/cases/`. Neither readiness nor absence of a requested deletion target on a blank slide
establishes useful output. Those original scores are preserved. The current evaluator refuses removal credit without
prior visible content; evaluator changes must apply equally to both comparison versions.

`npm run headless:run -- --fixture fixtures/talks/edit-heavy.json --out .artifacts/runs/edit-heavy-baseline-1` runs the
actual integrated timed path after shell-sourcing credentials. Responses uses Fast tier; Decisions exposes no service-tier
parameter and explicitly records its endpoint-default policy. Raw requests, returned tiers, provider errors, missing
usage and replay records remain distinct. Unknown usage remains conservatively charged, not fabricated as zero.

Every canonical revision has exact source evidence. Input-only transcript/notes commits record checks as unperformed and
renders as empty because public visuals are unchanged; edit commits record real checks and renders. Visible-frame audits
require actual sampled content in the current slide, coherent publication identity and the correct time window. Final
readiness and offscreen final JPEGs cannot substitute for visible latency. Unsupported semantic/design assertions remain
manual-review misses. Reports include coverage/censoring and link the original PNG/video and final slide gallery.

`headless:batch` executes verified frozen baseline/candidate copies sequentially, with three repetitions of all five
fixtures by default. `--plan-only` makes no model calls; `--fixtures`, `--repetitions`, `--max-runs` and per-run token/call
limits bound execution. Generator SHA is distinct from common evaluator/observer hashes. Frozen execution artifacts live
at the directory in the container's `run-location.json`, normally `execution/slide-generation/.artifacts/run/`.
Pass 1 retains the completed diagnostic pairs and exact comparison limitations. The closed breadth batch used frozen
`734d84a` and `7aee9be`; see current continuation for outcomes and README for exact commands. Complete-deck PNGs are
composed from every actual final slide capture; original per-slide images and video remain unchanged. Initial manifest
dependencies contain resolved digests, with an additional source-referenced initial/state inventory after each run.

`headless:replay` replays canonical transactions; `headless:actor-replay` also exercises the actual scheduler with exact
recorded provider requests, completion ordering and semantic clocks. Neither has a live fallback. `headless:run --recover`
is report-only recovery after failed cleanup/export: it requires the original failure, driver and source evidence,
refuses to replace reports, records recovery provenance and returns failure status. It neither resumes generation nor
claims successful completion.

Still required: resolve demonstrated full-talk failures, run all five paced talks with repetitions and complete histories,
review actual visible/audience behavior and semantic/design outcomes, replay each fix, compare compatible frozen versions,
then perform separately verified refactoring passes. Frontend integration remains separate. No full qualification,
latency target, cost improvement or completed improvement-loop claim is made.

## Practice review orchestration

`src/practice/` adds backend rehearsal recording and end-of-practice review on the
canonical actor host. It front-loads full source/anchors, rehearsal evidence, notes
and images into one tool-free structured Responses request. Proposals are native
transactions prepared in isolated engine forks, with real browser checks and
private previews. Acceptance revalidates changes, checks the exact candidate at
commit, and creates a canonical undo unit. Practice speech bypasses generation;
explicit push-to-edit still works. See [the contract and API](docs/PRACTICE-REVIEW.md).
No product frontend, prosody inference, or long-talk summary pipeline is added.

## Design skills

`skills/slide-design/` adapts the standalone design library to canonical JSX.
`src/design/skills.ts` loads, fingerprints and compiles it for Fast (compact index),
Slow (full recipes) and end review (full recipes plus proposal guidance). Live
headless/practice factories opt in; directly constructed backends remain explicit.
Decision gates and tool inventories are unchanged. Review context retains exact
guidance; headless configuration retains the whole skill snapshot for replay.
See [DESIGN-SKILLS.md](docs/DESIGN-SKILLS.md) for capability limits and provenance.

## Model-facing boundary audit

The current canonical flow supersedes the earlier metadata-only decision payloads and
explicit-screenshot-only actor input. Both gates and actors receive immutable source plus
real rendered image observations with explicit availability; history projection bounds
repeated state. Native tool contracts and specialist result delivery are self-contained.
Practice revision excludes persisted preview artifacts from model text and attaches candidate
images separately. Headless/practice hosts load the same compact editor instruction base.
See [MODEL-BOUNDARIES.md](docs/MODEL-BOUNDARIES.md) for exact scope, evidence and limitations.
