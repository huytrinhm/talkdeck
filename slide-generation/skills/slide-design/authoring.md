# Canonical authoring boundary

This reference describes the available Talkdeck JSX authoring subset, not React,
HTML or CSS. Use the supplied host instructions, tool contracts and this reference;
do not assume access to repository documents or undocumented props. Editors use
native hashline transactions, never HTML documents, scripts, stylesheets, SVG tags
or arbitrary elements. Specialists return private results only; authoring examples
do not grant source-edit access. Read supplied source and exact anchors. Preserve
IDs of retained/moved nodes; omit IDs on new nodes. Never change system versions, nextId, raw Transcript/Prompt or Archive.
Preserve source facts and substantive wording in notes. SpeakerNotes are editable
only as authorized; source evidence is not.

JSX braces may contain literal numbers, booleans, arrays and typed objects, such as
`cols={2}`, `build={1}` and `freeForm={{reason: 'Comparison composition'}}`.
Write booleans explicitly (`grow={true}`, not bare `grow`).
They may not evaluate variables, arithmetic, functions or calls. No spreads or
fragments. Text children are literal text; quote/escape JSX delimiters as needed.

## Composition vocabulary

- `Slide` is a padded column; ordinary composition uses `Stack`, `Row`, `Grid`,
  `Split`, `Center` and `Spacer`. `Split` has exactly two children and ratios
  `1:1`, `2:1`, `1:2`, `3:2`, `2:3`. `Grid` has 2–6 equal columns.
- Use `gap`/`pad` values `none`, `xs`, `sm`, `md`, `lg`, `xl` where supported.
  Stack/Row accept gap, align, justify and boolean grow (Row also accepts wrap),
  not pad. Slide/Panel/Band accept pad and fill. Stack/Row alignment is `start`,
  `center`, `end`, `stretch`; justification is
  `start`, `center`, `end`, `between`, `around`, `evenly`. Do not infer that every
  node accepts these props: Grid accepts cols/gap/grow, not pad or align.
- `Text` roles: title, subtitle, heading, lead, body, caption, label, display,
  numeral (default body). Text alignment is left/center/right. Supported inline
  bold/italic/code markup stays inside text; no custom font or CSS props. `Bullets` contains Text
  children, marker disc/number/dash/none, size body/lead. `Quote` takes `by` and
  literal quoted words without decorative quotation marks.
- `Stat` is childless with string `value`, optional `label`, size normal/hero and
  left/center/right alignment. Keep units, denominator, period and qualifications
  visible nearby. Do not invent trends or values. Host-approved bounded Stat
  animation is outside this skill; never implement custom animation.
- `Panel` and `Band` group related content, not every sentence. Panel variants are
  fill/outline/ghost; radius none/md/lg. `Rule` uses theme color, length
  short/full/bleed, weight bold/hair, `orient="h"` or `orient="v"`. Bleed Rules
  are Slide-only.
- `Image` is childless: `alt` plus `asset={{id: '...', version: '...'}}` using an
  actually resolved immutable asset. It is contained, not cropped; no image
  overlays, external URLs or invented asset IDs. There is no Chart, Table,
  Diagram, Code, Math or connector primitive. Small tables/processes can use
  aligned native text; precise charts/connected diagrams need an existing valid
  definition or resolved visual asset. Do not fake quantitative geometry.
- `Icon` is childless: `name="resolved-name"`, `catalogVersion="resolved-version"`
  and `alt="meaning"`. Use actual catalog results, never these example placeholders.
  Catalog tools resolve references when available; tool-free review can only use
  known resolved references. No raw SVG paths or stroke overrides. Icons must
  not replace facts.
- `Shape` is optional decoration, at most two directly inside a Slide; kinds
  disc/ring/blob/pill/arc/dots/grid/glow/sparkle, sizes sm/md/lg/xl. Do not use
  decorative shapes as a precision chart or add a mandatory motif.
  It accepts theme-token `fill`, `at="tl|t|tr|l|c|r|bl|b|br"` (choose one),
  `bleed={true}` (or `{false}`) and `opacity="faint|soft|solid"` (choose one).
  For example: `<Shape kind="ring" fill="accent" at="tr" size="lg" opacity="faint"/>`.

