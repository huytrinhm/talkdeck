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

`capabilities()` reports separate implementation availability. Today only parsing is available; no mutation, renderer,
viewer or live-host success is claimed. Trace records link reads and refused edits; model/publication event types are
contracts for later implementation. Fixture loading and input projection are tested; no timed model runner exists yet.
