# Slide generation, manipulation, and rendering specification

Status: agreed design, 2026-10-31. This document replaces the former workspace `SPEC.md`.
The scaffold's implementation status is recorded in `TECHNICAL.md`; requirements here are not claims of completion.

## 1. Scope and implementation constraints

The subsystem generates, edits, validates, and renders slide decks. Implement it in `talkdeck/slide-generation/`,
directly on `master`. Keep all implementation, tests, package configuration, and documentation inside that directory.
Before **every push**, fetch and rebase onto `origin/master`, then push additional commits. Never force-push or rewrite
published commits. Resolve conflicts only in scope; do not modify adjacent frontend/orchestration implementations.

Required stack: TypeScript, Hono backend, Hono JSX rendering, acorn + acorn-jsx parsing, Zod schemas,
Tailwind v4 compilation, and Playwright Chromium measurement/screenshots. JSX is a data language, never executable code.

## 2. Canonical representation

A JSON deck file stores one canonical `source` string containing the entire JSX deck. Theme, library, slides,
speaker notes, raw transcripts, brief, and archives live in that source. Parsed trees, indexes, hashes, expansion,
HTML, CSS, screenshots, and diagnostics are derived. Envelope format/schema metadata is allowed; it must not duplicate
editable slide state. System versions and provenance are represented in source and maintained by the system.

The system bootstraps a minimal valid deck with a bundled default theme, an empty library, one empty slide,
empty notes/transcript, and an archive. Further generation uses the same node-scoped editing interface as later edits.

Illustrative source (IDs are system-assigned; this example supplies them to show persisted form):

```jsx
<Deck id="n1" version={1}>
  <Brief id="n2">Audience, purpose, narrative, design decisions.</Brief>
  <Theme id="n3">
    <Token id="n4" name="--color-bg" value="#fafafa" />
    <Token id="n5" name="--color-fg" value="#18181b" />
    <Token id="n6" name="--color-accent" value="#0f766e" />
    <Token id="n7" name="--color-accent-fg" value="#ffffff" />
    <Scale id="n8" text={{ title: 88, body: 32 }} space={{ md: 40, xl: 96 }} />
    <Frame id="n9" labels={{ left: 'Acme', right: 'Q3', footer: '' }} rule={true} page={true} />
  </Theme>
  <Library id="n10" />
  <Slide id="n11" version={1} freeForm={{ reason: 'Initial composition' }}>
    <Transcript id="n12"><Prompt id="n13" mode="add">Revenue grew 42%.</Prompt></Transcript>
    <SpeakerNotes id="n14">Revenue grew 42%.</SpeakerNotes>
    <Text id="t15" role="title">Revenue</Text>
    <Stat id="s16" value="42%" label="growth" build={1} />
  </Slide>
  <Archive id="n17" />
</Deck>
```

### 2.1 Safe literal grammar

Parse exactly one root `Deck` element. Known primitive/metadata tags and declared layout/component names only.
Accept string, finite number, and boolean literals. Typed object props and arrays of literal data are allowed where
the owning Zod schema permits them (for example scale maps, versioned asset references, and transform vectors).
Objects are static data: no computed keys, shorthand properties, methods, getters, spreads, prototype keys,
identifiers as values, calls, member access, operators, template literals, JSX expressions as content, or functions.
A negative numeric literal may be represented by unary minus on a numeric literal only. Reject null unless a future
specific schema explicitly permits it. Duplicate attributes/object keys are errors. No fragments or executable code.
Decode only supported JSX/XML entities; unknown or malformed entities are errors. HTML-style comments are not JSX
and are not part of the source language. Report the construct and nearest available node ID on failure.

Prefer typed object props for structured data rather than comma-delimited strings or CSS-like mini-languages.
Objects are validated recursively with strict schemas; this allowance never authorizes evaluating JavaScript.

### 2.2 Identity and ownership

Every element node has a deck-wide unique ID, including metadata, notes, library definitions, and nodes within them.
Text strings inside elements are not separate element nodes. IDs never have special content-reference semantics.
`<Text id="t15" />` is an empty element, not retrieval or movement of old words.

