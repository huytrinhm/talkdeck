# @talkdeck/slide-generation

Canonical JSX slide generation/editing for Talkdeck: hashline transactions, Hono/Tailwind rendering, mandatory Chromium checks, durable evidence and a sandboxed viewer.

- [Specification](SPEC.md): agreed behavior and provisional asset boundaries.
- [Technical documentation](TECHNICAL.md): architecture, implementation rules, integration seams, and remaining work.
- [Agent editing instructions](docs/AGENT_PROMPT.md): prompt rules for the editing agent.
- [Implementation plan](IMPLEMENTATION_PLAN.md): start here when taking over; milestones, tests, and integration gates.
- [Decision ledger](docs/DECISIONS.md): settled user choices and unresolved product questions.
- [Improvement loop](docs/IMPROVEMENT_LOOP.md): real-model measurements, diagnosis, replay, and frozen comparisons.
- [Five timed talks](fixtures/talks/README.md): speaking-pace inputs and evaluator-only expectations.
- [Lucide icons](docs/LUCIDE_ICONS.md): dedicated Icon primitive, full-catalog agent search, and fixed-stroke styling requirements.

```sh
npm ci
npm run check
npm test
npm start
```

The development server listens on `127.0.0.1:8875` and stores canonical source under `.artifacts/decks/default/`.
`npm test` includes real Chromium integration tests. Successful edits require complete browser validation; unavailable
checks refuse. The existing orchestration/frontend integration and five-talk live-model qualification remain unfinished.
Work only in this directory on master; fetch and rebase before every push.

For model commands, source credentials in the shell; application code reads environment variables only:

```sh
set -a
source ./.env
set +a
npm run smoke:generation
```

The smoke makes at most eight real Responses requests, each capped at 8,000 output tokens. It uses `FAST_MODEL`
(default `gpt-6-luna`), Fast mode (`service_tier: "fast"`), and `OPENAI_API_KEY` or `OPENAI_KEY`. It checks one exact-content slide through real tools, mandatory
browser validation and the packaged viewer. It records provider usage and replay cassettes; it is not the five-talk
actor-host evaluation. [First recorded result](docs/rounds/subsystem-smoke-2026-10-31.md).

All live inference requests use Fast mode per the user's instruction. The request tier is recorded in new run manifests;
the exact provider response records the tier actually served. Historical recordings retain their original settings.

`npm run eval:talks -- --help` describes the actual-host adapter required for timed runs. Replay, freeze, compare and
report commands are also available as `eval:replay`, `eval:freeze`, `eval:compare` and `eval:report`. Output stays under
`.artifacts/`. Replays have no live-model fallback; a frozen export alone is not a measured baseline.

`.env` is ignored and must remain untracked. See [host integration](docs/HOST_PORT.md),
[browser checks](docs/BROWSER_CHECKS.md), and [viewer integration](src/viewer/README.md).
