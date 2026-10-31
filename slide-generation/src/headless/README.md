# Headless audience evidence

`HeadlessViewer.create({ recorder })` launches real Chromium and mounts the packaged viewer in an opaque `allow-scripts` iframe. It requires no product frontend or HTTP server. `send(publication)` validates and records the publication, then posts it without waiting for motion so subsequent publications can retarget it. `setAcknowledgmentHandler` connects actual sender/channel-validated browser acknowledgments to `GenerationSession.acknowledge`. The clock mapping is measured, and acknowledgment timestamps remain distinct from the observer's receipt time.

`settled()` waits for the latest publication's actual terminal acknowledgment and drains every pending frame/recording operation. A refusal, inexact final DOM, browser error or recording failure rejects. `close()` closes the real context to finalize its video. A caller must still close its canonical runtime. Videos, PNG frames, public publication messages and typed acknowledgments remain in the recorder's `viewer/` directory. `writeViewerGallery(recorder, viewer.frames())` after close generates a new static gallery linking those original files without rewriting them.

Frame projections retain native text roles, exact displayed Stat digits with visible labels, and Quote bodies with visible bylines. Hidden builds and offscreen elements are excluded. Each frame stores the actual DOM sample time, capture interval, revision, slide, surface and coherence. If a new publication intervenes, that capture cannot establish visible success. During animation a PNG may differ from the earlier DOM sample; continuous video preserves intermediate digits, exits and motion for review. Exit ghosts are not native semantic nodes in the projection; use the video for obsolete-exit exposure. No evaluator frame is automatically fed to a model.

`HeadlessRecordingSession.create(runtime, recorder, { slideId, mode })` connects the canonical engine, `GenerationSession` and viewer. The caller chooses real slide IDs and supplies input targeting; this wrapper never reads fixture aliases or assertions. Every distinct canonical commit gets exact source and a normalized before/after diff. Edit revisions include actual checks and rendered artifacts. Input-only transcript/notes revisions use `checksJson: { performed: false, reason: 'evidence-only commit' }` and `renders: []`; they do not claim revalidation or compete for Chromium capacity when only private evidence changed. The actual actor scheduler, model/tool recording, input controller, budgets and fixture runner remain the host factory's responsibility.

`auditHeadless({ fixture, run, frames, routes, source, readiness, creationEvidence?, readinessAtMs?, readinessEvidence? })` evaluates only after generation. Alias bindings require independently verified creation evidence; later routes cannot redefine expected targets. Exact native content, ordered text, Stat label/value, Quote/byline, absent tokens, structurally associated corrections and qualifiers receive automated checks. Earlier figures superseded by later explicit corrections retain their own time window and become censored misses if never displayed. Raw exact-once Prompt retention is checked across live slides and archive. Source/readiness success never substitutes for visible success; timed readiness additionally requires an actual timestamp and artifact reference. Unsupported design/semantic assertions and final flags remain explicit manual reviews. Qualification is always false until the required broader review is performed.

`renderMarkdownReport({ fixture, run, observations, audit, model, finalSlides, viewerGalleryPath?, contactSheetPath?, contactSheetUnavailable? })` emits a per-run report with p50/p90/p95/observed maximum, coverage/misses, nullable token/cost evidence, actual served tiers, failed assertions and original final-slide/gallery links. It embeds the complete-deck contact sheet when available and otherwise states the explicit failure. It neither invents unknown usage nor infers a speed improvement from a single run. Synthetic test fixtures/cassettes are labeled as such by their run provenance.

Measurement update after preflight review: evaluator aliases now require `creationEvidence`, built with
`buildCreationEvidence(initial, commits, operations)`. The helper verifies the exact recorded source-hash chain and pairs
an actual create operation with its exact retained Prompt (or the untouched initial singleton seed). Later actual routes
never define or overwrite expected identity; `wrongTargetRoutes` exposes divergence. Original recordings are preserved.

New native-frame samples require full text ranges inside the viewport and ancestor overflow clips, near-full cumulative
opacity, and a basic paint hit test. Partly visible/unreadable words are excluded rather than reported as fully visible.
Correction and absence checks additionally require a settled exact DOM with verified visibility, so visible exit ghosts
cannot create an early automatic pass. This deliberately overestimates some correction/absence latencies. Historical
frames without the new visibility metadata remain manual review; do not add synthetic metadata to old artifacts. The
shared observer/evaluator version must be identical for frozen and candidate comparisons. This is conservative sampling,
not a complete pixel-level occlusion proof; retain video review. The current integrated host still lacks a separate
simultaneous audience/build-reveal surface; editor results do not prove audience acceptance.

## Whole-deck review image

The user explicitly requested later-pass screenshots of the entire deck concatenated into one image. Each new run should
produce `final/deck-contact-sheet.png` after the timed observation and final slide export, outside visible-latency timing.
It combines existing final PNG/JPEG captures without regenerating their slide contents. Canonical direct live-Slide order
determines row-major placement; archived/library slides are excluded. Every tile has a number and stable slide ID. Two
960×540 tiles per row preserve each original 1920×1080 image's aspect ratio; the sheet is 1968px wide.

`writeDeckContactSheet({ source, slides: [{ slideId, path }], outputPath })` requires the exact complete live-slide set.
Missing, duplicate or extra IDs, duplicate source paths, missing/undecodable images, wrong source dimensions, and output
overwrites refuse. Identical image bytes in distinct slide files are allowed, since different blank slides are legitimate
evidence. Sheets above 32760px height fail explicitly rather than truncate; the supplied 34-slide talk fits. The successful
result records source/image hashes, order, dimensions and coordinates. `complete:true` describes capture-set completeness,
not faithful content, readiness or successful generation. A refused composition has no supposedly complete PNG.

The runner writes `final/contact-sheet-status.json` and includes either the image or unavailable reason in the report.
Report recovery preserves originals and does not regenerate/certify a sheet. For an existing run, create a new standalone
artifact directory outside the original evidence directory:

```sh
npm run headless:contact-sheet -- --run EXISTING_EVIDENCE_DIR --out .artifacts/review/NEW_CONTACT_SHEET_DIR
```

This offline command makes no model calls. Use the actual nested run directory from `run-location.json` for frozen runs.
It writes `deck-contact-sheet.png` and `contact-sheet-status.json`; failure remains explicit and returns a failing exit
status. The image is for final deck review; retain the live PNG/video timeline for latency, motion, obsolete content and
audience-build behavior.

The [round 03 complete two-slide sheet](../../.artifacts/review/round03-deck-contact-sheet/deck-contact-sheet.png) was
generated from immutable final JPEGs in a separate directory. Its [review](../../docs/rounds/headless-round-03/README.md)
records actual live statistics and important fidelity failures; the contact sheet does not upgrade that failed trial.