New nodes omit IDs; the system assigns a tag letter plus a monotonically allocated number and writes it into source.
Use t: Text/Badge, s: Stat, b: Bullets, q: Quote, i: Image, p: Panel/Band, d: Shape, c: definition instances, n: others.
IDs are never reused, including after archival/deletion. Reject duplicate IDs; do not silently rename duplicates.
Existing IDs, versions, allocation bookkeeping, and provenance are system-managed. Reject direct modification or
forgery. Existing JSX may move with its unchanged ID. A wording edit retains the element ID.

Definition expansion creates structural IDs derived from the instance ID plus definition-node ID. Nested instance
paths and repeated-item identity participate, so repeated structures cannot collide. Slotted content retains its ID.
Keep authored and derived-ID namespaces disjoint. Runtime expansion does not insert expanded nodes into source.

## 3. Notes, transcripts, and archives

Every slide maintains cleaned speaker notes and the unaltered original user prompts. Notes preserve substantive
original wording; only fillers, false starts, and redundant repetition may be removed. Do not paraphrase facts,
qualifications, or intent. Raw transcripts are system-owned append-only evidence, including corrections as new events.
Notes are agent-editable JSX text, kept alongside slides and returned by `read_speaker_notes(slideId)` together with
the raw transcript and revision, enabling the agent to verify completeness.

Removing rendered content must not erase its user source from notes/transcript. Hidden content storage is removed;
there is no automatic layout substitution, hiding, or free-form fallback. A refused edit leaves source unchanged and
the editing agent chooses its next transaction. Deleting a slide atomically archives its notes and transcript at deck
level, retaining their IDs and association with the deleted slide. Archive evidence cannot be erased by agent edits.
No runtime semantic model judge attempts to prove that a summary preserved meaning; fidelity is agent responsibility,
with raw input retained for verification. Capturing user input is a trusted ingestion operation, not an alternative
agent editing API.

## 4. Theme and typography

Tokens use `--(color|font|text|radius|shadow|spacing|tracking)-<name>`. Colors are hex; font-weight tokens use N00;
tracking uses numeric em values. Reject values containing `;{}<>`. `--font-display` is forbidden, while
`--font-weight-display` and `--tracking-display` default to 700 and -0.02em.
Required colors: bg, fg, accent, accent-fg. The base bg uses fg. Every other text-bearing fill X must have X-fg.

When omitted, derive bg-alt by moving bg 5% toward fg, muted by moving fg 35% toward bg, accent-2 by rotating accent
hue 150 degrees, and inverse from fg. Select each derived fill's foreground from palette text colors and adjust the
**derived** fill lighter/darker until body text reaches APCA |Lc| >= 60. Do not silently change explicit brand colors.
An unreadable existing override after a palette change refuses the transaction; report affected IDs for an agent fix.

Fonts are resolved through the shared asset system using explicit versions, with a bundled default font. Client and
server receive identical font bytes and wait for fonts before measurement/capture. Font package and asset API details
remain provisional. Do not rely on different host system fonts for matching line breaks. Named pairing presets may
map to bundled/resolved families rather than system-only stacks.

Text steps: title, subtitle, heading, body, caption, label, stat, hero, quote, display, numeral, lead.
Space steps: xs, sm, md, lg, xl. Per-deck scale values are normalized up to floors:

| Step | Effective rendered floor (px) |
|---|---:|
| label | 20 |
| caption | 24 |
| body | 32 |
| lead, subtitle | 36 |
| heading, quote | 44 |
| title | 72 |
| stat | 112 |
| numeral | 128 |
| display | max(144, 1.5 × title) |
| hero | 180 |

Floors apply **after cumulative content scaling**, measured at the 1920x1080 design canvas (not viewer-fit scale).
Normalize base typography so the requested supported scale cannot produce text below its role floor, and write the
normalized representation back. Slot roles/sizes similarly normalize stored props to what is actually drawn.

