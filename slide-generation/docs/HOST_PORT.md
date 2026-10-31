# Canonical host integration

The user approved consolidating orchestration and slide generation into one package on 2026-10-31. The earlier O02
blocker—no injection point in the separate HTML runtime—is superseded by the implemented backend boundary. The actual
actor scheduler now accepts the canonical JSX backend. Deterministic integration tests exercise real actor/tool loops,
durable canonical edits, control boundaries and requested screenshots; headless tests exercise the real packaged viewer.
This is implementation evidence, not a completed five-talk live-model qualification.

## Implemented path

1. `src/orchestration/backend.ts` defines `GenerationBackend` and `GenerationPolicy`. `SlideRuntime` accepts an injected
   backend; omitting it retains the explicit legacy HTML mode. One selected backend owns a deck's mutations.
2. `src/host/jsx-backend.ts` adapts the canonical engine and unified tool registry. Actor contexts capture immutable
   revision/control epochs, real selected/working slide IDs and source notes. The JSX agent instructions replace legacy
   HTML editing policy. Only an explicit `screenshot` call adds images to model context.
3. `src/headless/evaluation-host.ts` exports `createEvaluationHost`. It constructs the real scheduler, canonical backend,
   recorded provider adapters and `HeadlessRecordingSession`. Inputs are durably retained before queued routing and
   inference. Exact utterances also enter canonical Prompt evidence with stable IDs and actual slide attribution.
4. The input controller recognizes explicit new/create-slide and return/go-back commands in the spoken input. It uses
   real titles/identities, never fixture aliases or assertions. This harness behavior follows the user's authorization;
   it does not grant model tools authority to move the user's selection.
5. `GenerationSession` subscribes to accepted canonical revisions and sends private-editor or readiness-gated audience
   render artifacts. `HeadlessViewer` mounts the packaged opaque iframe, validates sender/channel/payload, measures the
   browser clock mapping, and records actual applied/painted/settled acknowledgments, frames and video.
6. `scripts/headless-run.ts` uses the absolute paced driver, preserves final silence and bounded drain, then exports
   canonical source, readiness, final slide JPEGs, recorded provider/tool evidence, audits and review links.

The host preserves existing actor lifecycle and Decision gates; it does not create an imitation scheduler. Pause and
history epochs invalidate stale tools. Fast is scoped to its actual working slide; Slow handles broader edits.
Canonical undo/redo retains source evidence and runs through checked commits. Specialist asset integration remains
provisional rather than silently reusing a legacy HTML asset contract.

## Evidence and limits

`test/orchestration/backend.test.ts` checks the injected scheduling boundary. `test/jsx-backend.integration.test.ts`
exercises the canonical adapter with real browser validation. `test/headless-viewer.test.ts` verifies actual iframe
transport, editor/audience captures, retargeting, refusal and state evidence. `test/headless-models.test.ts` verifies
provider bodies, Fast requests, budget accounting and recorded replay without paid requests. `test/headless-audit.test.ts`
contains negative controls for wrong labels, offscreen/Pending/incoherent frames, correction windows and raw retention.

Durable receipt, canonical commit, publication, browser paint, sampled correct content and animation settlement are
separate milestones. Final offscreen JPEGs and final readiness cannot manufacture earlier visible success. Input-only
metadata commits record exact source with checks explicitly marked unperformed; they do not repeat browser checks for
unchanged public artifacts. Edit commits retain actual check/render evidence. Unsupported design and semantic audits
remain manual-review misses. Intermediate counting frames stay recorded under settled decision D56.

No product frontend is required for headless measurement. A future frontend must use `mountViewer` with its opaque
sandbox/channel checks, forward actual acknowledgments and resynchronize after reconnect. Notes, transcript and source
JSX stay private; audience payloads contain only render artifacts. Application mode/practice/feedback policies remain
separate product work.

## Credentials and provider policy

```sh
set -a
source ./.env
set +a
npm run headless:run -- --fixture fixtures/talks/edit-heavy.json --out .artifacts/runs/edit-heavy-baseline-1
```

All application credentials come from environment variables; no code parses `.env`. Responses requests explicitly use
Fast service tier. Decisions does not expose that field in its API schema, so it records `endpoint-default` rather than
sending an unsupported parameter. Requested and returned tiers, exact bodies, errors and usage are separate evidence.
A missing returned tier or usage is not inferred as a successful Fast request or zero consumption.

The consolidated live pilot, five-talk repetitions, frozen functioning baseline comparison and separately verified
refactoring passes remain required. Historical standalone subsystem smokes and legacy HTML fixtures keep their original
provenance; neither is relabeled as a completed integrated measurement.
