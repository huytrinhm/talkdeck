# Local frontend iteration — 31 October 2026

No changes from this iteration have been committed, pushed or deployed. Scope stays inside frontend/. The main session and workspace are preserved. Independent QA keeps browser ownership until explicit release.

## Implemented locally

- Replaced the original custom-only UI primitive layer with source-adopted official shadcn components. Pinned upstream snapshots, license, hashes and adaptations are in shadcn-adoption/.
- Removed implementation-process prose from Settings and practice overview. Settings now keeps concise microphone privacy information in a closed Voice and privacy disclosure. Useful no-speech guidance and metric estimate labels remain.
- Renamed System prompt to Slide instructions / Instructions in user-facing setup/context. This intentionally follows the newer user direction over the older prompt’s exact wording; the stored systemPrompt field is unchanged.
- Connecting speech uses a visible X/Cancel action; Pause appears only after capture starts.
- Drawing swatches have human color names and selected state. Mark/completion counts use singular/plural grammar.
- Fixed QA’s stale folder validation: dialog-local errors clear on correction, success and dismissal and cannot leak to the dashboard.
- Extracted the voice capsule and transcript into focused feature components. Existing typed domain/service boundaries stay in place; no speculative backend API was added.
- Added a built-static Node serving entry, static-server.mjs, with tested app/audience/asset serving, cache policy, GET/HEAD handling, failure responses, gzip support, health check and graceful shutdown. It reads dist/ only. It does not require a database, proxy backend APIs or expose frontend source/configuration.

## Serving

Run `npm run build`, then `npm start`. HOST defaults to 127.0.0.1 and PORT to 8873. Configure a different PORT if the dev server is already using 8873. Do not replace the shared QA server while another task owns it. No production listener has been started or deployment performed in this iteration.

`npm run dev` remains the local Vite development server. `npm start` serves the build; it is not a claim of cloud hosting, TLS, load testing, backend readiness or a deployed service. Frontend deployment configuration and teammate integrations remain unconfirmed. Credentials, if ever required, belong in server-side environment configuration and must not be bundled into the browser or committed.

## Verification so far

`npm run check` passes: TypeScript, 42 tests in the last full non-browser run, plus three focused dialog/folder tests after the latest focus fix and production build. QA-08 was then reproduced and fixed in the shared Modal composition: Escape and Cancel restore the opener instead of body. The new tests include in-process JSDOM controls/regressions and ephemeral Node HTTP requests; they do not launch or control a browser. Original browser tests have not been rerun while independent QA owns the browser.

Independent visual recheck is requested for all seven handed-off QA findings and the shadcn component migration. Baseline QA images are not post-fix evidence. Hardware speech, connected generation/jobs, load/deployment behavior and full accessibility remain unverified.

## Latest checkpoint

Product source frozen for separate hosted integration; see hosted-handoff/source-ready.json and CONTRACT.md. Latest checks: TypeScript,54 unit/server tests, build,16 development and14 built-server Chromium scenarios pass. Approximately505kB main bundle warning remains. No main-session commit/push/deploy. Main capture browsers are closed and browser ownership explicitly relinquished to parent/independent QA; dev8873 remains available.

Latest review changes include directly visible drawing tools, Pointer reset, named blackout/restore, timed narration cards, label/timer/mobile alignment, audience fullscreen entry visibility, direct theme previews and QR-first service-offer setup with manual fallback. Local phone transport remains unavailable; no real microphone, phone, authentication or OS permission was exercised.

The HTML guide has37 screens,165 controls,30 flows,192 prompt rows and441 hashed screenshot assets. All current actionable controls have before/after capture evidence;12 state/edge groups and physical/service checks remain explicit. Independent final QA is pending.
