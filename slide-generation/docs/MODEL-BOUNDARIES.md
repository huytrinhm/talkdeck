# Model boundaries: cold-recipient audit and contract

Implemented 2026-10-31. A recipient knows only its actual request, not this repository,
other agents' conversations, a screenshot path, or an intended future tool result.
This contract complements the native JSX/hashline specification; it does not restore
legacy HTML editing or add product frontend behavior.

## Boundary inventory

| Recipient | What is supplied | Decision/output and limits |
|---|---|---|
| Speech decision, eligible ticks every 200 ms | Current working-slide source and real image when available; explicit evidence coverage; cumulative same-slide speech; previous dispatched snapshot; append/replacement delta and new correction records; deck inventory/notes and actor status | `dispatch` sends the snapshot for Fast reasoning and advances that slide's dispatch baseline. `hold` retains it. Neither is publication. Partial tails must not block complete ideas. |
| Slow decision, after unobserved Fast publications | Same immutable visual/source evidence, passive speech with slide attribution, messages, Fast/Slow status, current and last-observed Fast publication watermarks | `wake` requests refinement reasoning; `hold` waits for another Fast publication. Explicit tasks activate independently. No claim to inspect unseen slides or unavailable diagnostics. |
| Fast | Role/invariants and compact design index; typed activation/task envelope; cumulative speech plus new-since-this-recipient delta; inventory/notes; current source and real image | Native local `read_source` / `edit_source`; exact retained utterance handoff for explicit broader work; finish when useful local work is represented. Dispatch and status do not prove visible completion. |
| Slow | Same typed envelope; active tasks persist through tool continuations; passive speech is labeled as Fast's routine-addition input; full design recipes; shared source/image observations | Native edits within current task authority, optional private specialists. Inspect-only tasks do not authorize redesign. No slide navigation or readiness claim from `finish`. |
| Specialist | Explicit self/parent identity, focused task/facts, relevant source/visual evidence, private-design guidance; no native editing tools | `save_artifact`/`image_generate` queue private results; `send_message` delivers explanation. Plain assistant prose is not forwarded. Finish ends this activation; child completion resumes a waiting parent, not an idle one. |
| Tool caller | Declared input schema and self-contained operation/result semantics; issued source snapshots and exact hashes; native acceptance/refusal/findings; structured source error recovery | All source edits resolve against issued original anchors. Successful edits return actual normalized source. An exception is not proof of rollback. Render output is inspection-only, not editable HTML or readiness. |
| End review | Frozen baseline source and issued reads; effective rehearsal transcript; correction history with scope; notes; visits/events/prior source; approximate timing caveats; actual final-render images and citation IDs | One tool-free structured response containing feedback and independent native proposal transactions. Private preparation/validation is separate from explicit acceptance. |
| Proposal revision | Fresh baseline/evidence plus counter-prompt; compact unapplied proposal intent and source changes; separately labeled baseline and old-candidate images | Exactly one complete replacement proposal against **fresh** anchors, not a patch to the old preview. Historical generated IDs and anchors are not reusable authority. |
| Image provider | Specialist-authored local visual brief, output size/quality/format | Private raster bytes. It sees no deck unless the specialist puts necessary visual constraints in the prompt. The URL is not a registered canonical `{id, version}` asset. |
| Live / batch ASR | Audio and explicit transcription configuration; batch returns segment timestamps | Transcription only. No coaching, complete coverage, prosody, or audience visibility is inferred from transcript text. No extra slide context added without a demonstrated recognition need. |

## State, images, and concurrency

- Source and pixels come from one immutable source captured before asynchronous rendering.
  Pixel reuse is keyed by actual rendered HTML/CSS and resolved dependencies, not merely a
  slide ID. Narration-only changes reuse pixels; visible/theme/dependency changes invalidate
  them. Cache sizes are bounded. This is not a validation cache.
- Images are actual provider image parts with MIME and revision attribution. Failures are
  labeled unavailable. Empty geometry or diagnostics explicitly means unmeasured/unevaluated,
  not “everything passed.” Rendered pixels are not evidence of audience display.
- A decision made against an interveningly changed publication is discarded. Speech remains
  pending. Pause/close/undo cancellation cannot become stale mutation authority after an
  asynchronous observation. No information arriving later is presented as already observed.