Frame: typed labels `{left, right, footer}`, rule, and page settings. Retain existing frame label limits of 48/48/64
characters unless deliberately revised; these are independent of removed slot and Stat limits. It occupies a reserved
margin band on every slide except `frame={false}`. Frame metadata has an ID but is not slide content; rendered copies
receive distinct derived IDs. Page numbering follows current deck position. Motif selects one or two reusable Shape kinds.

## 5. Primitive vocabulary

Each primitive has a strict Zod prop schema and declared child rules (none, text, nodes, or Text items), plus applicable
child-count constraints. `gap`/`pad`: none, xs, sm, md, lg, xl. Fill/color refer to theme tokens. Every rendered node may
have a nonnegative integer `build`. Metadata is never rendered as slide content.

| Primitive | Props / behavior |
|---|---|
| Stack | gap, align, justify, grow; column |
| Row | gap, align, justify, wrap, grow |
| Grid | cols 2–6, gap, grow; equal cells |
| Split | ratio 1:1, 2:1, 1:2, 3:2, 2:3; gap, align, grow; exactly two children |
| Center | gap; centered in remaining space |
| Spacer | no styling props; consumes space between siblings |
| Panel | fill, variant fill/outline/ghost, pad, gap, radius none/md/lg, align, justify, grow |
| Band | fill, pad, gap, align, justify, grow; full-width strip |
| Text | role title/subtitle/heading/lead/body/caption/label/display/numeral; align; inline bold/italic/code |
| Stat | value, label, size normal/hero, align; no character cap; value must not wrap |
| Bullets | marker disc/number/dash/none, size body/lead; Text children; <=3 points outside cards default to lead |
| Quote | by; body contains quoted words without quotation marks |
| Image | alt and typed versioned asset reference; automatic box allocation; contain only |
| Icon | dedicated Lucide SVG; name, catalogVersion, alt, optional theme color and transform; no children or stroke overrides |
| Rule | color, length short/full/bleed, weight bold/hair, orient h/v |
| Badge | fill; tag text |
| Shape | kind disc/ring/blob/pill/arc/dots/grid/glow/sparkle; fill, at tl/t/tr/l/c/r/bl/b/br, size sm/md/lg/xl, bleed, opacity faint/soft/solid |
| Slide | fill, pad, gap, align, justify, frame; padded column clear of frame band |
| Pending | kind; editor shimmer and warning; must be resolved before presentation |
| Slot | name, kind, role, optional, accepts; one child, no maxChars |
| Each | slot, kind, min, max (default 8); repeats wrapper per slotted item |
| Item | current item inside Each |
| Index | size, look, color; derived item numbering, not authored content |

Shapes are directly in Slide only, at most two, drawn behind content. Bleed Rules are directly in Slide only.
Tree depth is at most six in **both authored and expanded visual trees**; component nesting is independently capped at
six, with cycles rejected. Count a visual Slide root as depth one; Deck/Theme/Library/evidence envelopes do not consume
visual depth. Definitions are checked from their visual root. Metadata literal nesting has separate parser resource limits.

Content nodes and Icon support ad-hoc overrides: theme color and typed transform `{scale, translate: [x,y]}`. Scale is one of
0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8; translation components within +/-0.5 of the node's own box. Render scale using zoom
so neighbors reflow. All effective font floors remain enforced. Asset transforms use the same mechanism.

`class` is permitted only inside Layout/Component definitions. Lint against an explicit allowlist of layout and
decoration utilities on scale steps; reject arbitrary values, text-size utilities, and text/background color utilities.
For Icon, also reject utilities that override SVG strokes; definition classes cannot bypass its fixed stroke policy.

### 5.1 Lucide icon access

Agents have searchable access to the **full Lucide SVG catalog**, not just a curated prompt list. Use the dedicated
`Icon` primitive rather than Image references, raw SVG markup, or executable framework components. Resolve `name` against
an explicitly pinned `catalogVersion`; discovery tools return both. Unknown names/versions refuse validation.

