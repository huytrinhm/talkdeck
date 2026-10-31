# Talkdeck main UI implementation plan

Goal: reconstruct the approved main prompt as a working, scalable frontend in frontend/ only.
Spec: reference/talkdeck-main-rebuild-prompt.md, unchanged. User has authorized implementation, local serving, checking and direct commit/push.
Architecture: typed domain operations and replaceable service adapters; feature modules for projects, materials, editing, speech, drawing and practice; one shared slide renderer across all modes.
Stack: React/TypeScript/Vite, Radix-backed shadcn/ui primitives, Lucide, IndexedDB local reference adapter; real browser recognition, explicitly local deterministic interpretation. No backend contract invented.

- [x] Domain and adapters: stable identity, clipboard/history, source parsing, persistence failures, immutable review decisions; meaningful unit tests before logic.
- [x] Project dashboard/setup: nested folders, search, duplicate/move, copied text/files and originals, preview and settings.
- [x] Workspace: exact main tokens/renderer, header, filmstrip/context menus/keyboard/drag, transcript/context, modes and live speech capsule.
- [x] Practice/drawing/audience/export: guarded proposals, overview/diff/completion, temporary tool semantics, private output, PPTX and PDF.
- [x] Verification: build/typecheck/unit tests; browser acceptance flows with test-only fixtures/recognizer; rendered desktop and narrow review; document hardware and fidelity limits.
Publication: commit only frontend paths after final validation; refresh remote and use a normal push without rewriting teammate work. The publication receipt is Git history.

Review focus: stale callbacks after navigation; rapid cut/paste focus; stale proposal approval; failed storage preserving working data; private fields excluded from audience transport. Copied fixture content is test-only. New browser always starts empty.

Ruling: preserve approved visual tokens over generic skill palette/landing-page recommendations, which do not fit this application. Keep local prototype behavior as an explicit replaceable adapter, not a production service contract.

Verification details and remaining limitations are recorded in validation.md.
