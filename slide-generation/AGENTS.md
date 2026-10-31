# Slide generation implementation rules

- Implement directly on master. Do not create a branch or worktree for this subsystem.
- The user explicitly authorized consolidating orchestration/ and slide-generation/ on 2026-10-31. The combined package
  lives in slide-generation/: actors in src/orchestration/, all runtime dependencies in one package/lock, and legacy
  fixtures/docs/tests preserved here. This supersedes the former prohibition on integrating the neighboring actor code.
  Keep subsequent work in this package; frontend integration remains out of scope for the headless harness.
- Make multiple focused commits. Before every push, fetch origin and rebase onto origin/master, then run relevant checks
  and push additional commits. Never force-push or amend published commits. If fetch/rebase fails, stop the push.
- SPEC.md is the behavior contract; TECHNICAL.md must accurately distinguish implemented features from scaffold seams.
- Run npm run check and npm test. Never substitute fake browser success for unavailable validation.
- Keep asset/provider integration provisional; do not invent a provider-specific contract outside the resolver boundary.
- Use Fast mode (`service_tier: "fast"`) for all live model API calls. Keep credentials shell-sourced and read only
  process environment in code. Preserve historical recordings; never rewrite replay requests to add Fast mode.
