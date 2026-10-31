# Headless audience evidence

`HeadlessViewer.create({ recorder })` launches real Chromium and mounts the packaged viewer in an opaque `allow-scripts` iframe. It requires no product frontend or HTTP server. `send(publication)` validates and records the publication, then posts it without waiting for motion so subsequent publications can retarget it. `setAcknowledgmentHandler` connects actual sender/channel-validated browser acknowledgments to `GenerationSession.acknowledge`. The clock mapping is measured, and acknowledgment timestamps remain distinct from the observer's receipt time.

`settled()` waits for the latest publication's actual terminal acknowledgment and drains every pending frame/recording operation. A refusal, inexact final DOM, browser error or recording failure rejects. `close()` closes the real context to finalize its video. A caller must still close its canonical runtime. Videos, PNG frames, public publication messages and typed acknowledgments remain in the recorder's `viewer/` directory. `writeViewerGallery(recorder, viewer.frames())` after close generates a new static gallery linking those original files without rewriting them.

Frame projections retain native text roles, exact displayed Stat digits with visible labels, and Quote bodies with visible bylines. Hidden builds and offscreen elements are excluded. Each frame stores the actual DOM sample time, capture interval, revision, slide, surface and coherence. If a new publication intervenes, that capture cannot establish visible success. During animation a PNG may differ from the earlier DOM sample; continuous video preserves intermediate digits, exits and motion for review. Exit ghosts are not native semantic nodes in the projection; use the video for obsolete-exit exposure. No evaluator frame is automatically fed to a model.

`HeadlessRecordingSession.create(runtime, recorder, { slideId, mode })` connects the canonical engine, `GenerationSession` and viewer. The caller chooses real slide IDs and supplies input targeting; this wrapper never reads fixture aliases or assertions. Every distinct canonical commit gets exact source and a normalized before/after diff. Edit revisions include actual checks and rendered artifacts. Input-only transcript/notes revisions use `checksJson: { performed: false, reason: 'evidence-only commit' }` and `renders: []`; they do not claim revalidation or compete for Chromium capacity when only private evidence changed. The actual actor scheduler, model/tool recording, input controller, budgets and fixture runner remain the host factory's responsibility.

`auditHeadless({ fixture, run, frames, routes, source, readiness, readinessAtMs?, readinessEvidence? })` evaluates only after generation. It derives alias bindings from the recorded trigger-utterance route; conflicting real targets remain ambiguous. Exact native content, ordered text, Stat label/value, Quote/byline, absent tokens, structurally associated corrections and qualifiers receive automated checks. Earlier figures superseded by later explicit corrections retain their own time window and become censored misses if never displayed. Raw exact-once Prompt retention is checked across live slides and archive. Source/readiness success never substitutes for visible success; timed readiness additionally requires an actual timestamp and artifact reference. Unsupported design/semantic assertions and final flags remain explicit manual reviews. Qualification is always false until the required broader review is performed.

`renderMarkdownReport({ fixture, run, observations, audit, model, finalSlides, viewerGalleryPath? })` emits a per-run report with p50/p90/p95/observed maximum, coverage/misses, nullable token/cost evidence, actual served tiers, failed assertions and original final-slide/gallery links. It neither invents unknown usage nor infers a speed improvement from a single run. Synthetic test fixtures/cassettes are labeled as such by their run provenance.

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
