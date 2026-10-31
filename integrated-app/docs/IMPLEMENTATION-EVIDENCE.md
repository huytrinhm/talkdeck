# Integrated app evidence — 2026-10-31

Started from `bc0ba31` on master; fetched origin before implementation and found
no newer upstream changes. Preview port 3000 initially served the existing
frontend, then switched to the root-level integrated app.

## Implemented

- Project/session ownership, canonical storage, context/material provenance,
  retained PCM and finalized utterances, duplicate-safe receipts, SSE resync,
  epoch boundaries, superseded microphone attachment rejection and accounting.
- Canonical viewer, validated publications, build sequencing/acknowledgments,
  navigation, blackout, fullscreen controls, audience isolation and canonical PDF.
- Practice recording, real end review, private requests/counter-prompts, paired
  prepared images with measured overlays, exact-version acceptance and Undo.
- Dependency-aware preview restaging even when canonical source is unchanged.
- Existing neutral frontend primitives, visible sidebar, transcripts, annotations,
  legacy workspace separation, microphone lifecycle and explicit live practice edits.
- Public ChatGPT Site with a protected gateway to the local canonical backend.

## Completed checks

- `slide-generation`: TypeScript passed; full suite **345/345 passed**.
  Output: `../slide-generation/.artifacts/integrated-final-suite.log`.
- `integrated-app`: client/server TypeScript passed; product/race tests **8/8 passed**.
  Output: `.artifacts/product-final-suite.log`. Production browser build passed.
- Focused viewer tests **15/15 passed**, including real Chromium reveal/back layout
  and issued-build acknowledgment identity. Focused practice/diff checks passed.
- Worker static/proxy checks passed, cross-origin requests refused, secret headers
  stripped, unauthenticated local and public tunnel requests returned403.
- Native Sites deployment succeeded with environment revision1. Public access
  revision2 was explicitly requested by the user. Anonymous Site and API health
  requests both returned200.

## Live evidence and limits

Real provider evidence is retained under
`.data/projects/33b29414-a806-4f02-90c9-79b13beaebb0/providers.jsonl`.
Responses use Fast tier; Decisions and transcription record documented endpoint
exceptions. No hidden model substitution or automatic paid retry was added.

Chromium captured the actual microphone/AudioWorklet/PCM/upload/realtime-ASR path
using a **synthetic prerecorded fixture**, not a physical microphone. This machine
has no ALSA capture device. It retained actual ASR text and generated three
canonical slides using the real configured models. Typed instructions also drove
this live journey; it is not evidence that three slides were created exclusively
from a human speaking into a physical microphone.

The first live attempt exposed a persistent actor-history bug: entering initial
View installed the rehearsal-only instruction but returning to Talk did not
supersede it. Real actors read source then finished without edits. The narrow
mode-boundary fix preserves history and explicitly authorizes new Talk content;
a regression test passed. All original failed-attempt provider logs remain.
The retry displayed three actual slides: Campus library pilot, Collection time,
and A bounded next step. The requested initial dark theme was not honored by
live drafting; end review proposed a validated shared-theme correction.

Present, audience rendering and blackout were exercised. A fullscreen check
sampled before the asynchronous transition completed; final fullscreen success
was not established. Build unit/browser tests passed, but the live journey’s
build0 screenshot sampled the previous slide too early, so that sample is not
proof of live build timing.

A transcript-mode rehearsal produced real feedback and two privately validated
proposals, including a shared-theme change with three affected-slide previews.
No proposal was applied by the live test. Acceptance/Undo/stale/restart/cancellation
passed deterministic real-engine tests, but the remaining live acceptance, Undo,
reload, counter-prompt and narrow-screen verification was **skipped at the user’s
request**. End-pass practice audio ASR was not exercised in this live run.

Individual UI/slide screenshots, review screenshots and recorded motion video
are under `.artifacts/live/`; complete-deck concatenations and additional live
qualification were not completed before the user stopped verification. No latency
or quality-improvement claim is made. Public hosting exposes one shared local
workspace and depends on the running machine/tunnel; independent durable cloud
hosting and multi-user isolation are not established.
