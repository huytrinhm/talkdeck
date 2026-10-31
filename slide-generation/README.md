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
- [Practice feedback and proposals](docs/PRACTICE-REVIEW.md): record first, one tool-free end review, private previews and explicit acceptance. Run `npm run practice:server`.
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
completed five-talk qualification. The integrated three-input pilot completed with 26 real provider calls, two accepted
visual edits and three exact retained inputs; [pilot evidence](docs/rounds/headless-integration-2026-10-31/README.md)
records its limited successes and the qualifier scoring limitation. Offline actor replay verified all 26 provider
requests, 12 tools and six commits with the exact final source and real browser checks. Replay establishes reproducibility,
not live latency.

The first full edit-heavy baseline and context candidate both ended with blank slides. The candidate additionally had
an unresolved named-target input; durable receipt and canonical integration are distinct. See the
[baseline case](docs/rounds/headless-round-01/cases/edit-heavy-baseline-01-no-visible-generation.md) and
[candidate case](docs/rounds/headless-round-01/cases/edit-heavy-candidate-context-01-anchor-conflict.md).
The implementation through `16a1671` was pushed after typecheck and 302 passing tests
(`.artifacts/environment/pre-push-headless-suite.tap`). The frozen round 02 pair finished with blank output; its
[case](docs/rounds/headless-round-02/cases/edit-heavy-pair-01-bullet-validation.md) identified missing bullet-marker
typography metadata. After that fix, [round 03](docs/rounds/headless-round-03/README.md) produced actual visible edits
but remained unfaithful: Publish was lost, requested edits were missed and one named-target input remained unresolved.
The next combined candidate is pending measurement. Repeated five-talk qualification and verified refactoring remain
unfinished; accepted edits and structural readiness do not establish faithfulness.

Responses requests use `service_tier: "fast"`; provider records distinguish requested and actually returned tiers.
The Decisions endpoint exposes no `service_tier` field, so its policy is recorded as `endpoint-default`, without an
unsupported field or header. Model defaults are Luna for Fast/Decisions and Sol for Slow/specialists; environment
variables `FAST_MODEL`, `DECISION_MODEL`, `SLOW_MODEL` and `SPECIALIST_MODEL` override them. Shared budgets reserve
capacity before concurrent calls. Missing usage remains unknown and charged conservatively. Asset integration stays
provisional.

Frozen runs verify the exported source inventory, unchanged fixture/lock bytes and packaged viewer compatibility.
They execute copied generator code with a common current observer/evaluator. `run-location.json` identifies the nested
run directory; raw evidence is normally under `execution/slide-generation/.artifacts/run/`. Compare matching evaluator
and observer hashes, recorded separately from generator SHA. A frozen export alone is not a measured baseline.

The batch runner defaults to three repetitions of all five talks for both versions (30 sequential runs), alternates pair
order by repetition, records budgets/statuses and keeps failed trials. Review a plan without paid calls first:

```sh
npm run headless:batch -- --baseline .artifacts/baselines/headless-pre-fix --candidate .artifacts/baselines/headless-candidate-16a1671 --out .artifacts/runs/new-comparison --plan-only
```

Remove `--plan-only` to execute within the approved budget. `--fixtures edit-heavy --repetitions 1 --max-runs 2` limits
execution to one pair. Use `--max-calls`, `--max-input-tokens` and `--max-output-tokens` for per-run limits. A single frozen
run uses `headless:run -- --fixture FILE --out NEW_DIR --frozen FROZEN_DIR`; add `--verify-only` for preparation without
model calls. Output directories must be new and under this package's `.artifacts/`.

Offline commands require the actual evidence directory, not its frozen execution container:

```sh
npm run headless:replay -- --run .artifacts/runs/headless-integration-2026-10-31/pilot-01 --out .artifacts/replay/new-pilot-transactions
npm run headless:actor-replay -- --run .artifacts/runs/headless-integration-2026-10-31/pilot-01 --out .artifacts/replay/new-pilot-actors
```

Later passes include `final/deck-contact-sheet.png`: every final live-slide screenshot combined in canonical order with
numbered IDs, using the original captures. It is created after timed observation, with explicit failure if the complete
set is unavailable. Final slide JPEGs and the live viewer timeline remain separate. Generate a sheet for an existing run
without rewriting its artifacts:

```sh
npm run headless:contact-sheet -- --run EXISTING_EVIDENCE_DIR --out .artifacts/review/NEW_CONTACT_SHEET_DIR
```

The standalone command makes no model calls and requires a new output directory outside the original run. See the
[round 03 entire-deck image](.artifacts/review/round03-deck-contact-sheet/deck-contact-sheet.png) and its
[recorded limitations](docs/rounds/headless-round-03/README.md).

Transaction replay checks canonical operations; actor replay additionally checks the actual scheduler/gates and recorded
provider requests without live fallback. Compatibility failures remain failures. For a failed run whose cleanup finished
but report export did not, `headless:run -- --fixture FILE --out FAILED_EVIDENCE_DIR --recover` reconstructs missing reports
offline. It requires original failure/driver/source evidence, refuses existing reports, records recovery provenance and
keeps a failing exit status. It does not resume generation or convert a failed trial into a success.

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