Example visual subtree (use only with real supplied content and valid anchors):

```jsx
<Split ratio="1:1" gap="lg">
  <Stack gap="sm">
    <Text role="heading">First alternative</Text>
    <Text>Supplied evidence for the first alternative.</Text>
  </Stack>
  <Stack gap="sm">
    <Text role="heading">Second alternative</Text>
    <Text>Supplied evidence for the second alternative.</Text>
  </Stack>
</Split>
```

Content nodes Text/Stat/Bullets/Quote/Image/Icon accept a theme-token `color` and
optional `transform={{scale: 1.2, translate: [0, 0]}}`. Allowed scales are 0.6, 0.8,
1, 1.2, 1.4, 1.6, 1.8; each translate coordinate is from -0.5 to 0.5. Neither
transform field is required. Other props are node-specific; do not infer CSS props.

## Theme and reusable definitions

Preserve an established or user-specified Theme. The designer may develop a
provisional default into a coherent style when its task permits theme changes;
the content editor's local scope does not. Optional style recipes express intent, not available
fonts or permission to recolor. Colors are Theme Token hex values; visual fill/color
props reference token suffixes such as bg, fg, accent. Text-bearing fill X needs
X-fg. Do not use raw hex on visual props. Font assets must resolve by explicit
version; no system font assumptions, network fonts or invented serif/body tokens.
Role sizes and spacing come from Scale and normalize to readability floors.

Theme may contain one `Frame` and one `Motif` in addition to tokens and Scale:
`<Frame labels={{left: 'Supplied label', footer: 'Supplied footer'}} rule={true} page={true}/>`
adds framing/page furniture (left/right labels up to 48 characters, footer up to 64).
Do not invent labels or provenance. `<Motif kinds={['ring']}/>` declares one or two
allowed shape kinds for consistent decoration. `Slide frame={false}` hides its
frame. These are native capabilities, not arbitrary positioning or chart tools.

Read `list_library` and the selected definition with `read_source` before reuse;
the listing describes shape/dependencies, not exact named slot bindings. If the
provided source/reference does not establish valid syntax, use documented native
composition or report the missing contract rather than inventing a definition.
Runtime Layout/Component definitions live in Library and contain one visual root;
content enters through declared slots, never baked-in user facts. Reuse declared
names only. A layout Slide has exactly one visual child, its instance. Definition
changes affect all dependents. Duplicate Layout slot shapes are rejected even
when their visual arrangement differs. The twenty Lxx patterns are guidance,
not definition names. Free-form Slides require a meaningful `freeForm={{reason:
'...'}}`; retain a valid existing reason. Both authored and expanded visual trees
have maximum depth six. `class` is permitted only inside definitions and only from
the runtime allowlist: retain known-valid existing classes; do not invent utilities.
No arbitrary CSS, positioning or inline style props.

For example, a designer may create this definition in Library, then use the
instance as the Slide's sole visual child (retain Transcript/SpeakerNotes):

```jsx
<Layout name="Headline" description="One headline with supporting text">
  <Slide><Slot name="title" kind="headline"/><Slot name="body" kind="text"/></Slide>
</Layout>
```

```jsx
<Headline>
  <Slot name="title"><Text>Exact supplied headline</Text></Slot>
  <Slot name="body"><Text>Exact supplied supporting text</Text></Slot>
</Headline>
```

These are definition/instance examples, not already registered names. Preserve
existing definitions/slots when reusing them; inspect their source first. A
Component uses the same named Slot binding with a non-Slide visual root such as
Stack or Panel. New definitions and their uses must be valid together.

Do not shrink text below floors, discard content, or silently split a slide to
pass validation. Use the authorized host workflow and report limits. Images and
fonts must resolve; browser checks must complete. Source validation does not prove
faithfulness, and an old screenshot does not prove a proposed edit looks correct.
An accepted draft edit may retain unchanged existing errors or Pending placeholders.
Finishing an activation is not presentation readiness; only a complete-deck
`presentation_readiness` result with `ready: true` certifies its returned revision.
