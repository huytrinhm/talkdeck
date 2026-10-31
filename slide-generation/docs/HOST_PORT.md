# JSX host integration proposal

`src/host/port.ts` defines a proposed port; no neighboring package implements it yet. Inspection at baseline
`dae4a82` found `orchestration/src/runtime.ts` constructs its HTML Publisher inside the runtime constructor.
A renderer injection cannot replace that publisher or its tools. This remains decision O02's integration blocker.

The orchestration owner must bind read_source/edit_source to the canonical engine, preserve immutable inference
contexts, record incoming utterances before model scheduling, and subscribe to accepted publications. Target slide IDs
must come from real host context/model routing, never fixture aliases. Input receipt means durable preservation;
it cannot wait for inference. Publication is distinct from browser paint and settlement.

A contract example is: deliver an utterance with a stable ID and a discovered slide ID; receive a durable receipt;
read source with an inference/tool causal ID; edit using that issued snapshot; publish only the accepted revision;
acknowledge the publication ID after DOM application and a paint opportunity. Forward clock offset and uncertainty.
The host must preserve intermediate failures and never treat a publication timestamp as proof of visible content.

The frontend owner must mount the packaged viewer when P8 is available, authenticate its channel, forward actual
acknowledgments, and resynchronize after reconnect. Speaker notes, source JSX, and transcripts stay in the private
editing API. Audience publications contain only render artifacts. Assets remain an injected versioned resolver.

`capabilities()` defaults to the bare engine's conservative availability. The wired local runtime reports installed
rendering, browser and commit services separately from document readiness. Trace records link reads, edits and input;
the publication adapter records actual viewer acknowledgments. The timed driver requires an injected real host.

## Implemented adapter and required owner hooks

`createLocalRuntime` now supplies the real engine, Hono renderer, mandatory Chromium validation, durable repository,
input inbox and unified tool registry. `src/host/session.ts` packages publication and acknowledgment handling as
`GenerationSession`; it is a host adapter, not a replacement actor scheduler. The caller supplies a real selected slide
ID, channel, publication transport and recorder. Readiness is checked against the exact published source; presentation
refuses a deck with errors/Pending. Browser acknowledgments require a matching issued publication and measured clock
bridge. Raw source, notes and transcripts never enter its publication payload.

The orchestration owner still must wire four concrete sites (inspected at the pinned repository revision):

1. `src/runtime.ts:76`: replace unconditional old `new Publisher(...)` with an injected generation backend, retaining
   legacy behavior only for legacy mode. The JSX mode must subscribe to canonical committed revisions/watermarks.
2. The inference-boundary observation near `runtime.ts:313–365`: capture an immutable canonical source/tool context;
   use this package's `docs/AGENT_PROMPT.md`. Remove the old single-slide/narration-only policy for JSX mode. Do not send
   automatic screenshots; call the explicit screenshot tool only when requested by the model.
3. Tool definition/dispatch near `runtime.ts:370–410`: register `runtime.tools.definitions()` and route calls through
   `runtime.tools.invoke(name,args)`; remove old edit/view_slide mutation handling in JSX mode. Keep the actual actor
   lifecycle, immutable inference history and speech scheduling; no new layout-decider API.
4. Trusted input routing: retain every utterance via `session.deliverUtterance` before inference. The owner must supply
   stable utterance IDs and real slide attribution, including the transition from a new-slide command to its created
   slide. Never use timed-fixture target aliases for routing. Wire frontend selection and viewer acknowledgments through
   `GenerationSession`; require the opaque sandbox/channel checks in `mountViewer` before forwarding acknowledgments.

The current neighboring runtime has no such injection hook. No neighboring files were modified. These are integration
requirements, not a claim that the old host is connected. Direct bounded model-to-tools smoke runs are labeled subsystem
smoke tests and do not qualify the real actor-host five-talk evaluation.

Credentials for any new subsystem model runner are environment-only. The user explicitly requested shell sourcing:

```sh
set -a
source ./.env
set +a
# Run the selected subsystem command in this shell.
```

`.env` is already ignored by slide-generation/.gitignore. No code in this subsystem parses or reads that file. Credentials
must never enter requests recorded on disk, manifests, source or viewer messages. Root verified model access and one
16-token Responses inference on 2026-10-31; those connectivity results do not establish generation quality.