Icons inherit the effective surrounding text color, including surface foregrounds. An optional `color` refers to a
theme token. Keep Lucide's bundled stroke geometry and width: no stroke, strokeWidth, fill, path, or equivalent styling
overrides. Layout allocates the box; preserve the viewBox/aspect ratio and use the existing transform rules for ad-hoc
adjustments. Every Icon has the standard system ID and supports build groups and stable animation identity.

Render trusted catalog SVG inline through Hono so currentColor inherits correctly, with identical pinned data in both
renderers and no runtime CDN requests. Agent-authored raw SVG is still outside the source grammar. A decorative icon
uses empty alt; a meaningful icon has an accessible label and must not replace user-provided words silently. Icon remains
a visual primitive, not an alias for Image or a new image slot kind. It can appear in definitions and ordinary node
containers; existing text-only/slot contracts still apply. Detailed implementation handoff: [Lucide icons](docs/LUCIDE_ICONS.md).

## 6. Layouts and components

Layout has name, description, system version, and one visual root. Component is an inner reusable piece with the same
metadata. Definitions contain no user content: words enter through slots. Static metadata is not visible content.
A layout slide has exactly one **visual** child, the layout instance; notes/transcript metadata are excluded from this
count. A layout root Slide supplies the instance slide's ground, padding, and frame behavior.

References resolve only to declared Layout/Component names and validate on every edit: existence, unique names,
category/placement, cycles, nesting, slots, and props. There is no separate template concept. Slides always use the
latest definition; definitions are not version-pinned. This differs intentionally from explicit asset version references.

| Slot kind | Accepted nodes | Drawn role / size |
|---|---|---|
| headline | Text | title |
| subtitle | Text | subtitle |
| kicker | Text, Badge | label |
| heading | Text | heading |
| supporting, points | Text, Bullets | body |
| presenter | Text | body |
| meta | Text | caption |
| metric | Stat | normal |
| hero-metric | Stat | hero |
| quote | Quote | unchanged |
| image | Image | unchanged |

Inner components may use content kinds text/stat/bullets/quote/image/any. `accepts` replaces accepted tags and `role`
overrides drawn role. Slot styling wins over supplied content styling and automatically normalizes source. No text
character caps: use browser fit checks. Structural item-count limits remain. Missing required slots and Each shortages
create Pending nodes and warnings; they do not block draft edits. Excess items/type mismatches are errors.

Reject a new layout with the same slot shape (kinds/counts, ignoring names) as an existing layout, even if visual
arrangement differs. Free-form slides retain an agent-written reason in typed metadata; it does not expire after
unrelated edits. Updating a definition validates all transitively dependent slides atomically. The agent may include
repairs to those slides in the same transaction. No automatic `apply_layout` mapping tool remains.

## 7. Unified hashline editing

All agent mutations use one interface: JSX hashline editing within an identified node. This includes brief, theme,
layouts/components, slide content, cleaned notes, and free-form reason. Remove edit(old,new), insert, replace, remove,
set_props, set_text, style, pending, apply_layout, unhide, set_tokens/scale/frame/motif, upsert_component, set_free_form,
and repair as separate agent mutation tools. Trusted bootstrap/input ingestion/system bookkeeping are not agent edits.

### 7.1 Read contract

`read_source(nodeId)` returns node JSX with source range, snapshot ID, and numbered lines each carrying a full content
hash. The server stores the exact issued snapshot; agents copy hashes rather than computing them. Normalize source
line endings to LF at ingestion, but never trim or normalize line contents for matching. The node root itself can be
addressed, including a Slide root or the Deck root. Prefer multiple granular edits per transaction over large rewrites.

### 7.2 Transaction contract

`edit_source({edits})` accepts multiple node scopes and replace/delete/insert-before/insert-after operations in one
transaction. Each range identifies the originating snapshot and **every** affected line hash, not just endpoints.
Insertions validate the anchor and adjacent gap context to avoid inserting at a changed boundary. Replacement text is
literal JSX source; empty replacement deletes the addressed range. The parent can be targeted to remove a node.

