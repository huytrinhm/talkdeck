# Specification verification

Scope: the supplied single-slide specification, with the 250 ms dispatch window
replaced by the 200 ms Decisions gate. The separately excluded multi-slide,
practice, pointer and in-flight pause/undo contracts are not implemented.

| Requirement                                                                         | Implementation                                                        | Evidence                                                                                  |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Audio -> streaming transcript -> shared slide, no AI audio/automatic navigation     | `transcription.ts`, `runtime.ts`; no audio output/navigation tools    | Real root WAV replay; `transcription_event` logs and publication screenshots              |
| 200 ms evaluation without resetting on words/silence                                | `gate.ts` fixed interval                                              | Fake-clock test feeds words every 50 ms and observes calls at 200/400 ms                  |
| Replaceable pending full speech; corrections preserved; running inference immutable | `gate.ts`, actor latest slot in `runtime.ts`                          | Busy-Fast replacement and correction tests                                                |
| Corrections do not implicitly undo an accepted edit                                 | `publisher.ts` only mutates through edit                              | Already-displayed wrong claim remains until subsequent model action in test               |
| Persistent Fast/Slow histories, one inference per actor, independent concurrency    | `history.ts`, actor run loop                                          | Deferred-response serialization tests and live inference logs                             |
| Slow passive context never wakes/forces continuation                                | `runtime.ts` dispatch/finish rules                                    | Passive-context test; only accepted Fast publication or explicit followup wakes idle Slow |
| No active Slow per-publication broadcast; coalesced followup by observed watermark  | Publisher callback and actor completion                               | Three Fast publications during held Slow inference produce one followup                   |
| Actual current source, PNG, geometry, diagnostics; two distinct observation bodies  | `renderer.ts`, `history.ts`, `publisher.ts`                           | Real Chromium test; image-history projection test and exact inference logs                |
| HTML/CSS/SVG/custom elements, immutable assets                                      | `renderer.ts`, `assets.ts`                                            | Registered shadow component/SVG asset tests; real specialist artifact in first live run   |
| Exact-once old match; insertion/deletion; original branch plus successful own edits | `merge.ts`, `publisher.ts`                                            | Absent/repeated/overlapping targets and sequential private-branch tests                   |
| Conservative disjoint/identical merge; conflict rejection                           | Token-atomic three-way merge                                          | Disjoint, identical, competing insertion, integer/decimal/unit conflict tests             |
| Serialized merge/validate/render/publish; previous frame retained on failure        | Publisher transaction chain                                           | Deferred render serialization, diagnostic rollback and thrown-render rollback tests       |
| One undo unit per accepted state-changing call                                      | Publisher undo snapshots                                              | No-op and multi-edit undo tests; undo UI is explicitly out of scope                       |
| Stale Fast intent + supporting speech forwarded once; no automatic retry/precedence | Publisher conflict callback -> Slow mailbox                           | Same inference/call rejected twice produces one forwarding callback                       |
| Required component/reference/ID/execution validation; visual diagnostics advisory   | Chromium + reference validation                                       | Undefined component, external/fragment reference, duplicate ID and thrown-script tests    |
| No numeric tweening through invented intermediate values                            | Static render clock, animation suppression, scripted-timer validation | Timer animation rejected; numeric merge atomicity tests                                   |
| Focused private specialists, at most two active; only Slow integrates               | Runtime specialist tools + immutable artifact store                   | Deferred specialist tests and real specialist run logs                                    |
| Queue-only messages/completion, explicit followup and waiting-parent semantics      | Actor mailboxes, request flags and waiters                            | Idle queue test, active followup test, waiting-parent integration and shutdown tests      |
| Server-facing API without touching frontend                                         | `server.ts` HTTP/SSE                                                  | Local API lifecycle, screenshot, invalid input, SSE connection and delete test            |

## Live fixture evidence

The first complete live run is in `runs/2026-10-31T03-17-50-975Z/`.
It used the actual 85.5-second WAV, emitted 287 transcript revisions, produced five
published states, rejected one stale overlap, and ran a specialist that saved two
private artifacts. `audit.json` passes all 14 fixture-content/lifecycle checks.
Its final PNG was inspected: correct 48 completers and 4.4 rating, time and
first-visit comparisons, process diagram, staffing caveat and recommendation.

