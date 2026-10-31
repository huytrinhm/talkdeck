# Recorded delegation replay: proposed bounded extension

Status: design only. No replay implementation changes, browser runs, or paid calls were made for this review. The upcoming live pass can provide useful measured evidence while these replay limits remain explicit. Passing transaction replay does not establish actor replay coverage.

## Existing boundary

`src/headless/actor-replay.ts` currently refuses every `request_deck_edit` lifecycle result before executing replay. Its supported path uses the real `SlideRuntime`, gates and SDK adapters, exact literal provider request bodies, verified source/tool-handle projection, authoritative commit ordering, and recorded provider/tool completion order. Keep those invariants and the offline transport with no live fallback.

The available completed corpus contains one accepted delegation in round-03, but it used the older `sourceQuote` interface. Round-02's quoted concatenation was refused. There is not yet a completed successful real-model `utteranceId` delegation trace in the reviewed corpus. The new interface must first be covered by synthetic actual-scheduler recordings and then by a compatible new real recording; old requests must not be rewritten to make them compatible.

## Identity and scheduling changes

The runtime generates a random ID before `followupTask` wakes Slow. That ID appears in the Slow task, the Fast tool receipt and subsequent model history. Replacing IDs after request serialization, ignoring arbitrary context fields, or replaying a replacement task outside the actual scheduler would weaken the contract.

Add a narrow optional deck-request identity factory to the runtime. Its default remains `randomUUID`. Invoke it only after the existing canonical-Fast, working-slide, retained utterance, current inference revision and correction checks pass, and only for a new request after deduplication. Supply the verified provenance: scope, utterance ID, full original text, slide ID and speech revision. During replay, require all of it to equal the uniquely associated `deck_edit_requested` event and return that event's exact recorded ID. Reject missing, reused, conflicting or extra identities. Duplicates reuse the original result through the runtime's actual deduplication map and do not consume another identity.

Lifecycle execution also needs a narrow replay barrier. Today the replay driver barriers `generation.invoke`, while lifecycle tools execute immediately in the runtime. Provide an optional wrapper around the real `request_deck_edit` execution, with a direct-execution default. Associate the call using its recorded agent and provider-supplied call ID, verify its exact parsed arguments, execute the real handler at recorded `tool_result.startedAtMs`, and hold its result from Fast until recorded `finishedAtMs`. This must not replace `workTool`, `followupTask`, or the actor scheduler. Generate the verified ID before the actual Slow wake. Capture and compare actual delegation events and lifecycle results, and require every expected call/identity to be consumed.

The existing scheduler evidence supplies the needed call arguments, call ID, start/end times and receipt. Join the accepted receipt ID to the unique `deck_edit_requested` event. No general model-response rewriting or new permissive cassette format is needed. Continue rejecting other unsupported lifecycle/task tools.

The round-03 recording demonstrates why the two boundaries differ:

| Recorded event | Monotonic time (ms) |
|---|---:|
| Fast delegation tool started | 55644.237 |
| Slow running | 55646.102 |
| Slow inference event | 55648.278 |
| `deck_edit_requested` event | 55648.872 |
| Fast delegation tool finished | 55648.943 |
| Fast delegation tool result logged | 55648.948 |

Evidence: `.artifacts/runs/headless-round-03/candidate/edit-heavy/1/execution/slide-generation/.artifacts/run/scheduler.jsonl`. The actual `followupTask` wakes Slow before the delegation audit event and before Fast receives its result. Using the audit event as a synthetic wake time would reproduce the wrong ordering. Its ID must already be available when the real tool executes.

## Separate full-talk blocker: navigation

Every completed edit-heavy trace reviewed contains two `navigate` operations. Actor replay currently rejects them independently of delegation. Supporting delegation alone therefore does not qualify those full talks.

Navigation operations currently record target and source revision but lack their own timestamp. A separate bounded extension should uniquely correlate each operation, in order, with the matching actual `slide_selected` scheduler event, verify its unchanged canonical source revision, and invoke `actors.selectSlide` at that event boundary. Reject missing, ambiguous or inconsistent correlations. Do not guess timing from a later input or silently navigate only the backend. User pause/history, specialists, explicit images, duplicate/coalesced gate receipts and provider transport failures remain unsupported unless separately qualified.

## Required verification after the timed pass

1. Record and replay the actual scheduler with a synthetic provider: Fast delegates an ID-selected whole utterance, Slow wakes without Fast publication or a refinement decision, reads canonical source and commits through mandatory Chromium validation. Match every provider body literally, every lifecycle result, exact delegation provenance, commit order and final source.
2. Include two same-inference duplicate requests: one task/identity and duplicate receipts. Cover Slow already running when the request queues, and interleave another durable input or a generation tool between delegation start and Fast result release. Verify the scheduler state visible to both actors at each provider boundary.
3. Retain existing authority negative controls for missing/wrong-slide/future/corrected-away input IDs and model-supplied quote/task overrides. For replay, tamper the recorded task ID, scope, original full quote, utterance ID, slide ID, revision, lifecycle arguments/result, provider context and event order. Each must refuse; missing/extra cassette entries must refuse too.
4. Test the separate navigation extension with input on both sides of selection, pending Fast work, wrong targets/source revisions, missing/ambiguous selection events, and exact resulting contexts. Do not widen support to history or pause incidentally.
5. Run the compatible completed new real-model recording offline against its frozen implementation/prompt/tool/dependency contract. Save its report and explicit coverage flags, or its mismatch evidence. Then rerun the prior supported synthetic/pilot cases where contracts still match. Replay is functional evidence, not fresh latency evidence.

No claim of five-talk replay qualification should be made until the actual traces are inspected and all supported complete recordings pass. Preserve explicit limitations in live-run reports while extending coverage in separately verified passes.
