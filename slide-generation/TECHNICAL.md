# Slide generation technical documentation

`SPEC.md` defines the target behavior. This document describes the initial scaffold, integration contracts, and the work
remaining before mutations or presentation can be enabled. It does not claim a complete slide renderer.

For continuation, read [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), the
[decision ledger](docs/DECISIONS.md), and the [improvement procedure](docs/IMPROVEMENT_LOOP.md).
The five [timed talk fixtures](fixtures/talks/README.md) are authored test inputs, not completed live runs.
Their loader, evaluator, real-model runner, recording, and replay tools are planned work; no benchmark results are claimed.

## Repository and implementation rules

- Work directly on **master**, not a feature branch or worktree.
- Scope every implementation file, test, dependency, lockfile, and document to **slide-generation/**.
- Do not change frontend/ or orchestration/ to integrate this package without a separate scoped change from their owner.
- Use multiple focused commits. Preserve other contributors' work.
- **Before every push: fetch, rebase onto origin/master, rerun relevant checks if rebasing affects the work, then push
  additional commits.** Never force-push. Do not amend or rewrite already-published commits.
- If fetch/rebase fails, do not push. Keep local commits and report the blocker.

Typical sequence from the repository root:

```sh
git status --short --branch
git add slide-generation/<specific-paths>
git commit -m "Describe the scoped change"
git fetch origin
git rebase origin/master
npm --prefix slide-generation run check
npm --prefix slide-generation test
git push origin master
```

The former workspace-level SPEC.md was replaced by slide-generation/SPEC.md and removed at the user's request. That
workspace file was outside the Git repository; its deletion is therefore not represented by a repository commit.

## Implemented foundation

| Module | Current responsibility |
|---|---|
| src/contracts.ts | Typed data, strict Zod edit envelope, canvas dimensions, validator/renderer/asset interfaces |
| src/parser.ts | acorn/acorn-jsx parser; literal-only object/array decoding; entity checks; global duplicate IDs; tag/name checks; node ranges |
| src/hashline.ts | Node reads, SHA-256 per line, bounded issued-snapshot store, exact range matching and unique relocation, atomic candidate construction |
| src/bootstrap.ts | Minimal source-valid JSON deck seed with IDs, theme, empty slide/evidence/archive |
| src/validation.ts | Unavailable validator, relative-error comparison, strict presentation-readiness predicate |
| src/engine.ts | Serialized transaction staging, protected-field/evidence guards, read APIs, mandatory validator boundary |
| src/app.ts | Hono source/notes/edit/readiness routes and structured errors |
| src/server.ts | Local Node server on loopback, port 8875 by default |

The engine currently **does not commit mutations**, even with an injected successful validator. It refuses with
`not_implemented` after successful validation because normalized ID allocation, versioning, archival, and durable commit
are not wired. The default validator refuses earlier with `validation_unavailable`. This makes the scaffold safe to
exercise without falsely accepting an unmeasured layout. Health reports `mutationsReady: false`.

Parser acceptance is not full schema validation. In particular, literal object shapes, primitive child rules, slot
contracts, renderable depth, class lint, theme constraints, and expansion still belong to the future semantic pipeline.
The parser applies independent resource limits (2 MB source, literal nesting 16, parser nesting 64); these do not replace
the stricter visual depth limits. Production limits should be configurable and measured against realistic decks.

## Local development

```sh
cd slide-generation
npm ci
npm run check
npm test
npm start
```

Node >=22.12.0 is required. The package lock is local to this directory. Tests use Node's test runner through the tsx
loader. The HTTP test suite invokes Hono in-process and does not require binding a network socket. No real browser is
needed for these foundation tests; they cannot establish rendering correctness.

Example reads:

```sh
curl http://127.0.0.1:8875/health
curl http://127.0.0.1:8875/source/n10
curl http://127.0.0.1:8875/slides/n10/speaker-notes
curl http://127.0.0.1:8875/presentation-readiness
```

Do not expose the development server externally. Authentication, durable deck storage, request-body limits, multi-deck
routing, and tenant isolation are integration work, not supplied by this local scaffold.

## Data and parser boundaries

The persisted envelope is `DeckDocument { schemaVersion: 1, source: string }`. On load, source line endings normalize
to LF; raw prompt ingestion must encode substantive user text without loss. Nodes retain exact source offsets so edits
operate on source bytes/UTF-16 string positions consistently, rather than serializing an AST and changing formatting.

Only known tags or declared definition names parse. JSX is never passed to eval, Function, an import, or a JS transform
for execution. Property values decode by traversing a strictly permitted AST subset. Objects/arrays are data only;
prototype keys, executable expressions, spreads, computed fields, shorthand, and methods are refused. Zod schemas must
subsequently validate each primitive's allowed keys and object types. Never serialize arbitrary prop objects as HTML
attributes or allow untrusted CSS through the render boundary.

Every element has a deck-wide ID in committed source. Candidate parsing temporarily permits omitted IDs on new nodes;
the future normalization stage assigns IDs and returns updated source. Existing IDs cannot be repurposed for another
tag. ID allocation must be monotonic and must retain a high-water mark across deletion/archival. Derived render IDs
must include instance paths and repeated-item identity, and never collide with authored IDs.

## Hashline protocol

Read returns `snapshotId`, `nodeId`, and `{number, hash, text}[]`. Hashes are full SHA-256 of the exact UTF-8 line text,
excluding LF. Line numbers are relative to the selected node's source, not the deck. Short display hashes are not used
as correctness guarantees. The stored snapshot records what the agent actually saw; an unknown/evicted snapshot requires
a reread. The scaffold retains the most recent 256 snapshots per engine.

An edit contains:

```ts
{
  snapshotId: string;
  nodeId: string;
  op: 'replace' | 'insert_before' | 'insert_after';
  startLine: number; // 1-based in the issued snapshot
  hashes: string[];  // every line in the contiguous addressed range
  text: string;     // raw replacement/inserted source; empty replacement deletes
}
```

All edits in `{edits: [...]}` resolve before applying any. Hashes must match the issued snapshot; exact text must then
match one contiguous range inside the current selected node. The entire range is checked, including interior lines.
Unique matching relocates shifted lines. Repeated identical ranges are refused even if one still occupies its old line
number: widen the range to include distinguishing context. Inserts additionally verify both neighbors of the original
gap, including node boundaries. Replacements replace line text without swallowing neighboring newlines; inserts add a
newline separator. Ancestor/descendant overlap and ambiguous insertion boundaries refuse the batch.

The scaffold requires each selected scope node to survive with the same ID. To remove a node, edit its parent. Moving
full JSX uses a delete and insert in one transaction, retaining IDs. No `<Text id="..." />` content-reference shortcut.
Generated read prefixes/hashes never become stored JSX. Do not reformat whole nodes after each mutation: that would
unnecessarily invalidate hashes. Return refreshed reads after normalization.

## Transaction completion work

Implement the following before enabling success responses:

1. Stage all ranges against current source under a per-deck transaction queue/lock.
2. Validate ownership: IDs, versions, provenance, raw transcripts and archives are system-owned. Add append-only trusted
   input ingestion; notes remain editable through JSX. Preserve originals when user speech is corrected.
3. Allocate IDs for new nodes, normalize slot roles and effective font floors, and preserve free-form reasons.
4. When a slide is deleted, move notes/transcript to archive in the same candidate, preserving globally unique IDs.
5. Build the transitive definition dependency graph. Expand components/Each/slots; reject cycles and validate both depth
   limits. Reject duplicate layout slot shapes. Produce Pending warnings where required content is absent.
6. Render with Hono JSX and compile Tailwind v4 in trusted code. Resolve exact asset/font versions through AssetResolver.
7. Run all Playwright checks on the baseline and candidate or use a baseline cache tied to exact source, renderer version,
   font/asset versions, and check policy. A missing/failed check is not a finding to grandfather; it refuses the edit.
8. Compare errors using stable (check, slideId, nodeId) keys plus quantitative magnitudes. Unchanged existing errors may
   remain in drafts. New/worsened errors refuse. Presentation readiness checks the entire deck with no grandfathering.
9. Increment system versions for changed slides/definitions and affected dependents; record normalization and ID changes.
   Recheck that validated source and dependencies are still current. Commit source and evidence atomically to durable JSON.
10. Return normalized anchored source, new IDs/versions, warnings, and affected slides. Do not return screenshots unless
    explicitly requested. On refusal return diagnostics and useful fresh read context without changing committed state.

The current in-process queue is a foundation, not a distributed lock. Deployment with multiple workers needs database
CAS or a single owning process per deck. A shared-definition or theme edit must validate every transitive dependent.
Initially validating the whole deck is correct though slower. Never skip slides merely to meet a latency target.

## Rendering and browser adapter

SlideRenderer and ValidationPipeline are intentionally separate: obtaining HTML is not proof it passes browser checks.
No HTML renderer, Tailwind compiler, Playwright measurement, APCA implementation, asset resolver, or bundled font bytes
are supplied yet. Dependencies are declared so these can be added without changing adjacent packages.

Render final layouts at CANVAS = 1920x1080 for both measurement and JPEG screenshots. Wait for exact shared font bytes
and asset decoding. Abort external network and disable page-authored JavaScript. The client uses a sandboxed opaque-origin
iframe with a nonce-owned animation script. Validate the sender, channel token, and message shape; use source window
identity because the sandboxed origin is opaque. Reject external asset URLs in favor of embedded resolved bytes.

The animation adapter must preserve data-node identity, retarget springs with current velocity, and permit overshoot
only for movement. All other values stay bounded. Implement FLIP, additions/removals, color transitions, reparenting
morphs, Stat counting, and slide crossfades. Discard superseded targets. Final DOM must settle to posted HTML with only
explicit build visibility state. Reduced-motion support is deferred.

Build groups are numeric attributes on any rendered node; unmarked/zero groups show initially. Parent visibility gates
children. Hold invisible nodes in final geometry. Preview all build states without changing measured final layout.
A presentation revision requires zero Pending and no blocking errors anywhere, even errors tolerated during editing.

## Notes and assets integration

Lucide icons have a dedicated planned `Icon` primitive and read-only full-catalog search/inspection tools, separate from
generic Image assets. Inherit effective text color with an optional theme-token override; preserve the catalog's stroke
width/geometry. See [Lucide icon handoff](docs/LUCIDE_ICONS.md) for schema, rendering, tooling, and test requirements.
This is a documented requirement, not implemented access: the current parser does not yet recognize Icon, and no Lucide
package/catalog/search endpoints are installed. Implement them in the plan before advertising availability.

read_speaker_notes is a read capability, not a semantic proof of completeness. It supplies cleaned notes plus original
transcript for the editing agent to compare. Prompt instructions restrict cleanup to fillers, false starts, and redundant
repetition. Do not implement semantic heuristics as runtime blockers after the user's decision to make editorial rules
prompt-only. Runtime guards still protect raw source evidence and prevent partial archive deletion.

Asset contracts are deliberately provisional. AssetReference uses `{id, version}` in the scaffold; a provider adapter may
refine it. Never resolve an implicit latest version. Finished images/SVG figures/tables are contain-only with automatic
layout boxes. SVG sanitization and self-contained ingestion belong to asset management. Custom fonts are assets, shared
by client/server, with a bundled default still to be selected and packaged. Internal asset typography is reviewed through
screenshots, not native text checks. No provider API, storage backend, OCR requirement, crop API, or native chart/table
editing is introduced here.

## Existing repository integration

The current orchestration package publishes HTML and its default canvas is 1280x720; the frontend has its own Slide/Project
models. This scaffold does not silently replace either contract. Future adapters must translate accepted canonical deck
revisions to renderer publications at 1920x1080, attach note/transcript context, and route agent tool calls through the
single transaction engine. Coordinate these adapters with the owners of those directories.

## Validation coverage and next milestones

Foundation tests cover hostile JSX constructs, literal objects, entities, duplicate IDs, node lookup, hashes, unchanged
range acceptance after unrelated changes, unique relocation, ambiguous/changed/interior ranges, gap context, overlap,
atomic candidate refusal, protected fields, browser-unavailability refusal, relative errors, readiness, and Hono routes.
They do not replace real Chromium integration tests, golden slides, or animation interaction tests.

Next milestones: strict primitive schemas and normalization; archive/ID/version commit; layout expansion and dependency
tracking; Hono/Tailwind renderer plus shared font resolver; real browser checks and screenshots; iframe motion/builds;
then orchestration/frontend adapters. Enable mutation success only when all required validation is connected.

References for the editing design: OMP's current source-edit documentation at
https://github.com/can1357/oh-my-pi/blob/main/docs/tools/edit.md and its historical hashline explanation at
https://stencil.so/blog/the-harness-problem . This implementation intentionally uses **per-line hashes** and node scopes,
not OMP's current file-level snapshot-tag wire format. No universal model accuracy claim is assumed.

## P0 implementation update (2026-10-31)

Added strict five-talk loading and evaluator-only expectation validation (`src/evaluation/fixtures.ts`), a host-safe
spoken-input projection, strict credential-free manifest fields/run directories, typed causal trace events, and separate
capability reporting. Engine reads and refused transactions emit ordered trace metadata. See `docs/HOST_PORT.md` for
the proposed integration boundary and the confirmed old-Publisher mismatch. The evaluator/runner remain unimplemented.

Environment probes: baseline `dae4a82`; initial typecheck and four test files passed. Git fetch failed with
`Could not resolve host: github.com`. Installed Playwright Chromium failed at launch with `sandbox_host_linux.cc:41`,
`Operation not permitted`. Browser validation and pushes cannot be verified in this environment; no live scores exist.

## P1 implementation update

`src/schema.ts` now validates strict primitive props, typed object shapes, metadata placement/cardinality, child rules,
visual depth, class allowlists, required base colors, and token/frame constraints. Structure errors carry node IDs and
source spans. Parser literal failures now retain the nearest available authored ID. Engine candidates run these
checks before the unavailable browser pipeline. Definition expansion and resolved palette checks remain later stages.

Icon is recognized as a dedicated primitive with required name/version/alt, inherited-or-token color semantics, existing
transforms/builds, no children and no stroke/fill/size/path props. Definition utilities cannot override strokes. Exact
catalog resolution is mandatory: without an injected resolver Icon validation refuses `icons_unavailable`. No catalog
or renderer is installed or advertised available. Catalog tests use an explicitly labeled test resolver, not Lucide data.

Instance syntax for the expansion milestone: named `<Slot name="…">one child</Slot>` bindings; definition declarations
are empty `<Slot name="…" kind="…" />`. Each repeats a wrapper using Item; repeated bindings are resolved in P4.
Literal text remains byte-preserving in source and is not trimmed by schemas. Inline emphasis is text syntax, not raw
HTML/JSX tags. Persisted envelope schema remains version 1; no automatic migration is performed by schema validation.

## P2 staging update

Anchored reads include source range and revision digest. `stageDetailed` returns exact matched bytes, every hash,
original/current scope ranges, line relocation, and candidate source. Insertions at the outside of a scoped root refuse;
root replacements cannot smuggle siblings outside the selected node. Target the parent for sibling insertion/deletion.
Tests include inline siblings, multiline attributes, Unicode, and 40 deterministic disjoint-edit comparisons. Snapshots
are engine-local, bounded, and not persistent; restart/eviction requires a fresh read. Transport idempotency and durable
ownership/evidence lifecycle are still P3/P7 work. No edits commit yet.

## P3 candidate transformations

`src/source/` now provides formatting-preserving attribute/child surgery, monotonic ID allocation using canonical
Deck.nextId, strict evidence/system ownership, deletion archival, and separate version advancement. Trusted ingestion
candidates retain exact utterance strings (including whitespace, CR, braces, entities and Unicode), initialize notes
without paraphrasing, append corrections, and reject conflicting duplicate utterance IDs. Deleting a slide archives its
original notes/transcript exactly once with their IDs and source-slide association. Archived notes can be read.

The engine now prepares these candidates, including new IDs, before structural and external validation. It still
unconditionally refuses final publication: source normalization/expansion, mandatory browser checks, and durable commit
are not connected. Pure candidate tests are not successful mutation or ingestion API claims. Ingestion is not exposed
as an agent editing tool. Existing source uses lazy high-water migration on candidate creation; no whole-deck formatting.

## P3 storage primitives

`FileDeckRepository` stores only the versioned JSON source envelope using fsynced temporary files, atomic rename,
and directory sync. CAS rejects stale revisions and serializes writers across repository objects for the same path in
one process. Pending temporary files are never loaded as committed source. A directory-sync error after rename is a
`DurabilityError` with `replacementOccurred=true`: callers must reload, not falsely claim rollback. Multi-process
writers and path aliases/symlinks are unsupported; this is not a distributed repository.

`EvidenceInbox` durably retains idempotent input before expensive work and preserves receipt order, including tied or
out-of-order delivery timestamps. It survives restart and will clear an event only when the supplied committed source
contains exactly that evidence. These storage primitives are tested on the actual filesystem but not wired to engine
publication/host ingestion yet. Their existence does not enable the commit or live-host capability.

## P4 expansion

`expandSource` now builds dependency closure, rejects cycles/nesting violations and duplicate layout slot shapes,
expands Layout/Component/Slot/Each/Item/Index, records transitively dependent slides, and normalizes slot roles/sizes
into canonical source. Required missing slots and Each shortages produce deterministic Pending nodes; optional slots
may disappear. Repeated items use repeated named Slot bindings, one child each. Structural identities include instance,
definition and repeated authored-item IDs in an `@` namespace unavailable to authored IDs. Reordering preserves wrappers.

Tests cover layout ground replacement, nested components, transitive dependencies, missing slots, type/count errors,
canonical role normalization, duplicate shapes, cycles, and expanded depth independently of authored depth. The engine
uses expansion on candidates; final browser validation/publication remains disabled. Unused-definition expanded-depth
validation and broader adversarial coverage still require review before P4 is considered fully qualified.

Custom-font source references use provisional `Theme font={{id, version}}`, through the existing injected asset resolver;
this adds no provider/storage contract. Renderer and browser work are ongoing in parallel.

## Permission restart and validation review (2026-10-31)

The permission restart removed the earlier browser/network blockers. A real Playwright Chromium 156.0.8078.4 probe
launched with page JavaScript disabled and requests blocked, measured a 1920x1080 canvas and captured a JPEG. Evidence:
`.artifacts/environment/browser-permission-probe.json` and matching JPEG. This is environment validation only, not P6
qualification. Fetch/rebase, typecheck, 98 individual tests, and push through `0f84e18` succeeded.

Independent measurements now include an optional stable Finding.subject, so an improving overlap/bound cannot hide a
new violation at another partner/bound. All definitions now receive expanded-depth checks even when unused, with
representative bindings ensuring optional/zero-minimum slots cannot conceal deep wrappers. Renderer/browser/viewer
integration remains underway; earlier implementation status entries are historical checkpoints.
