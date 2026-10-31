# Packaged slide viewer

`createViewerDocument(channel)` creates the backend-owned `srcdoc`. Mount it using `mountViewer(iframe, channel,
srcdoc, onAcknowledgment)`, which sets exactly `sandbox="allow-scripts"` and validates messages from that iframe's
opaque origin. Generate an unpredictable channel per mount. Wait for the `ready` acknowledgment before sending.
`bridge.send(...)` supplies protocol version/channel and validates the payload; `dispose()` disconnects it.

A publication contains sequence/publicationId/revision/slideId, renderer HTML/CSS, editor or presentation mode,
`readiness: {revision, ready}`, motion settings, build group, and explicit hold IDs. Presentation requires a true
whole-deck readiness result tied to the same revision. The host must obtain that result from the transaction engine;
the iframe does not independently run layout validation. HTML and CSS have separate 16 MB transport limits to allow
embedded font/asset bytes. Derived identity strings have a 4096-character transport limit.

The canvas remains 1920x1080 and scales to fit. Hidden build groups retain geometry; ancestors gate descendants.
New publications retarget motion from the observed state/velocity. Movement uses a spring; width, height, opacity,
colors and numeric values use bounded interpolation. Additions/exits and slide-key changes fade. Reparented descendants
are removed from old-parent exit snapshots, preventing duplicated visible words. At settlement original inline styles
and exact target Stat strings are restored, exit snapshots are removed, and DOM equivalence is reported. Reduced motion
remains deferred as specified.

Acknowledgments distinguish applied, painted, settled and refused, with browser monotonic time and timeOrigin. Painted
means a double-animation-frame opportunity after application; video validation remains necessary. `visibleNodeIds`
reports visible native-content owners, excluding Pending and off-canvas/hidden content. It is not a semantic correctness
score. A resource failure restores the last visible revision. A superseded preparation emits refusal and cannot produce
a painted acknowledgment for that stale target.

Under decision D56, bounded intermediate Stat digits are animation rather than factual claims. The exact requested
target remains the visible-correct latency criterion. Numeric unit changes and nonnumeric strings crossfade as text;
interpolation never invents new model-authored numbers. Original O01 example artifacts remain untouched at
`.artifacts/viewer-o01/`. Subsequent test recordings use unique `.artifacts/viewer-runs/` directories.

Verification: `node --import tsx --test test/viewer.test.ts` runs real Chromium. Twelve tests cover isolation and CSP,
readiness rejection, fixed canvas/build geometry, motion interruption/reparenting at several progress points, bundled
renderer fonts, asset/font failure, delayed resource supersession, Stat formatting/bounds, and final DOM equivalence.
Motion and numeric tests record videos/screenshots and sampled states. These controlled viewer tests are not live-model
or timed-talk qualification. Host/front-end wiring and complete model evaluation remain separate milestones.
