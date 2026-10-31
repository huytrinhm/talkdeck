# Orchestration design decisions

Snapshot: 2026-10-31. Scope: `orchestration/`, currently backed by its original HTML
publisher. This records user-requested behavior and implementation choices, not a
new global specification for the independently developed JSX subsystem. Later
explicit user instructions take precedence. Keep superseded choices documented.

## Current decisions and reasons

| ID | Decision | Reason / consequence |
| --- | --- | --- |
| O01 | Use the official OpenAI Node SDK directly: transcription, Decisions, Responses, and image generation. | No Vercel SDK or Codex coding-agent harness is required for the persistent runtime. Histories and lifecycle are application-managed. |
| O02 | Evaluate undispatched speech on a fixed 200 ms clock. | Replaces the original approximately 250 ms accumulation rule. Do not reset a timer on every word or wait for silence. Dispatch authorizes reasoning, not mandatory editing. |
| O03 | Use a separate Decision call for Slow eligibility. | Supersedes automatic wake on every Fast publication. New Fast publications make idle Slow eligible; wake/hold decides whether refinement is useful. Holds wait for another publication. This gate is event-driven, not a second 200 ms polling loop. |
| O04 | Keep persistent Fast and Slow sessions, with one inference per actor. | Preserve conversation and tool history while allowing different actors to work concurrently. Each inference has immutable input. New speech/messages arrive at the next boundary. |
| O05 | Fast has one replaceable pending transcript per slide. | Keep full cumulative speech and correction context without queuing outdated editing jobs or dropping work on other slides. Old erroneous edits require a new decision; transcript correction is not implicit undo. |
| O06 | Separate selected slide from agent working target. | Navigation must not redirect late transcription, an in-flight edit, or a specialist result to a different slide. Stable IDs survive ordinary edits. Agents never navigate for the user. |
| O07 | Serialize merge, validation, render, and publication. | Reasoning/private preparation remain concurrent, but the visible frame changes only after the whole transaction succeeds. Disjoint/identical changes may merge; incompatible/ambiguous edits reject. No agent owns a region or has precedence. |
| O08 | Specialists return immutable private artifacts; only Slow integrates them. | Avoid partial dependencies and late asset writes changing published content. Initially at most two active specialists. Messages/completions alone do not wake idle actors. |
| O09 | `finish` ends an activation, not the persistent session. | Avoid cosmetic/no-op tool loops while still consuming fresh work and required specialist results. |
| O10 | Push-to-edit is a simple explicit prompt/comment to Slow. | No extra agent or decision gate. Capture the slide ID at submission. Deliver at an actor boundary; queue while paused. Do not mix commands into the transcript. |
| O11 | Undo/redo uses deck snapshots and one unit per accepted state-changing transaction. | Batch edits and split/merge restore atomically, as does creation. No-ops/rejections/navigation do not clear redo; new changes do. Keep current selection if that ID survives restoration. |
| O12 | Undo/redo cancels obsolete work; pause preserves it. | History restoration invalidates old branches, aborts pending inference/Decision/specialist work, and suppresses automatic replay of existing speech. Preserve transcript and conversation history. Fresh input remains eligible. Empty stacks do not cancel active work. |
| O13 | Keep the integration backend-only for now. | The user explicitly requested no frontend changes and no modification of other contributors' work. Local HTTP/SSE and exported TypeScript APIs are the integration surface. |

### Current model configuration, not a latency guarantee

| Role | Model default | Reasoning | Service tier |
| --- | --- | --- | --- |
| Fast | `gpt-6-luna` | `none` | `fast` |
| Slow | `gpt-6-sol` | `medium` | `fast` |
| Specialist | `gpt-6-sol` | `low` | Unspecified in this package |
| Speech / Slow Decisions | `gpt-6-luna` | Not set by adapter | Not set by adapter |
| Transcription | `gpt-live-transcribe` | N/A | Not set by adapter |
| Image tool | `gpt-image-2.5-flare` | N/A | Not set by adapter |

Fast/Slow settings reflect this thread's explicit requests. A prior probe accepted
`fast` and rejected `ultrafast`; see [verification](../VERIFICATION.md). The
slide-generation workstream subsequently recorded a broader Fast-mode instruction
in its decision D57. This table describes actual orchestration code, not a claim
that it already implements that broader policy. Reconcile supported endpoint
options and remaining roles when connecting the subsystems; do not silently claim
all calls use Fast mode.

### Bounded scheduling implementation choices

The speech gate permits up to eight overlapping decisions per slide, skips ticks
when full, and uses a 30-second deadline. Errors retain input with bounded backoff.
Slow has one eligibility request in flight, coalesces newer publications, discards
obsolete results, and does not auto-retry an unchanged failed candidate. These are
current overload policies, not product promises of 200 ms model latency.

### Original HTML backend: do not carry these rules into JSX by accident

The original publisher uses self-contained 1280x720 HTML/CSS/SVG, exact-match
`edit(old,new)`, conservative three-way merge, and actual source/PNG observations.
It includes the latest two distinct observations in model input and suppresses
numeric animation. This remains the working backend in this package.

The newer [JSX specification](../../slide-generation/SPEC.md) instead defines
canonical JSX/hashline transactions, a 1920x1080 canvas, explicit screenshot
requests, strict primitive/layout rules, and bounded Stat animation. Its engine
owns source validation and commit. These are different contracts, not two
interchangeable renderers. See [integration work](HANDOFF.md#integration-with-slide-generation)
for the missing adapter. Do not introduce a second source of truth or run both
mutation interfaces against one live deck.

## Proposed next work — not yet implemented or approved as a detailed contract

1. Connect the actor scheduler to the canonical JSX engine through an explicit
   backend boundary, preserving scheduling and cancellation semantics.
2. Add feedback proposals with explanation, affected slides, preview, and
   accept/reject/revise; revalidate before accepting a stale proposal.
3. Enforce build/practice/present mutation permissions in runtime code, including
   in-flight mode switches. Practice analysis must not publish automatically.
4. Connect timestamped transcript/audio evidence and speaker notes, then rehearsal
   analysis. Reuse the JSX subsystem's source/notes contracts where applicable.
5. Add pointer/sketch grounding, reusable component retrieval, and speculative
   next-slide preparation under separate contracts.

The silent-listener interaction, precise mode transitions, proposal lifecycle, and
rewind storage remain open designs. Do not treat this ordering as implementation
already completed or as permission to modify neighboring packages.