A second benchmark (`runs/2026-10-31T03-20-11-913Z/`) reduced first publication to
4.6 seconds from playback start, but was deliberately stopped after observing
low-value caption rewrites. It is not counted as a completed run. Role/completion
instructions were tightened based on that evidence.

## Initial full live verification (2026-10-31)

- `npm run check`: passed.
- `npm test`: **30 passed**, including real Chromium, local HTTP/SSE, local
  WebSocket streaming/cleanup, concurrency, private-asset integration permissions,
  rollback and numeric-merge tests.
- Final complete live run: `runs/2026-10-31T03-38-59-543Z/`.
  The actual WAV produced **286 transcript revisions**, all evaluated/dispatched,
  **six publications** and three rejected stale conflicts. Both agents finished
  idle; the final renderer returned no diagnostics.
- `npm run audit -- runs/2026-10-31T03-38-59-543Z`: **14/14 checks passed**.
  The PNG was visually inspected: three correct comparisons, corrected sample and
  rating, process diagram, staffing caveat, recommendation, no clipping.
- `npm run replay-publications -- runs/2026-10-31T03-38-59-543Z`:
  **nine recorded edit attempts replayed with identical outcomes and final source**
  through the final merge/renderer code.
- Root fixture files are unchanged. No frontend or other contributors' files were
  edited. Dependencies, implementation, tests and outputs are under `orchestration/`.

### Latency and failed-run findings

Recent live requests experienced substantial connection/request delays. The final
run recovered after gate timeouts, retaining the accumulated narration, and took
137.9 seconds overall. Its first publication was about 97.5 seconds after the
first transcript event; Fast inference p50 was 2.65 seconds. This is a correctness
and recovery pass, **not an acceptable interactive-latency benchmark**. An earlier
benchmark reached first publication 4.6 seconds after run start, but was stopped
for low-value caption rewrites and is not counted as a complete pass.

Other run directories preserve connection failures and an early-drain failure.
The fixture runner now waits for the final transcript revision to be evaluated
(including a valid hold), rather than silently closing the gate after 15 seconds.
A timeout is a reported failure, never an implicit dispatch. Network retries are
bounded; no failed live run is counted as a pass.

Live latency is provider- and load-dependent. A 200 ms scheduler is not a 200 ms
model response guarantee; this implementation does not claim a latency SLA.

## Recheck (2026-10-31)

Four additional defects were reproduced with failing regression tests and fixed:

- A stale edit could select an arbitrary copy after concurrent duplication.
  Ambiguous state-changing edits are now rejected, while already-applied identical
  changes remain accepted no-ops.
- Continuous narration could exhaust the activation's step budget despite fresh
  speech. Fresh work now renews the budget; a no-new-input tool loop still fails
  at the configured limit.
- Slow could finish without consuming a required specialist result that arrived
  during its final inference. Required results now remain outstanding until
  delivered at a subsequent model boundary.
- A specialist failure could fail settlement before Slow handled it, or after
  Slow recovered. Settlement now allows the active parent to observe the failure
  and finish; unhandled failures and main-agent failures still fail settlement.

Verification after these changes:

- Type check passed; **37 tests passed**, including seven new regression and
  negative-control tests.
- The saved live fixture's **nine edit attempts** replayed through the updated
  publisher and Chromium renderer with identical outcomes and final source.
- The saved fixture audit still passes **14/14 checks**.

This recheck did not run a new paid live API fixture. Saved-publication replay
checks publication behavior, not new live model behavior or latency. The latency
limitation above remains unresolved.

## Explicit boundaries

- Overload: up to eight overlapping gate requests, 30-second request deadlines,
  occupied ticks skipped rather than queued; failures retain speech and back off.
- Model decides when an activation has no useful work. A 64-step safety bound
  applies between fresh work inputs and reports failure, not false success;
  explicit followup can recover a failed actor.
- The service is single-process/in-memory. Disk logs and artifacts support review,
  not automatic crash recovery or a distributed lease protocol.
- Visual diagnostics are advisory and successful validation does not establish
  factual correctness. Fixture audits are specific to the fictional library talk.
- Synthetic TTS tests do not establish noisy-microphone or multilingual accuracy.
