> Current stable status and pinned teammate contracts: [integration-readiness.md](integration-readiness.md). Earlier details/counts below describe the original baseline.

# Frontend integration boundaries

**All external service contracts remain UNCONFIRMED.** The local app works through reference adapters. Nothing here establishes backend endpoints or teammate guarantees.

`WorkspaceRepositoryPort` owns load/save and original source blobs. `SpeechSessionPort` owns start/stop/pause/resume/mute/disposal. `FrontendAdapters.interpret` is a deterministic local reference reducer; `configureFrontendAdapters` can replace speech and interpretation at startup once agreed service contracts are translated to these UI responsibilities. An asynchronous generation service will need a job-state adapter, not an HTTP request concealed in this synchronous reducer.

The UI uses stable slide IDs, immutable command/review snapshots and explicit selection. Service responses should be validated before they become domain state. Reject stale project/session/version results; route changes must cancel old input. Keep transcript provisional/final states distinct. Do not claim remote success until acknowledged by its owner.

| Unconfirmed area | Decisions needed with teammate owners |
| --- | --- |
| API/auth | Transport, authentication, refresh/expiry and permissions. |
| Project/materials | Storage authority, uploads, parsing lifecycle, original downloads, limits and retention. |
| Speech | Capture/transcription ownership, interim/final utterance IDs, timestamps, audio handling and target attribution. |
| Jobs | Generate/edit states, progress, cancellation acknowledgement, retries and idempotency. |
| Slides | Shared schema, layouts, IDs, versions, provenance and renderer responsibilities. |
| Patches/order | Base versions, sequence, atomic patches, replay, reorder and conflicts. |
| Audience | Device scope, transport, snapshot/reconnect, private-field filtering and ended/black state. |
| Practice | Session/snapshot authority, metrics provenance, proposal dependencies, approve/reject and exactly-once application. |
| Failures | Error taxonomy, retryability, offline behavior, reconnect/resume and lost-event recovery. |
| Environments | Hosting ownership, URLs when agreed, public env values, secret handling, HTTPS and CORS. |
| Handoff | Named owners, accepted examples, integration fixtures and change management. |

Keep normal startup empty. Tests inject fixtures and recognizer events from Playwright into their isolated browser; no demo launcher, mock generation control, sample transcript or seeded user deck exists in normal runtime.
