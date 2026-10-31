> Current stable status and pinned teammate contracts: [integration-readiness.md](integration-readiness.md). Earlier details/counts below describe the original baseline.

# Main UI reconstruction validation

Date: 2026-10-31. This report describes this frontend, not the earlier reconstruction experiments.

## Reference and scope

Read the complete main prompt, including its detailed behavior inventories, final rules, renderer CSS and calibration corrections. `reference/talkdeck-main-rebuild-prompt.md` remains byte-identical to the supplied primary prompt: SHA-256 `9ec1a556f39a89cf1a1660990493ba00ed050df2ac515e8ff4df8752f5f53d06`.

All tracked changes are within `frontend/`. No backend, agent, platform or root repository files changed. No existing main/warm website or original application was accessed or modified. Folio styling is not used.

## Checks performed

- TypeScript check and Vite production build passed.
- **34 unit tests** passed across commands, source parsing, table editing, practice decision guards, speech lifecycle, repository failures and audience privacy/validation.
- **11 Chromium scenarios** passed against the development server and the built production preview. Each scenario includes multiple assertions; these are scenario counts, not inflated per-assertion totals. No uncaught page errors were observed in the final runs.
- npm audit: zero reported vulnerabilities with the committed dependency lockfile and patched transitive image-size override.
- Local dev server HTTP 200 at `http://127.0.0.1:8873/`.
- PPTX/PDF browser downloads completed. Inspected PPTX ZIP slide XML for slide count and actual imported Customers values; verified PDF signature. Native desktop PowerPoint opening/layout fidelity was not tested.

Browser scenarios cover fresh empty state; creation/persistence; source upload/copied text/original download/escaped content; nested folder entry; rapid Cut→Paste without waits; stable/fresh IDs, reorder/delete/undo/context menus; speech interim/final deduplication, agent edits, Finish and stale callbacks; audience synchronization/private-field filtering; practice snapshot/review approval/completion; theme changes; drawing shortcuts/strokes; presenter/fullscreen; missing route recovery; save failure retaining working state and successful retry; manual practice navigation cancelling a prior recognizer before attributing new speech.

Unit checks additionally cover rejected/repeated/stale proposals, split/reorder guards, cross-project clipboard linkage, quoted/multiline CSV, invalid structured tables, malformed persisted projects, malformed audience payloads, presenter edits and public table-page filtering.

## Visual review and corrections

Applied UI UX Pro Max and AI unslop to the approved main design. Generic skill palette/landing-page suggestions were inappropriate and were not adopted. Rendered inspection preserved the main tokens, compact header, slide hierarchy, dark empty surface, optional sidebar, filmstrip, voice capsule, contextual drawing and review colors.

Fixed a real grid sizing bug that placed the After comparison outside the viewport; comparisons now use bounded grid columns and local slide sizing. Corrected Draw to the specified 52×56 launcher at stage left-middle, separated its activation/options controls, and matched the review borders, buttons and decision badge dimensions/colors. Corrected stale upload callbacks, imported-table edit rendering, outside-field slide clipboard shortcuts, provisional-speech preservation, and late-final attribution across manual navigation.

At 1280×720, the empty slide height is checked against 556 CSS px and its 16:9 ratio is verified. Overflow checks cover 1512, 1280, 919, 786 and 390 widths. Review comparisons are separately checked at 1512, 786 and 390. These checks do not establish universal pixel identity.

Thirty PNG screenshots in `evidence/` cover dashboard, setup, empty canvas, slides, Context, palette, Talk, agent target, presenter, audience, practice overview, visual diff and completion. Main states are captured at 1512×900 and 786×853, with extra empty/diff narrow sizes. Fixtures are injected only into isolated test browsers; normal runtime starts empty.

## Remaining limits and deliberate integration boundaries

- This is a functioning local frontend reference. Backend/auth/cloud storage, remote transcription, AI generation, network jobs/cancellation and cross-device audience sync await agreed teammate contracts. Local rules must never be represented as connected AI.
- Actual microphones, real vendor recognition, OS permission prompts and physical waveform energy were not exercised. Speech tests use injected recognizer events. Platform/browser shortcuts, screen readers, touch/high-DPR combinations and exhaustive contrast remain unverified.
- Canvas content editing currently uses a dialog, not complete inline rich-element editing. Dragging has insertion feedback and edge scrolling; exhaustive pointer/device combinations were not tested.
- The drawing tools capture normalized per-slide session strokes and erase whole objects. Semantic interpretation of a marked region is not connected to local generation; drawings are excluded from audience/export as specified. Drawings are transient across reload.
- Local practice proposals are conservative shortening/exact-transcript/splitting rules. Typed field/split/reorder proposal decisions and stale checks are supported; there is no general semantic agent producing the full range of sample learning-outcome, process or reorder proposals. No acoustic tone score is invented.
- Unfinished recognition is retained as a provisional transcript phrase on pause/Finish/navigation/session end. It is not silently treated as a finalized edit command. Browser pagehide persistence is best effort; closing a browser cannot guarantee pending asynchronous transactions finish.
- Source originals are preserved in IndexedDB. Large sources are bounded in preview, tables render eight rows per page with next/previous table-page voice commands, and unsupported formats remain downloadable references. Very wide tables, unlimited content fitting and complete orphan-blob cleanup are not certified.
- Audience transport is same-origin and can retain a last cached slide if the presenter crashes. It is not an authenticated network collaboration protocol.
- PPTX exports use editable text/tables and notes; they do not preserve every custom browser layout identically. PDF exports are rasterized. Private materials/transcripts and drawings are excluded.

The original design and principal interaction paths are reconstructed and checked. This is not a claim that every prompt edge case is complete, every state is pixel-identical, or the frontend is production-certified. Remaining gaps are explicit work for subsequent iterations.