Resolve all edits against the same current source before applying any. When line positions drift, search **only within
the selected node** for the entire exact snapshot range; relocate only if it matches uniquely. Check hashes plus exact
stored text, not hashes alone. Reject missing, ambiguous, changed, unseen, or overlapping targets, including overlap
between ancestor/descendant scopes. Unrelated changes do not invalidate untouched ranges. Whole-slide rewrites are
allowed but discouraged. Never guess, use fuzzy matching, or recover content through an ID-only empty element.

Stage edits in memory. Parse; enforce system-field ownership and content evidence preservation; assign IDs; normalize;
resolve/expand references; run structure and render validation; run all browser checks for all affected slides. Validate
the latest shared theme/library dependencies, not merely the snapshot used to author the patch. Under a commit lock or
compare-and-swap, ensure the validated source/dependencies are still current; otherwise retry against current source or
refuse. Source, IDs, versions, notes archival, and validation evidence commit together. Nothing partial is observable.

Accepted: return affected IDs, normalized source with fresh hashes, versions, and warnings. Refused: unchanged source,
error codes, relevant node IDs, fresh read context where useful, and suggested fixes. Never silently repair source beyond
specified normalization. Parse/structure failures, unavailable checks, browser crashes/timeouts, and new/worsened errors
refuse the edit. The agent chooses another layout or correction itself.

### 7.3 Read-only tools

- `read_source(nodeId)`: anchored source; convenience scopes may resolve deck/theme/library/slide IDs.
- `read_speaker_notes(slideId)`: full cleaned notes, original transcript, revision, archived association when applicable.
- `list_library()`: descriptions, slot kinds/counts, versions, and dependent slides; no character budgets.
- `search_icons(query, cursor?, limit?)`: search the full pinned Lucide catalog, returning canonical names, versions, and pagination.
- `read_icon(name, catalogVersion)`: inspect catalog metadata and a trusted SVG preview; read-only, with no slide mutation.
- `palette_report()`: readable foreground for each fill, APCA |Lc| >= 45, plus role-specific thresholds.
- `render(slideId)`: normalized HTML/CSS for a final layout; rendering alone is not validation.
- `check(slideIds)`: structural and browser findings; deterministic suggested corrections, never mutations.
- `screenshot(slideIds)`: explicitly requested JPEG screenshots at **1920x1080**, at most four per call; no automatic captures returned after edits.
- `presentation_readiness()`: complete-deck validation, including pending state and existing errors.

## 8. Validation and agent guidance

Validate against the current committed baseline using (check, slide ID, node ID) and comparable severity/measurement.
Unchanged existing errors may remain during draft edits; reject new or worsened errors. Never treat an unrun check as
passing or as an existing issue. Missing dependencies or invalid source that prevents validation cannot be grandfathered.
Presentation readiness requires **every slide** to have no blocking error, including existing errors, and no Pending.

Structure checks: strict props and child rules, theme token existence/pairs, class allowlist, both depth limits, global
ID uniqueness, reference/slot contracts, layout root placement, Shape/bleed constraints, protected fields, and required
raw-source preservation. Definition edits include every transitive dependent; theme/font edits include every affected slide.

Browser checks run against the final 1920x1080 layout, after fonts/assets resolve, never intermediate animation frames:

| Check | Failure |
|---|---|
| overflow | Canvas overflow >2px; text escaping its own box, card, or canvas beyond 0.3em of largest font |
| overlap | Distinct content text boxes intersect; avoid counting parent/descendant representation of the same text twice |
| stat-wrap | Stat value occupies more than one line |
| contrast | APCA |Lc| below 45 for >=36px or >=24px bold, 60 for >=24px or bold, 75 otherwise |
| text-size | Effective role floor violated; text on filled panel/band below 20px |
| shape-under | Solid Shape behind content text |

Composite text over all actual underlying backgrounds; measure secondary text at 75% opacity. Asset-contained text is
reviewed through screenshots only. Native checks may still validate asset box bounds and reference resolution.

Editorial patterns are **agent prompt guidance only**, not runtime hard errors or model-judge checks: avoid repeated
text/opening-slide repetition, truncated sentences, meta commentary, quotation titles, panels around one line,
centered lists, neon grounds, repeated numbers, and invented numbers. Preserve the user's facts and qualifiers.
Prompt the agent to consult notes/transcripts, prefer granular transactions, review screenshots explicitly, and resolve
all pending slots before presentation. No autonomous repair tool.

