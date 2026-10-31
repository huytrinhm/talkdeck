# Documentation guide

Current status and commands live in the [package README](../README.md), [technical reference](../TECHNICAL.md), and
[continuation checkpoint](continuation/README.md). Read those before historical handoffs.

| Purpose | Source |
|---|---|
| Behavior and settled choices | [SPEC](../SPEC.md), [decisions](DECISIONS.md), [Lucide contract](LUCIDE_ICONS.md) |
| Milestones and acceptance gates | [Implementation plan](../IMPLEMENTATION_PLAN.md) |
| Measurement procedure | [Improvement loop](IMPROVEMENT_LOOP.md) |
| Implementation and live evidence | [Pass 1 consolidated report](rounds/pass-01/README.md), [Pass 2 breadth report](rounds/pass-02/README.md) |
| Host and provider boundaries | [Host port](HOST_PORT.md), [provider policy](HEADLESS_PROVIDERS.md) |
| Rendering and mandatory checks | [Browser checks](BROWSER_CHECKS.md), [transaction review](P7_REVIEW.md) |
| Offline verification | [Transaction replay](HEADLESS_TRANSACTION_REPLAY.md), [actor replay](HEADLESS_ACTOR_REPLAY.md) |
| Agent-facing instructions | [Editing prompt](AGENT_PROMPT.md) |
| Harness and full-deck images | [Headless reference](../src/headless/README.md) |
| Original timed corpus | [Five-talk fixtures](../fixtures/talks/README.md) |
| Expanded design and motion coverage | [Quality fixtures](../fixtures/quality/README.md) |

`history/` contains superseded permission/implementation checkpoints. `orchestration/` preserves the pre-consolidation
scheduler design and evidence; its old HTML-only tools and status are not the current canonical JSX API. `rounds/`
contains measured evidence, with stages 1–4 consolidated under Pass 1. Raw artifact directories keep their original names.
Normative decisions and original failed measurements are preserved; stale checkpoints do not override current status.