- Canonical history retains the latest two distinct source observations and at most two
  distinct image observations. Duplicate images coalesce. Source tool reads for all node scopes
  at the latest two read-result revisions remain usable. Older source bodies are archived while
  call/result pairs, outcomes, findings and model reasoning history are retained.
- Activation IDs are deterministic per actor, separate from inference IDs. `tasks` means newly
  delivered tasks; `activeTasks` persists for the activation. Empty `tasks` does not cancel work.
  Finish acknowledgement is not proof that a required child result has already been consumed.
- Private raster results are shown to their producer and parent as image parts. Creation,
  queueing, observation, canonical asset registration, and publication are distinct events.
- Embedded render font/image bytes stay out of ordinary model text; unabridged artifacts remain
  in backend recording. Models use canonical JSX, never those inspection HTML/CSS strings.

## Review-specific evidence

`context.speech` is the effective transcript; `speechHistory` includes superseded records and
must not be double-counted. Coverage reports supplied audio intervals, whether audio was
supplied, and unproven recognition completeness. Absence claims are limited to available
transcripts. Final render evidence IDs describe final-baseline renders, not rehearsal captures.
Convenience notes/transcript extracts are not independent corroborating evidence.

Review requests authorize proposals for visual content and speaker notes, not publication.
Grounded rehearsal qualifications or useful improvised lines can be proposed with citations;
contradictory source/speech facts require explicit feedback rather than silent reconciliation.
Original raw evidence stays immutable.

`PreparedProposal` is an internal persisted record, **not a model wire format**. Revisions omit
preview HTML/CSS, embedded fonts/JPEG text, stale hashes, candidate digests and lifecycle state.
The adapter checks the entire serialized request including all images against a configurable
24 MiB default; it rejects oversized requests without silently truncating evidence. Other
reviewer adapters must enforce their own actual transport budget.

## Audit and verification provenance

Nine isolated recipient exercises covered the two decisions, Fast, Slow, review, revision,
specialist initial/results, parent results and narrow image/ASR providers. Auditors received
only captured request packets and their actual image parts, not implementation explanations.
Additional fresh cold checks of the fixed Slow gate, inspect-only Slow, and revision boundaries
found enough information to choose the correct next action without outside context.

The deterministic end-to-end capture used the real scheduler, SDK request adapters, engine,
Chromium, private proposal preparation, acceptance and undo, with scripted provider responses
and forced ticks. It is **not a live-model quality or latency benchmark**. On the same one-slide
revision scenario:

| Serialized content | Before | After |
|---|---:|---:|
| Complete revision request | 3,034,313 bytes | 207,122 bytes |
| User text parts | 2,949,884 bytes | 44,482 bytes |
| Actual image parts | 1 (baseline only) | 2 (baseline + old candidate) |
| Repeated inspect-only Slow images | 3 identical images | 1 image |

These are a particular captured revision, not guaranteed production sizes. Local ignored
artifacts are under `.artifacts/boundary-audit-before/` and `.artifacts/boundary-audit-after/`.
Automated regressions cover actual pixel caching/invalidation, stale decisions, source/image
history, task retention, error contracts, private images, cancellation, review transport leakage
and proposal cardinality. ASR/illustration stubs establish interface transport, not provider
availability or recognition/artwork quality.

## Remaining limitations

- Slow/review still preload the full design recipes; task-specific recipe selection and
  whole-conversation summarization are not implemented. Compact history is not a long-talk
  context-window solution.
- A busy Fast status does not disclose its private reasoning or prove a planned layout.
- Specialist private asset references still need the canonical resolver boundary before use.
- Recorded-event replay must match the protocol/prompt that produced a recording. Historical
  provider requests are never rewritten to look like the new boundary. Reproduce old runs with
  their matching source version; incompatible runs fail closed.

Verification: `npm run check` passed; `npm test` passed **352/352**, including real Chromium.
The added actor CLI regression also exercised a fresh on-disk recording through transaction
preflight and exact actor replay with network blocked and the original cassette unchanged.
No paid model calls were used for this boundary audit (the independent ZIP quality comparison
is a separate experiment).
