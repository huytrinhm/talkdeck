# Developer handoff: Talkdeck orchestration

> Consolidated on 2026-10-31 by explicit user instruction. This document preserves the legacy HTML scheduler/control
> contracts and historical measurements; it does not describe a separate npm package anymore. Code is now under
> `src/orchestration/`, tests under `test/orchestration/`, and original WAV/text fixtures under `fixtures/legacy/`.
> The actual actor scheduler now also accepts the canonical JSX backend; see the [current host integration](../HOST_PORT.md)
> and [package commands](../../README.md). Historical `runs/...` paths and test counts below retain their original
> provenance and may not exist in a fresh checkout. They are not integrated five-talk results. Frontend work remains separate.

Historical snapshot: commit `7ca6bde`, 2026-10-31, before consolidation. Its original HTML path and measurements
are retained below. Current integration uses the same actors with an injected canonical JSX backend and a headless
packaged viewer; the integrated live pilot and repeated five-talk qualification remain unfinished.

## Read in this order

1. [Product idea](PRODUCT-IDEA.md): users, workflow, and unimplemented intentions.
2. [Design decisions](DESIGN-DECISIONS.md): rationale, superseded rules, and limits.
3. [Deck contract](DECK-CONTRACT.md): navigation, publication, pause, history.
4. [README](README.md): setup, HTTP APIs, events, and fixture commands.
5. [Verification](VERIFICATION.md): automated versus historical live evidence.
6. [Canonical host integration](../HOST_PORT.md): current backend injection, headless runner, evidence and remaining qualification.

## State of the implementation

| Area | Current status |
| --- | --- |
| Live transcription and 200 ms speech Decisions | Implemented; full per-slide snapshots and corrections |
| Fast / Slow lifecycle | Persistent histories; serial per actor, concurrent between actors |
| Slow activation | Separate Decision wake/hold; explicit work bypasses it |
| Deck controls | Stable IDs, next/select, atomic batch/split/merge, pause/resume |
| Specialists | Two active initially; private immutable assets; only Slow integrates |
| Push-to-edit | Prompt/comment task to Slow; captured target; separate from speech |
| Undo/redo | In-memory deck transaction stacks; stale-work cancellation |
| Transport | Local HTTP/SSE and exported TypeScript interfaces |
| JSX generation integration | Implemented after consolidation; see [current host port](../HOST_PORT.md) |
| Feedback / practice / present policy | Missing; do not equate pause with practice |
| Notes / rewind / pointer / prediction | JSX source/notes integrated; audio rewind/pointer/prediction remain product work |

## Code map

| File | Responsibility |
| --- | --- |
| `src/orchestration/runtime.ts` | `SlideRuntime`, actors, boundaries, navigation, push-to-edit, undo/redo cancellation |
| `src/orchestration/gate.ts` | Fixed speech clock, immutable decisions, correction handling, replay suppression |
| `src/orchestration/openai.ts` / `src/orchestration/config.ts` | SDK adapters, model prompts/settings, credentials |
| `src/orchestration/publisher.ts` | Original HTML deck store, branch merge, transactional publication, history stacks |
| `src/orchestration/renderer.ts` / `src/orchestration/assets.ts` | Chromium validation/rendering and immutable assets |
| `src/orchestration/history.ts` | Persistent conversation/tool history and two-image observation projection |
| `src/orchestration/tools.ts` | Role-specific schemas and tool definitions |
| `src/orchestration/abortable.ts` | Stop awaiting cancelled provider work; late outcomes remain handled |
| `src/orchestration/transcription.ts` | Audio transport, transcript accumulation, WAV parsing |
| `src/orchestration/server.ts` | Local HTTP/SSE, mutation ordering, audio segmentation |
| `src/orchestration/backend.ts` | Backend and immutable inference/tool interfaces |

## Run and verify

From `slide-generation/`:

```sh
npm ci
npx playwright install chromium
npm run check
npm test
npm run legacy:server
```

The pre-consolidation suite recorded 75 tests. It uses deterministic models and real local
Chromium/HTTP/WebSocket checks, not paid model calls. The server listens on
`127.0.0.1:8787` by default. Credentials now come only from process environment; source `.env` in the shell and never commit it.
This policy applies to the moved legacy commands as well as the integrated runner. Keep run logs and `node_modules` ignored.

For a paid legacy HTML fixture run, after shell-sourcing credentials:

```sh
node --import tsx src/orchestration/fixture-deck.ts
node --import tsx src/orchestration/audit-deck.ts .artifacts/legacy-runs/<deck-run>
```

