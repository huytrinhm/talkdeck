# Slide generation implementation rules

- Implement directly on master. Do not create a branch or worktree for this subsystem.
- Keep changes under slide-generation/. Coordinate integrations without editing neighboring subsystems.
- Make multiple focused commits. Before every push, fetch origin and rebase onto origin/master, then run relevant checks
  and push additional commits. Never force-push or amend published commits. If fetch/rebase fails, stop the push.
- SPEC.md is the behavior contract; TECHNICAL.md must accurately distinguish implemented features from scaffold seams.
- Run npm run check and npm test. Never substitute fake browser success for unavailable validation.
- Keep asset/provider integration provisional; do not invent a provider-specific contract outside the resolver boundary.
