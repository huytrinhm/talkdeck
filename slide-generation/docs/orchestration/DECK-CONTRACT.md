# Deck/session contract

> Consolidated on 2026-10-31 by explicit user instruction. This document preserves the legacy HTML scheduler/control
> contracts and historical measurements; it does not describe a separate npm package anymore. Code is now under
> `src/orchestration/`, tests under `test/orchestration/`, and original WAV/text fixtures under `fixtures/legacy/`.
> The actual actor scheduler now also accepts the canonical JSX backend; see the [current host integration](../HOST_PORT.md)
> and [package commands](../../README.md). Historical `runs/...` paths and test counts below retain their original
> provenance and may not exist in a fresh checkout. They are not integrated five-talk results. Frontend work remains separate.

This extends the single-slide contract. Frontend integration is explicitly out of
scope for this change; APIs implement the controls for later frontend wiring.

- A session contains one ordered deck and persistent Fast/Slow sessions. Each slide
  has a stable ID. The displayed slide is a user-controlled selection, not an agent
  cursor. Next selects the following slide or creates a blank slide at the end.
- Narration is explicitly routed to a slide. Direct text snapshots use increasing
  revisions per slide. Audio segments are bound to the selected slide when opened;
  navigation finalizes the current segment before changing that binding. Late
  transcription must never be assigned to whichever slide happens to be selected.
  Clients buffer unsent PCM across a navigation request, then resume with its
  returned slide ID; stale-target chunks are rejected without consuming a sequence.
- Fast has a replaceable pending narration value per slide, processed serially in
  its persistent session. Leaving a slide does not cancel its already-started work.
  Slow sees deck context and may inspect/edit past slides once later facts clarify
  them. Agent tools never select or advance the user's displayed slide.
- Pause suspends new inferences, decisions and tool work. An already-issued request
  may finish, but publication is blocked. Model results/history/private artifacts
  are retained for resume. A render crossing a pause barrier is discarded; after
  resume, the agent receives diagnostics and can reconsider. User navigation works
  while paused. Resume continues pending work without duplicating activations.
- Split/merge validate and render every candidate before committing the entire
  transaction. Split retains the original ID for its first part; merge retains the
  first input's ID. Removed IDs are tombstones, never retargeted automatically.
  Selection stays on its existing identity; if merged away, it maps to the survivor.
  Concurrent changes to affected source or incompatible structure reject the whole
  transaction. Slow can make atomic cross-slide edits through the same publisher.
- Slow activation remains Decision-gated after Fast publications. Gates consider
  deck context; ordinary mail/passive narration still does not wake Slow. Explicit
  user work requests bypass eligibility. No background agent owns a slide region.
- At most two specialists run per session. They receive focused task facts and
  relevant slide imagery, return immutable image/component artifacts, and cannot
  publish. Only Slow integrates them. Image generation exposes OpenAI
  `gpt-image-2.5-flare` with explicit quality and size controls.
- `finish` ends an activation, not its persistent session. Fresh pending work and
  required child results must still be consumed. A tool-free response also finishes.
- All mutations and render/publication transactions are serialized for the deck;
  model reasoning/private asset requests remain concurrent. One accepted atomic
  content/structure transaction is one deck-level undo unit. Undo/redo restore
  validated source/frame snapshots atomically and are available through runtime
  and HTTP controls; frontend wiring remains out of scope.
- Push-to-edit is a prompt/comment task for Slow with an explicit stable slide ID,
  separate from narration. It bypasses Decision eligibility, waits at model
  boundaries, and queues during pause. Removed queued targets are obsolete.
- Undo/redo invalidate previous publication branches and cancel old agent,
  specialist, and Decision work. They clear previous pending work but preserve
  transcript and conversation history; consumed speech is not automatically
  replayed. Fresh speech/comments arriving after the history boundary remain
  eligible. Pause state is unchanged. Empty stacks do not cancel work.
- Undo/redo preserve selection if that ID survives; otherwise use the restored
  snapshot's selection. Creation, split, merge, and batch edits restore as whole
  transactions. No-op/rejected edits and navigation do not clear redo; a new
  state-changing transaction does. History lives only in the current session.
