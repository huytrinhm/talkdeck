# Design skill integration

The repo-local [slide-design skill](../skills/slide-design/SKILL.md) adapts the
standalone `presentation-skill-v2` work to canonical JSX. It is enabled by
`createEvaluationHost` and `createPracticeRuntime`. No frontend, new model stage,
Decision API question, retrieval tool, or new publication mechanism was added.

## Contents and role boundaries

| Resource | Purpose |
| --- | --- |
| `common.md` | Fidelity, hierarchy, grouping, legibility and restrained visuals |
| `authoring.md` | Native primitives, definition rules, fonts/assets and capability limits |
| `styles/S01.md`–`S05.md` | Five optional visual treatments; preserve established deck style |
| `patterns/L01.md`–`L20.md` | Twenty communication relationships; not registered Layout names |
| `modes/fast.md` | Incremental additions and stable composition while speech develops |
| `modes/slow.md` | Useful structural refinement without layout churn |
| `modes/review.md` | Evidence-backed, executable private proposals at rehearsal end |

Fast receives common/native guidance, its mode, and a compact style/pattern index.
Slow receives common/native guidance, its mode, and all five style/twenty pattern
recipes. This small bounded library is preloaded, not retrieved with model calls.
The canonical source/theme remains the actual style and layout state; no new
selection metadata or model-maintained design graph is introduced. Skill recipes
never authorize cutting substantive content or overriding an explicit preference.

`JsxBackend` appends compiled guidance to actor instructions, not to the context
used by the Slow decision gate. The Fast decision gate is unchanged. The legacy
HTML backend is unchanged. Embedders constructing `JsxBackend` directly explicitly
opt in by supplying `designSkills: await loadDesignSkills()`; omission preserves
the previous prompt for historical runs and focused tests.

```ts
const designSkills = await loadDesignSkills();
const backend = new JsxBackend(local, { instructions, designSkills });
```

## Practice review

`PracticeService` adds `context.design` with skill name, version, resource digest,
and the exact compiled review guidance. It includes the authoring reference so
the reviewer need not infer available primitives from existing slides. Source,
anchors, notes, images and rehearsal evidence remain the factual context. Pattern
IDs are never valid evidence citations.

The end pass still produces feedback and complete independent native transactions
in one tool-free response. The existing engine fork validates and renders private
previews. A proposal is not applied without acceptance. Unsupported visuals may
receive feedback instead of invented references or invalid JSX.

The design payload is frozen with the review context. Retrying a finalized review
reuses that payload even if deployed skill files change. Older persisted contexts
without a design field remain valid and are not silently upgraded. A new recording
or a new counter-prompt review gets the running backend's skill snapshot.

## Recording and replay

`loadDesignSkills()` reads only the tracked package skill files and validates the
catalog. Snapshots include the exact file bytes, per-file SHA-256 digests and an
ordered inventory digest. Backends compile and copy their instructions once;
caller mutation cannot change an active runtime's guidance.

New headless configurations retain the full `designSkills` snapshot. Prompt
fingerprints include the selected generator's skill loader and resource inventory,
including when running a frozen source copy. Old frozen generators without a skill
loader remain supported. Replays use recorded snapshots, never current recipes;
corrupt snapshots fail before actors run. Recordings without a snapshot retain the
pre-skill behavior. Existing strict provider-request matching still governs actor
replay: a matching skill alone does not establish replay compatibility.

The configuration's existing `promptSha256` continues to describe its base
`instructions`; the overall run fingerprint and `designSkills.sha256` cover the
additional skill files. Actual compiled actor requests remain in provider logs.

## Adaptation decisions

- Removed standalone HTML/CSS/SVG output requirements. No example HTML is imported.
- Kept recipe IDs and content-first relationships. They are not twenty runtime
  definitions; duplicate slot-shape validation still applies.
- Image-led guidance uses contained assets and a separate text region, not overlays.
- Charts/connected diagrams require an available implementation or resolved asset;
  raw SVG and made-up Chart/Diagram tags are not allowed. Readable native text is
  a possible fallback, not evidence that a requested chart has been delivered.
- Style font pairings are intentions, conditional on actual resolved fonts. No
  system fonts, network fonts or fabricated references are introduced.
- Added incremental mode rules and rehearsal evidence/proposal boundaries.
- Original untracked design experiments, HTML examples and gallery remain untouched.

## Verification scope

Tests cover role-specific payloads, snapshot integrity/immutability, unchanged
decision context and tool inventory, legacy opt-out, actual provider request
serialization, and retention of design guidance through review/retry. Existing
practice integration tests still validate proposals with real Chromium, without
automatic publication. These checks establish integration, not improved design
quality, live latency or broad correctness across all twenty patterns.

The original forty standalone HTML examples are not canonical JSX evaluation
results. Font/asset integration and complex native charts/diagrams remain separate
work; no browser-fit success should be interpreted as proof of factual accuracy.

### Verified 2026-10-31

- `npm run check` passed; `npm test` passed all **337** tests. The shipped authoring
  example was also inserted and rendered through the real engine and Chromium.
  Local output: `.artifacts/design-skills-suite.txt`.
- Headless `--verify-only` completed with **zero model calls** and included the new
  resource inventory in its prompt fingerprint. Local output:
  `.artifacts/design-skill-headless-verify.log`.
- One live Sol/medium Responses call, requested and served on Fast tier, reviewed
  a fictional workshop comparison. It returned one feedback item and one native
  `Split`/`Stack` proposal. Every original text string and the existing theme were
  retained; real validation passed and the canonical deck did not change. The
  private JPEG was inspected: both alternatives have matching price/setup rows.
  Usage: 13,047 input + 842 output tokens. This single smoke test is not a quality
  comparison or latency benchmark. No live Fast/Slow drafting trial was run here.
  Local evidence: `.artifacts/design-skill-live-2026-10-31T06-59-28-962Z/`.

For this version, compiled guidance is approximately 1,360 words for Fast and
3,500 for Slow/review. This is prompt size, not measured token usage or inference
latency. All evidence paths above are ignored local artifacts, not required inputs
to the committed tests.
