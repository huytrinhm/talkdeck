---
name: talkdeck-slide-design
description: Design and refine Talkdeck slides using common visual principles, five style recipes and twenty communication patterns, expressed through canonical JSX. Supports incremental drafting, refinement and end-of-practice proposals.
---

# Talkdeck slide design

Use this skill when composing slides, improving visual explanation, or proposing
design changes after rehearsal. It is guidance, not a new publication mechanism.
Facts, explicit user intent, task scope, and the canonical authoring contract take
precedence over aesthetic preferences.

1. Read [common.md](common.md) and [authoring.md](authoring.md).
2. Read the appropriate mode: [Fast](modes/fast.md), [Slow](modes/slow.md), or
   [practice review](modes/review.md).
3. Use [catalog.json](catalog.json) to choose relevant recipes. Preserve the deck's
   established style. Style names describe possible treatments, not commands to
   replace the theme. Read the chosen files under `styles/` and `patterns/`.
4. Apply relationships through existing primitives/definitions. Pattern IDs such
   as L10 are not registered Layout names. Do not install all patterns as Layouts.
5. Validate and inspect through the host's existing workflow. A valid transaction
   does not prove good visual explanation or factual correctness. Do not publish
   private proposals; the review host requires explicit acceptance.

## Runtime use

The host preloads this skill without giving agents filesystem tools. Fast receives
common guidance, the authoring reference, a compact opening-title recipe, and compact style/pattern indexes. Slow
and practice review receive the full recipes. The current source/theme remains
the authoritative design state; there is no second model-maintained layout graph.
No new Decision API call, skill-retrieval tool or mandatory specialist is added.

The payload has a version and a digest of all skill files. Review records retain
the exact compiled guidance. Headless generation records the complete skill
snapshot for replay; old recordings without skills do not acquire new prompts.

## Provenance and limits

Adapted from the local `presentation-skill-v2` library on 2026-10-31. The five style
and twenty pattern IDs are preserved. Its original HTML examples, screenshots,
research and reports remain untouched and are not runtime dependencies. HTML/SVG
output instructions were removed; canonical capability and incremental-work rules
were added. The original forty-slide study does not validate this JSX adaptation,
streaming latency or full-deck quality. Font/asset integrations remain provisional.

This is a repo-local skill loaded by Talkdeck, not a globally installed assistant skill.
