# Developer handoff: Talkdeck orchestration

Snapshot: 2026-10-31. This package implements the actor scheduler and the original
HTML publication path. The neighboring JSX generation subsystem exists but is
**not connected to these actors yet**. Frontend integration remains out of scope.

## Read in this order

1. [Product idea](PRODUCT-IDEA.md): users, workflow, and unimplemented intentions.
2. [Design decisions](DESIGN-DECISIONS.md): rationale, superseded rules, and limits.
3. [Deck contract](../DECK-CONTRACT.md): navigation, publication, pause, history.
4. [README](../README.md): setup, HTTP APIs, events, and fixture commands.
5. [Verification](../VERIFICATION.md): automated versus historical live evidence.
6. [JSX host port](../../slide-generation/docs/HOST_PORT.md): the other workstream's
   concrete integration requirements. Its line numbers refer to an older snapshot;
   use symbols, not those line numbers, to locate the current code.

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
| JSX generation integration | Missing; see below |
| Feedback / practice / present policy | Missing; do not equate pause with practice |
| Notes / rewind / pointer / prediction | Not integrated into this orchestration runtime |

## Code map

| File | Responsibility |
| --- | --- |
| `src/runtime.ts` | `SlideRuntime`, actors, boundaries, navigation, push-to-edit, undo/redo cancellation |
| `src/gate.ts` | Fixed speech clock, immutable decisions, correction handling, replay suppression |
| `src/openai.ts` / `src/config.ts` | SDK adapters, model prompts/settings, credentials |
| `src/publisher.ts` | Original HTML deck store, branch merge, transactional publication, history stacks |
| `src/renderer.ts` / `src/assets.ts` | Chromium validation/rendering and immutable assets |
| `src/history.ts` | Persistent conversation/tool history and two-image observation projection |
| `src/tools.ts` | Role-specific schemas and tool definitions |
| `src/abortable.ts` | Stop awaiting cancelled provider work; late outcomes remain handled |
| `src/transcription.ts` | Audio transport, transcript accumulation, WAV parsing |
| `src/server.ts` | Local HTTP/SSE, mutation ordering, audio segmentation |
| `interfaces.ts` | Public TypeScript exports |

## Run and verify

From `orchestration/`:

```sh
npm ci
npx playwright install chromium
npm run check
npm test
npm start
```

The current suite has 75 tests. It uses deterministic models and real local
Chromium/HTTP/WebSocket checks, not paid model calls. The server listens on
`127.0.0.1:8787` by default. Credentials may come from the environment or the root
`.env` in this legacy package; never commit `.env`. New JSX subsystem runners use
its documented environment-only policy. Keep run logs and `node_modules` ignored.

For a paid integration run, after supplying credentials:

```sh
npx tsx src/fixture-deck.ts
npx tsx src/audit-deck.ts runs/<deck-run>
```

The root `test-fixture-5-slides.txt`, `.wav`, and `.json` are a matched synthetic
fixture: five fictional library-pilot slides, same-slide and cross-slide numeric
corrections, and explicit navigation timing. Metadata stores hashes and exact
sample boundaries. Do not regenerate audio just to run tests. The original
single-slide fixture remains unchanged. `src/generate-five-slide-fixture.ts` is
an explicit paid regeneration command and writes those root fixture files.

`runs/` is ignored. Historical paths and measurements in VERIFICATION.md describe
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

## Integration with slide-generation

Remote commit `da3f5d5` and its ancestors added a canonical JSX engine, durable
source/input storage, tools, validation, and a packaged viewer under
`slide-generation/`. No files there were changed by this handoff. Read its
[SPEC](../../slide-generation/SPEC.md), [decision ledger](../../slide-generation/docs/DECISIONS.md),
and [host port](../../slide-generation/docs/HOST_PORT.md) before implementing an adapter.

Concrete missing seams:

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

An adapter is the next cross-package engineering milestone, not work completed by
this commit. Its acceptance test should exercise real actor scheduling through
JSX tools, audio/input attribution, corrections, pause, push-to-edit, undo/redo,
and viewer acknowledgments. Existing standalone subsystem smokes do not prove
that end-to-end integration.

## Ownership and safe continuation

The user explicitly asked not to touch other developers' work and requested no
frontend changes. Keep orchestration changes here; coordinate contracts before
editing `slide-generation/` or frontend. Root fixture files are our explicit test
artifacts. Other untracked presentation-design directories are unrelated work.
Fetch before publishing, preserve others' commits, stage explicit paths, and
never force-push over another workstream. Recommendations in these docs are not
permission to rewrite another package.
