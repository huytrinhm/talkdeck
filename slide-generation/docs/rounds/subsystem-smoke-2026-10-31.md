# Direct subsystem live smoke — 2026-10-31

Status: passed one bounded live run. This is **not** integration with the existing actor host, five-talk qualification, or comparison against a frozen baseline.

Run: `.artifacts/runs/subsystem-smoke/2026-10-31T05-30-39-777Z/`. The manifest records the actual Git commit, dirty working-tree status, prompt/lock/input hashes, and source snapshot. The default configured fast model was `gpt-6-luna`; no model was substituted.

The single trusted input asked for the title “Revenue update” and the exact sentence “Revenue grew 42% compared with Q3 last year.” It prohibited other visible text. Input was durably ingested before inference. Six real Responses requests read source, read notes, reread source, submitted one hashline edit, checked presentation readiness, and returned confirmation. The edit passed real Chromium validation and committed. The original utterance remained exact in raw input and notes.

The actual packaged sandbox viewer applied three publications: seed editor, committed editor, and final presentation. Its final visible text was exactly the two requested strings, readiness was true, and the settled DOM was equivalent to the committed render. A human-visible final JPEG was inspected for exact words, clipping and overlap. Viewer acknowledgment events, publication JPEGs and a WebM video were retained. The model did not request a screenshot; evaluator captures were not fed to it.

Actual provider usage: **55,531 input tokens and 250 output tokens**, six requests of the eight-request maximum. Each request capped output at 8,000 tokens. Dollar cost is unreported because no pinned price table was provided. The transport never retries automatically. No second paid run was made.

Exact model request/response strings, tool arguments/results, source snapshots, render dependencies, response and transaction replay cassettes are retained with provenance `recorded-model`. The transaction cassette records immutable raw input, both pre-edit source reads and every line/hash, the literal accepted edit and resulting source hash. The full tool log also preserves the normalized source returned by the commit.

Offline transaction replay passed using the actual recorded cassette and real Chromium checks. It reproduced the accepted edit and exact final source digest `8ade4f5316ca3926c0a199bdf5622ac3408b75741cf119b081586b7a9a7974fc`, with readiness true and no findings/Pending. Evidence: `.artifacts/recorded-model-offline-replay-20261031/audit.json`. Node network entry points were disabled, browser page requests were aborted, and zero network attempts were observed. This is an application-level guard, not an OS network namespace. Actor-host replay remains dependent on the real host connection.

Recording limitation: the initial script labeled all viewer acknowledgments as editor observations, including final presentation. The actual publication messages correctly record presentation mode. `evidence-notes.md` preserves this correction without rewriting historical observations. The script now derives the surface from the issued publication. Measured clock uncertainty was approximately 0.72 ms. No latency qualification is claimed from this simple smoke.

Verification: `npm run check` and three offline model transport tests pass. The script also typechecks when included with the APCA declaration. The client tests enforce the request/token budget, exact model/body preservation, no automatic retry, and redaction of authentication response bodies that might echo credential fragments. Credentials are received only from shell-sourced environment and are never serialized.
