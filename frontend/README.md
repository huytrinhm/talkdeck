# Talkdeck frontend

The approved dark, slide-focused main UI, implemented with React, TypeScript, Radix-backed shadcn/ui primitives and Lucide icons. The original specification remains in `reference/talkdeck-main-rebuild-prompt.md`. All work stays inside `frontend/`.

## Run locally

Node22.12+:

```sh
npm ci
npm run dev       # http://127.0.0.1:8873
npm run check     # typecheck, unit tests, production build
npm run test:e2e  # start dev server first
npm run build
npm start         # serves dist only; PORT may override8873
```

On this machine use `PATH=/opt/homebrew/opt/node@22/bin:$PATH` because the default Node installation has a broken shared-library dependency. No machine settings were changed. For browser tests install Chromium with `npx playwright install chromium` if necessary. Tests replace both recognizers and block physical microphones before app load; raw-media tests use synthetic oscillator tracks only. Built-server tests exclude Vite-only adapter fixtures:

```sh
TALKDECK_TEST_URL=http://127.0.0.1:8874 npx playwright test --grep-invert @adapter-fixture
```

## Stable behavior

A fresh browser starts empty. Talk, Practice and Present retain the original slide-focused layout. Direct speech-route entry/reload/back navigation requires a fresh Resume; paused/cancelled/old callbacks cannot create transcript or mutate slides. Saved transcript history is labelled separately. Structural Add creates/selects/focuses a slide with Undo. Manual slide content/theme/layout editing is removed. Drawing annotations, project/source context, presentation, export and explicit review remain. Blackout/Restore is icon-only with accessible names/tooltips/state. Unavailable/empty coach feedback is hidden from the stage.

For this first freeze, App settings exposes useful Preferences only. Companion/coach, Phone input and BYOK screens, controls and sender routes are hidden entirely. The browser does not bootstrap Connections services. Existing internal adapters and their pure unit tests are retained for later wiring; experimental feature UI browser cases are explicitly skipped rather than claimed working. No runtime activation is part of this release.

The transcript renderer is shared by sidebar, presenter and Review: separators appear between phrases, no trailing final-row line or orphan live caret, no whitespace-only live box. Saved content/provenance remains intact. Overview has no premature Done; review decisions and completion remain, and final Done returns to the current project's selected slide. Drawing uses a vertical rail with a roomier swatch/size chooser and lower-right tool arrow; narrow screens wrap the groups and placement clamps around the moved rail.

## Architecture and integration

- `src/domain/`: current frontend Slide/Project model, commands, source parsing and review.
- `src/services/`: typed replaceable adapters, persistence, speech lifecycle, phone/HTTP/key/coach boundaries, audience privacy and lazy exports.
- `src/features/`, `src/components/`, `src/styles/`: main UI and accessible primitives.
- `tests/`: isolated browser/service fixtures, never normal-runtime samples.
- [Integration readiness](docs/integration-readiness.md): pinned teammate contracts, exact missing seams and wiring checklist.
- [Stable corrections](docs/stable-client-checkpoint.md), [phone](docs/phone-input-integration.md), [BYOK](docs/byok-integration.md), [coach](docs/practice-coach-integration.md), [wire v1](docs/connections-wire-v1.md).

The JSX generation subsystem is the intended canonical service; current frontend Slide objects and same-origin audience payloads require an explicit integration adapter. Teammates' orchestration now supports decks and history, but its own handoff says JSX tools/publication are unconnected. No duplicate backend or guessed generation endpoint is added. Unfinished pet/Deep Refine is excluded from the stable release.

Current first-freeze verification and exact source/deployment identities are recorded in the immutable handoff manifest and the final delivery report. Real microphone, provider keys and paid inference are not used in main's tests. Compatibility with the latest published teammate contracts is assessed read-only after the deployed freeze is verified; no automatic integration or GitHub push.
