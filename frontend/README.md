# Talkdeck frontend

A working reconstruction of the approved **main Talkdeck UI** for the SEA x OpenAI Hackathon. The dark, slide-focused design and interactions come from `reference/talkdeck-main-rebuild-prompt.md`; Folio is not mixed into this UI.

All repository work by this team stays within **`frontend/`**. Backend, AI agents, slide generation and serving infrastructure belong to teammates.

## Run locally

Requires Node 22.12+ and npm. From `frontend/`:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:8873**. A fresh browser starts empty. The dev server binds to the local machine; no public deployment is configured. The development process must remain running.

```sh
npm run build       # TypeScript and production bundle
npm run typecheck
npm test            # domain, speech, storage and privacy tests
npm run test:e2e    # Chromium interaction checks; start dev server first
npm run preview     # serve the production build
```

For browser tests, install Chromium once if needed: `npx playwright install chromium`. Node's usual binary on this machine currently has a broken Homebrew library dependency; use `PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run dev` here. No machine settings were modified to work around it.

## Local reference behavior

Browser SpeechRecognition/Web Audio capture real input. Slide generation/edit interpretation and practice proposals currently use **deterministic local rules, not a connected AI service**. Browser speech recognition may send audio to the browser vendor's online speech service. This frontend stores recognized text and project/source data in IndexedDB on this browser origin; it does not store raw microphone audio. Actual microphone, recognition quality and OS permissions require device testing.

Teammate service contracts remain unconfirmed. `src/services/adapters.ts` defines internal frontend ports and a replaceable speech/interpretation adapter; these are not invented backend endpoints or wire contracts. The repository port separates browser persistence from the UI. Do not treat local storage, same-origin audience transport or local heuristics as production architecture.

Audience output is same-origin only. It contains renderable slide content, current table page and output state; private notes, prompts, materials, transcripts and practice records are excluded. It does not provide cross-device collaboration.

## Structure

- `src/domain/` — types, immutable commands, table parsing/editing, practice decisions and guard tests.
- `src/services/` — typed adapters, IndexedDB repository, microphone lifecycle, audience transport and lazy-loaded exports.
- `src/features/` — projects/setup/materials, slide workspace, drawing and review.
- `src/components/` — shared slide renderer, filmstrip, editor, audience and Radix-backed shadcn/ui primitives.
- `src/styles/` — approved main UI tokens/layout and the prompt's unchanged normative slide CSS.
- `tests/browser/` — isolated fixtures and mocked recognizer, never exposed in the production interface.
- `docs/validation.md` — actual checks, visual evidence and remaining limits.
- `docs/integration.md` — teammate decisions and extension boundaries.
- `reference/` — byte-preserved main reconstruction prompt.

Use a modern Chromium browser for the full speech path. The UI handles unavailable/denied recognition without fake transcripts or sample-speech fallback. Other browser/device combinations remain unverified. PPTX contains editable text/table objects and speaker notes; PDF is rasterized. Desktop PowerPoint fidelity is not certified.

To check an already running production preview: `TALKDECK_TEST_URL=http://127.0.0.1:8874 npm run test:e2e` (start `npm run preview -- --port 8874` first).
