# Model boundaries: cold-recipient audit and contract

Implemented 2026-10-31. A recipient knows only its actual request, not this repository,
other agents' conversations, a screenshot path, or an intended future tool result.
This contract complements the native JSX/hashline specification; it does not restore
legacy HTML editing or add product frontend behavior.

## Boundary inventory

| Recipient | What is supplied | Decision/output and limits |
|---|---|---|
| Speech decision, eligible ticks every 200 ms | Current-slide image (visible-source fallback if unavailable); `current_transcript`, `previously_sent_transcript`, useful additional correction context and optional brief. The complete instructions live in `questions[].instructions` and define the job, action effects and speech mode. | `dispatch` sends the snapshot for Fast reasoning and advances that slide's dispatch baseline. `hold` retains it. Neither is publication. Partial tails must not block complete ideas. |
| Designer decision, on eligible content/recovery events | Current-slide image/fallback, attributed passive speech, brief, work messages and title/ID inventory. Static instructions explain the designer’s job, including first composition of an otherwise valid plain draft. Source-derived design-state evidence distinguishes bootstrap defaults without claiming user approval; no busy/idle or watermark heuristics. | `wake` requests refinement reasoning; `hold` leaves the designer idle; later publications, failed edits, or a coalesced settling check can reconsider it. Explicit tasks activate independently. No claim to inspect unseen slides or unavailable diagnostics. |
| Fast | Role/invariants and compact design index; working slide and active tasks; cumulative speech plus new-since-this-recipient delta; inventory/notes; current source and real image | Native local `read_source` / `edit_source`; exact retained utterance handoff for explicit broader work; finish when useful local work is represented. Dispatch and status do not prove visible completion. |
| Slow | Same typed envelope; active tasks persist through tool continuations; passive speech is labeled as Fast's routine-addition input; full design recipes; shared source/image observations | Native edits within current task authority, optional private specialists. Inspect-only tasks do not authorize redesign. No slide navigation or readiness claim from `finish`. |
| Specialist | Parent delivery ID, focused active tasks/facts, relevant messages, brief and actual visual references; private-design guidance. No ambient narration, deck source, notes, editor anchors or worker roster. | `save_artifact`/`image_generate` queue private results; `send_message` delivers explanation. Plain assistant prose is not forwarded. Finish ends this activation; child completion resumes a waiting parent, not an idle one. |
| Tool caller | Declared input schema and self-contained operation/result semantics; issued source snapshots and exact hashes; native acceptance/refusal/findings; structured source error recovery | All source edits resolve against issued original anchors. Successful edits return actual normalized source. An exception is not proof of rollback. Render output is inspection-only, not editable HTML or readiness. |
| End review | Frozen baseline in one exact full-deck issued read when possible; effective rehearsal speech plus distinct historical records; visits/events/prior source; timing caveats; actual final-render images and citation IDs. Notes/raw input remain inside source; design guidance is in instructions. | One tool-free structured response containing feedback and independent native proposal transactions. Private preparation/validation is separate from explicit acceptance. |
| Proposal revision | Fresh baseline/evidence plus counter-prompt; normalized before/after proposal scopes (unanchored edit-text fallback for older records); separately labeled baseline and old-candidate images. No duplicate changes list when normalized scopes exist. | Exactly one complete replacement proposal against **fresh** anchors, not a patch to the old preview. Historical generated IDs and anchors are not reusable authority. |
| Explicit change proposal | Current baseline/evidence, `change.slideId` and `change.prompt`; complete instructions and structured response schema | Exactly one scoped private proposal. The host prepares the preview and the user accepts its exact version. |
| Image provider | Specialist-authored local visual brief, output size/quality/format | Private raster bytes. It sees no deck unless the specialist puts necessary visual constraints in the prompt. The URL is not a registered canonical `{id, version}` asset. |
| Live / batch ASR | Audio and explicit transcription configuration; batch returns segment timestamps | Transcription only. No coaching, complete coverage, prosody, or audience visibility is inferred from transcript text. No extra slide context added without a demonstrated recognition need. |

## State, images, and concurrency

- Source and pixels come from one immutable source captured before asynchronous rendering.
  Pixel reuse is keyed by actual rendered HTML/CSS and resolved dependencies, not merely a
  slide ID. Narration-only changes reuse pixels; visible/theme/dependency changes invalidate
  them. Cache sizes are bounded. This is not a validation cache.
- Images are actual provider image parts. The single-slide speech gate receives the current
  slide image alongside two transcript snapshots. Cross-slide designer context and editor
  observations retain target IDs. Exceptional image availability and actionable findings
  accompany the evidence. Immutable source revisions and routing stay in host records;
  issued editing snapshots retain exact anchors.
- A decision made against an interveningly changed publication is discarded. Speech remains
  pending. Pause/close/undo cancellation cannot become stale mutation authority after an
  asynchronous observation. No information arriving later is presented as already observed.
