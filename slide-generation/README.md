# @talkdeck/slide-generation

Talkdeck's combined generation and orchestration package: persistent Fast/Slow actors, canonical JSX/hashline editing,
Hono/Tailwind rendering, mandatory Chromium validation, durable source evidence and a sandboxed viewer. The user
approved consolidation on 2026-10-31. There is one package manifest and lockfile; the previous orchestration package
now lives under `src/orchestration/`, with tests in `test/orchestration/` and historical fixtures in `fixtures/legacy/`.

- [Specification](SPEC.md) and [implementation plan](IMPLEMENTATION_PLAN.md): behavior, milestones and acceptance gates.
- [Technical documentation](TECHNICAL.md) and [host integration](docs/HOST_PORT.md): current architecture and boundaries.
- [Decision ledger](docs/DECISIONS.md): settled choices; do not reopen them.
- [Agent instructions](docs/AGENT_PROMPT.md) and [Lucide icons](docs/LUCIDE_ICONS.md): editing and dedicated-icon contracts.
- [Improvement loop](docs/IMPROVEMENT_LOOP.md) and [five timed talks](fixtures/talks/README.md): measurement and comparison.
- [Headless evidence](src/headless/README.md): actual viewer frames, recording, audits and reports.
- [Orchestration history](docs/orchestration/HANDOFF.md): preserved scheduler/control contracts and historical measurements.

From this directory:

```sh
npm ci
npx playwright install chromium
npm run check
npm test
npm start
```

`npm start` runs the private canonical editing service on `127.0.0.1:8875`, storing source under
`.artifacts/decks/default/`. Tests include real Chromium checks and real actor-to-canonical-backend integration with
deterministic model responses. Browser permissions work. A product frontend is unnecessary for the headless runner;
frontend integration remains separate. No placeholder control UI is introduced; the headless runner uses real actors,
canonical tools and the packaged iframe.

For a paid timed run, source credentials in the shell. Application code reads only process environment:

```sh
set -a
source ./.env
set +a
npm run headless:run -- --fixture fixtures/talks/edit-heavy.json --out .artifacts/runs/edit-heavy-baseline-1 --repetition 1 --max-calls 200 --max-input-tokens 2000000 --max-output-tokens 100000
```

This runs the actual actor scheduler through the canonical backend and packaged headless viewer at fixture pace.
Use a new output directory for every run. The run records input, model/tool bodies, source/check/render states, routing,
viewer acknowledgments, PNG/video, final slide JPEGs, audit and `review.md`. Exact native content checks are automated;
unsupported semantic/design checks remain explicit manual-review misses. This command is a runner, not evidence of a
completed five-talk qualification. The consolidated live pilot and repeated frozen-baseline comparison have not yet
been completed.

Responses requests use `service_tier: "fast"`; provider records distinguish requested and actually returned tiers.
The Decisions endpoint exposes no `service_tier` field, so its policy is recorded as `endpoint-default`, without an
unsupported field or header. Model defaults are Luna for Fast/Decisions and Sol for Slow/specialists; environment
variables `FAST_MODEL`, `DECISION_MODEL`, `SLOW_MODEL` and `SPECIALIST_MODEL` override them. Shared budgets reserve
capacity before concurrent calls. Missing usage remains unknown and charged conservatively. Asset integration stays
provisional.

`npm run smoke:generation` is the smaller direct model-to-tools smoke, capped at eight requests and 8,000 output tokens
per request. Its [recorded result](docs/rounds/subsystem-smoke-2026-10-31.md) predates the combined host and must not be
reported as the integrated timed loop.

`eval:talks` supports an explicitly supplied host module; `eval:replay`, `eval:freeze`, `eval:compare` and `eval:report`
provide recording/replay/comparison foundations. Use `-- --help` with those commands. Replay has no live fallback;
a frozen export alone is not a measured baseline. Historical HTML fixture/server paths remain explicitly available
as `legacy:fixture` and `legacy:server`; see [legacy commands](docs/orchestration/README.md).

Work on master with focused commits; fetch/rebase origin/master and run checks before every push. Never force-push.
`.env` and `.artifacts/` stay ignored. Current changes remain inside this consolidated directory; historical move commits
necessarily remove the previous package paths. Frontend files are outside this work.