The `fixtures/legacy/test-fixture-5-slides.txt`, `.wav`, and `.json` are a matched synthetic
fixture: five fictional library-pilot slides, same-slide and cross-slide numeric
corrections, and explicit navigation timing. Metadata stores hashes and exact
sample boundaries. Do not regenerate audio just to run tests. The original
single-slide fixture remains unchanged. `src/orchestration/generate-five-slide-fixture.ts` is
an explicit paid regeneration command and writes those fixture files.

Current run output is under ignored `.artifacts/legacy-runs/`. Historical paths and measurements in VERIFICATION.md describe
local evidence, not artifacts guaranteed available after cloning. Reproduce tests
locally; request a separate sanitized evidence export if those run logs are needed.
Do not quote historical first-frame timings as a latency guarantee for this build.

## Controls and failure semantics to preserve

- `pushToEdit(prompt, slideId?)` / `POST /sessions/:id/push-to-edit`: returns a
  receipt, not a promise that a model successfully applied the change.
- `undo()` / `redo()` and their HTTP routes restore whole transactions. Use these
  runtime methods, not low-level `Publisher.restoreHistory()`, in a live session:
  only the runtime coordinates cancellation of actors and transcript decisions.
- `GET /sessions/:id/history` reports depths and availability. SSE includes
  publication/deck history status, `history_changed`, and edit-comment receipts.
- Pause holds work for resume. Undo discards older work, retaining its history and
  speech as evidence. Neither should leak a late publication across its boundary.
- Navigation finalizes the prior audio segment. Clients buffer audio until the
  selected stable ID is returned, then send it with increasing sequence numbers.
- Atomic edits/structures create one undo unit. Navigation/no-op/rejection creates
  none. A fresh edit after undo clears redo; undo does not rewind the transcript.
- Model-call completion, accepted publication, browser paint, and useful visual
  content are distinct milestones. Current HTML screenshot publication is not an
  actual audience viewer acknowledgment.

## Historical integration gaps at 7ca6bde

Remote commit `da3f5d5` and its ancestors added a canonical JSX engine, durable
source/input storage, tools, validation, and a packaged viewer under
`slide-generation/`. No files there were changed by this handoff. Read its
[SPEC](../../SPEC.md), [decision ledger](../DECISIONS.md),
and [host port](../HOST_PORT.md) before implementing an adapter.

The following gaps were identified at that snapshot. The backend injection, tool/context integration, durable input
routing and headless publication/recording have since been implemented; see [current integration](../HOST_PORT.md).
These historical requirements explain the adapter, rather than a current blocker list:

1. **Backend injection.** `SlideRuntime` constructs `Publisher` directly. Inject a
   generation backend; renderer injection alone cannot replace its store/tools.
   JSX should have one canonical commit path. Keep HTML only as a deliberate
   legacy/test mode rather than a parallel authority over the same deck.
2. **Inference context and tools.** Use canonical immutable read/edit contexts,
   the JSX tool registry, and its agent instructions. Translate role permissions
   explicitly. Do not automatically feed HTML screenshots or exact-match tools
   into JSX mode; it has hashline edits and requested screenshots.
3. **Input preservation and targeting.** Deliver stable-ID utterances durably
   before scheduling inference. Retain real per-slide attribution through user
   navigation; fixture aliases must never supply production routing.
4. **Publication and viewer.** Subscribe to canonical committed revisions for
   Slow eligibility and history bookkeeping. Use `GenerationSession` and the
   viewer's authenticated channel/acknowledgment protocol; keep transcript, notes,
   and source out of audience payloads. Frontend wiring belongs to its owner.
5. **History and control barriers.** Map undo/redo to canonical source/definition
   transactions, preserving dependent slides and source evidence. Carry the
   cancellation epoch across commits so old tools cannot undo the user's undo.
   Preserve pause and specialist privacy semantics.
6. **Reconcile policy differences.** Canvas size, screenshot policy, editable
   representation, bounded number animation, note fidelity, credential handling,
   and Fast-tier coverage differ. The JSX decision ledger records newer choices;
   don't accidentally enforce the legacy renderer's restrictions in the adapter.

The adapter was not completed by historical commit `7ca6bde`; it was implemented during the later user-authorized
consolidation. Its acceptance test should exercise real actor scheduling through
JSX tools, audio/input attribution, corrections, pause, push-to-edit, undo/redo,
and viewer acknowledgments. Existing standalone subsystem smokes do not prove
that end-to-end integration.

## Ownership and safe continuation

The user subsequently authorized merging the two packages on 2026-10-31. Current work stays inside the consolidated
`slide-generation/` directory; frontend changes remain excluded. Original root fixtures were moved to `fixtures/legacy/`.
Other untracked presentation-design directories remain unrelated work.
Fetch before publishing, preserve others' commits, stage explicit paths, and
never force-push over another workstream. Recommendations in these docs are not
permission to rewrite another package.