- Canonical history retains the latest two distinct source observations and at most two
  distinct image observations. Duplicate images coalesce. Source tool reads for all node scopes
  at the latest two read-result revisions remain usable. Older source bodies are archived while
  call/result pairs, outcomes, findings and model reasoning history are retained.
- Activation IDs are deterministic per actor, separate from inference IDs. Model input sends
  `activeTasks` once and `newTaskCount` when new tasks arrive. Active tasks persist across calls.
  Task UUIDs, message UUIDs/destinations, epochs and full statuses remain internal/logged. Model tasks retain their assignment, scope and substantive facts; messages retain their sender, content, target and artifacts. Designer input includes only
  specialist status and required-result obligations. `finishRequested` acknowledges a request;
  `activationContinues` and reasons identify remaining work. Legacy HTML finish output is unchanged.
- Private raster results are shown to their producer and parent as image parts. Creation,
  queueing, observation, canonical asset registration, and publication are distinct events.
- Embedded render font/image bytes stay out of ordinary model text; unabridged artifacts remain
  in backend recording. Models use canonical JSX, never those inspection HTML/CSS strings.

## Review-specific evidence

`context.speech` is the effective transcript; `speechHistory` includes superseded records and
must not be double-counted. Coverage reports supplied audio intervals, whether audio was
supplied, and unproven recognition completeness. Absence claims are limited to available
transcripts. Final render evidence IDs describe final-baseline renders, not rehearsal captures.
Exact copies of effective speech are omitted from the wire history, but distinct or corrected
records remain. When an issued read reconstructs the entire baseline exactly, the wire sends
that read once rather than the same source plus overlapping node reads and note extracts.
It still supports granular edits using the deck-root nodeId and exact line ranges. If no exact
covering read exists, source and original scopes are retained. Persisted evidence is unchanged.
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

## Recipient-focused follow-up (2026-10-31)

The model wire DTO is now explicitly separate from internal scheduler/persistence objects.
`src/orchestration/model-context.ts` projects canonical actor state at history-read time;
`src/practice/model-context.ts` removes only proven duplicates from review transport. Neither
rewrites durable histories, guard epochs, task routing, private artifacts or edit snapshots.
Stable role/action/evidence rules live in instructions/tool definitions rather than repeated
policy paragraphs inside each dynamic state object.

The designer is responsible for an initial deliberate composition as well as later refinement;
readability/validity alone does not mean design is complete. This does not mandate decoration,
retheming, editing during inspect-only tasks, or rebuilding an already intentional slide.
The authoring reference now exposes native Frame/Motif/Shape and reusable definition syntax,
including explicit JSX booleans. These capabilities already existed; no renderer was added.

Review and revision keep whole-talk evidence deliberately. A counter-prompt can change scope
or involve shared definitions, and arbitrary local filtering could hide necessary facts or
other dependent slides. Task-scoped evidence retrieval is not implemented. The review wire
instead removes duplicate source/speech, explains visit-to-speech/revision links, and moves
frozen design instructions into the instruction layer. ASR already has a narrow audio-only
contract and is unchanged. Image generation gets a self-contained visual brief through its
tool description; the provider does not secretly inherit the deck.

This context follow-up adds no tools, paid model calls or frontend behavior. Concurrent main-thread work extends refinement eligibility and supplies source-derived designState; the projections preserve that evidence for the designer and its gate.
Tests exercise the actual request adapter, role projections, specialist pixel delivery, task
continuations and binding projected proposal anchors back to persisted evidence. This checks
transport and execution contracts, not whether live models choose better layouts.

## Prior audit and verification provenance

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
- The gates do not receive private editor plans or a semantic diff since the last designer
  observation. They judge the current evidence; watermark counters would not fill that gap.
- Concurrent scheduler work permits one coalesced reconsideration when Fast settles after
  unreviewed work, plus failed-edit recovery; this is not unrestricted idle polling.
- Specialist private asset references still need the canonical resolver boundary before use.
- Recorded-event replay must match the protocol/prompt that produced a recording. Historical
  provider requests are never rewritten to look like the new boundary. Reproduce old runs with
  their matching source version; incompatible runs fail closed.

Prior-audit verification: `npm run check` passed; `npm test` passed **352/352**, including real Chromium.
The added actor CLI regression also exercised a fresh on-disk recording through transaction
preflight and exact actor replay with network blocked and the original cassette unchanged.
No paid model calls were used for this boundary audit (the independent ZIP quality comparison
is a separate experiment).

Follow-up verification: typecheck and the full **356-test** suite passed, including
real Chromium and exact replay. After integration with concurrent main-thread
design-state/scheduler changes, typecheck and **30 targeted boundary/provider/design
tests** passed again. These are deterministic contract checks, not paid live-model
quality measurements. Changes remain uncommitted to avoid mixing concurrent work.