## 9. Rendering, builds, and animation

Pipeline: parse safe data -> validate/normalize -> expand -> Hono JSX -> Tailwind v4 CSS -> isolated client or Chromium.
Render context carries underlying fill, resolved foreground, frame/page, pending state, card/list context, and build
visibility. Elements expose data-node, applicable data-content and data-component, classes, and safe transform styles.
Errors carry nearest authored node ID; derived nodes map back to definition and instance owners.

Clear Tailwind default color/font tokens; compile only approved theme/scale utilities in trusted backend/parent.
Canvas is always 1920x1080, scaled as a whole to fit the viewer without responsive rearrangement. Frame margin band is
reserved. Definition-root Slides replace the instance root visually, not the source's notes/transcript container.

### 9.1 Presentation builds

`build={n}` on any rendered node defines an explicit agent-authored group. Unmarked nodes are visible immediately;
positive groups reveal in ascending order, equal values reveal together. Zero is initially visible. A hidden parent
also hides descendants; a descendant can reveal only once both its own and ancestor groups have been reached.
Nodes keep their final geometry while unrevealed. Build attributes on definitions/instances follow expansion ownership;
slotted authored content retains its explicit group. Preserve identity across moves and builds. No transcript/born-based
build ordering remains. Keep raw transcript provenance for evidence, not as build scheduling.

Before presentation, the agent must fill Pending, remove optional/unneeded structures, or select a layout without them.
Block entering presentation until complete-deck readiness passes. A presentation session should use a validated revision;
any newly published revision must pass the same readiness gate before becoming presentation state.

### 9.2 Client isolation and motion

Sandbox iframe uses `sandbox="allow-scripts"`, never allow-same-origin. A nonce CSP permits only the owned animation
script; deny external network. Embedded asset/font bytes are permitted by narrowly scoped data/blob policies. The
parent sends HTML, CSS, slide key, animation settings, and build hold IDs through a validated postMessage channel.

Keep all specified animations: same-parent FLIP movement/resizing, color transitions, entrances, exits, reparenting
morphs/view transitions, numeric Stat counting, and slide-key crossfades. Spring motion retargets from current visual
position and velocity when subsequent validated states arrive; do not queue obsolete target states. Only movement may
overshoot. Clamp sizes, colors, opacity, and Stat interpolation to their valid ranges/endpoints. Nonnumeric Stat strings
transition as text. Per D56, intermediate bounded counting digits are animation rather than factual claims; preserve
exact source endpoints and record intermediate frames. This exception does not permit invented model-authored numbers.
Visible-correct timing requires the exact requested target value to appear. Once settled, remove transient wrappers/styles so the DOM matches posted HTML, apart from explicit
presentation hold state managed by the viewer. Reduced-motion support is deferred, including a full motion policy.

### 9.3 Server

Playwright Chromium renders identical HTML/CSS/fonts/assets at 1920x1080. Page-authored JavaScript is disabled and
external network requests are aborted. Trusted automation measures the static page. Wait for fonts and images before
measurement and capture. Checks are mandatory for edits; screenshots are a separate explicitly invoked feedback tool
and also use 1920x1080. Browser/check unavailability refuses edits and readiness.

## 10. Provisional asset integration

Keep this integration open for future changes. Assets are finished visuals (PNG/JPEG/WebP/SVG), not native editable
charts/tables. Version references are explicit; updates never silently change existing slides. Ingestion sanitizes SVG
and resolves external dependencies before embedding. Layout automatically allocates the asset box; contain only, no
cover/cropping or ad-hoc width/height/aspect controls. Content transforms remain available. Font assets use shared bytes
and explicit versions, with a bundled default. Do not implement asset management inside this subsystem or hard-code
storage/provider assumptions. Inject a resolver; unresolved references refuse validation. Internal visual readability is
agent screenshot review. Exact reference schema/provider API and bundled font package remain integration decisions.
