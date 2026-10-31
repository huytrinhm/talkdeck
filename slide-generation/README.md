# @talkdeck/slide-generation

The slide-generation subsystem scaffold for Talkdeck: a safe JSX data parser, per-line hash editing, and a Hono API.

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

The default development server listens on `127.0.0.1:8875`. Mutations and presentation readiness fail closed until the
required normalization, renderer, browser validation, and commit adapters are implemented. This is scaffolding, not a
finished rendering service. Work only in this directory on master; fetch and rebase before every push.
