# Viewer implementation checkpoint

Stopped at the user's requested permission-environment restart, before integration or browser verification. No viewer
changes were committed by this agent. Files below are partial implementation, not P8 completion.

## Files written

- `src/viewer/protocol.ts`: strict Zod publish/build/ack schemas, default motion settings, same-revision readiness gate,
  build group helpers, fixed 1920x1080 fit calculation.
- `src/viewer/document.ts`: backend iframe document builder, unpredictable channel and nonce validation, owned static
  script embedding, nonce CSP with network denied, fixed canvas/stage/exit layers.
- `src/viewer/bridge.ts`: parent mount/send/dispose bridge; sandbox is exactly `allow-scripts`; incoming acknowledgments
  require source iframe window, opaque `null` origin, channel, protocol version and schema. Outbound messages use `*`
  because the sandbox origin is opaque.
- `src/viewer/client.js`: owned raw script embedded verbatim (avoids unreliable TypeScript function-toString embedding).
  Contains runtime payload validation, inactive-fragment checks, monotonic sequences, presentation readiness checks,
  asset/font wait, reserve-space builds/ancestor gates, paint/settlement acknowledgments, snapshots and an initial
  retargetable FLIP/spring/color/opacity/Stat/exit/crossfade implementation. This script has not been browser-tested.

## Protocol and integration choices

Publish includes channel/version/sequence/publicationId/revision/slideId, HTML/CSS, editor-or-presentation mode,
`readiness: {revision, ready}`, motion duration/stiffness/damping, build group and explicit hold IDs. A presentation
publication refuses unless readiness is true for the same revision. This is a trusted-host proof, not cryptographic
validation; root engine must run whole-deck readiness. Build messages target a specific revision. Acks distinguish
applied, painted (two animation-frame opportunities), and settled with final-DOM equivalence. Paint opportunity is
instrumentation, not independently verified actual visibility; video validation remains required.

Renderer agent agreed: `data-node`/`data-build` on roots, `data-content`/`data-role` for native text, Stat value has
`data-stat-value` with exact source text, shapes/surfaces have metadata. Renderer HTML is one fixed-canvas fragment.
No frontend/orchestration files were changed.

## Exact checks run

`npm run check` passed after these files were written. This checks TypeScript files only; it does not parse/execute the
raw client.js runtime. No viewer unit tests, browser tests, screenshots or videos exist yet. No `npm test` was run by
this viewer agent. Chromium was previously reported by root to fail with sandbox_host_linux.cc Operation not permitted.
Do not advertise viewer capability yet.

## Known incomplete or suspect paths to fix next

1. Add focused static protocol/build/fit tests and actual browser tests (malformed/cross-session messages, builds,
   interruption at multiple progress points, reparenting, slide changes, numeric bounds, font/image failures, exact final
   DOM, no duplicate exit nodes). Run browser with corrected environment permissions; record actual evidence.
2. Audit runtime motion geometry: nested parent/child transforms and authored zoom/translate require measured correction.
   Current approximate FLIP compensation is unverified. Spring retarget retains velocity, but numeric retarget and
   resizing/color continuity need actual interruption tests.
3. Exit clones currently call freezeElement on old elements after detaching them, so computed styles may be lost.
   Freeze needed exit snapshots before replacement. Tighten the compound topmost-exit condition for clarity/correctness.
4. Build commands arriving during animation update `current`, but closures in finish/applyBuild still use the older
   publication object; avoid resetting a newer build selection on settlement.
5. Rapid publications while assets are pending need a robust last-visible snapshot and rollback path. Currently the
   preparing branch can retain detached previous state; verify failure restores the last actually visible revision.
6. Resource waiting creates a timeout Promise without clearing the timer after success; clean up and test timeouts.
7. Runtime and Zod payload validators are separate and need equivalence tests; generated derived IDs may exceed the
   current 256-character protocol identity limit in pathological nested expansions. Coordinate a consistent bound.
8. `ViewerBridge.send` uses Omit on a union, which may not expose discriminant-specific fields ergonomically; use a
   distributive type or explicit Publish/Build input union before consumers integrate.
9. Final DOM equivalence and hold-style restoration are unverified. Restore all original style attributes exactly;
   neither exit snapshots nor transient opacity should remain after settlement.
10. Add explicit publication supersession/error telemetry and verify no ack can falsely count a hidden/loading state as
    first-correct-visible. Present `visibleNodeIds` as geometry/visibility evidence, not semantic correctness.

## Open decision O01

Approved bounded numeric Stat counting remains in this initial runtime. Its intermediate digits can differ from both
old and requested target claims. This remains the existing unresolved fidelity/product question; no exception or
policy choice was made. A focused live demo and recorded frames must be built before asking the user to choose whether
tweened digits count as invented claims or should be replaced by exact target digits plus nonnumeric motion. No demo,
recorded numeric evidence, or numeric-faithfulness claim exists yet.

## Resume outcome (2026-10-31, full-access environment)

The initial defects above were addressed and the viewer now has a real Chromium regression suite in
`test/viewer.test.ts`. Twelve tests pass, including renderer font compatibility, build commands during motion,
resource supersession/rollback, nested zoom/translate and reparenting at early/mid/late progress, exact final DOM,
opaque-origin/CSP checks and numeric precision/bounds. Controlled resource-wait tests delay the genuine browser
font-ready promise; they do not substitute passing browser measurements.

Actual screenshot review identified an additional duplicate-content bug: an exiting parent snapshot retained its
reparented child. The runtime now strips retained descendants from exit clones, and the suite asserts visible words
are not duplicated. Corrected sample: `.artifacts/viewer-runs/motion-EshZxa/retarget-140.png` (with video and samples).

Root obtained decision D56 resolving O01: bounded intermediate digits count as animation, not factual claims.
The original `.artifacts/viewer-o01/` evidence remains frozen; all subsequent runs use unique artifact directories.
See `src/viewer/README.md` for the final protocol and remaining host/qualification boundary. No viewer commit was made
by the subagent; root owns integration and focused commits.
