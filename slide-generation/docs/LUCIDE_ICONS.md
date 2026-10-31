# Lucide icons: agent access and implementation handoff

Status: implemented in the canonical parser, tools and renderer; the historical scaffold lacked this path. The pinned
catalog contains 1,877 canonical icons and 264 aliases, with full pagination covered by `test/render.test.ts`.
Live-model icon quality and the broader timed-talk qualification are separate from that implementation evidence.
The user chose a dedicated icon primitive,
searchable access to the full catalog, and inherited text color with optional theme-color overrides and no stroke
customization. These choices are settled; do not ask them again.

## Agent interface

Expose two read-only capabilities:

- `search_icons(query, cursor?, limit?)`: search the full pinned catalog by canonical name and available aliases/tags.
  Return canonical names, exact catalogVersion, brief metadata where available, and a continuation cursor. Empty-query
  browsing must be paginated; do not dump the entire catalog into model context or restrict it to a curated subset.
- `read_icon(name, catalogVersion)`: return canonical identity, viewBox, metadata, and trusted SVG data/preview so the agent
  can inspect a candidate. Unknown names/versions return a useful error; do not substitute a different icon silently.

These tools do not mutate the deck. The agent inserts or changes Icon nodes through ordinary node-scoped hashline JSX
transactions. Search is available to generation/editing agents through the host tool registry, not only to developers.
Log discovery calls/results for deterministic replay. Search results and deck references use the same pinned catalog.

Proposed source shape (VERSION_FROM_TOOL is explanatory; the agent must copy the exact returned version):

```jsx
<Row>
  <Icon name="arrow-right" catalogVersion="VERSION_FROM_TOOL" alt="" color="accent" />
  <Text role="body">Next step</Text>
</Row>
```

New nodes omit system IDs; committed nodes have their own IDs. `Icon` has no children. Its specific props are `name`,
`catalogVersion`, and `alt`; it also accepts the existing theme `color`, content `transform`, and rendered-node `build`
props. Do not add width/height, arbitrary CSS color, SVG path, fill, stroke, strokeWidth, or stroke-width controls. The
schema rejects unsupported props rather than ignoring them. Restricted class use in definitions must not bypass this.

Icons inherit the effective foreground of their enclosing context, including Panel/Band text colors. An explicit color
must be a theme token. Retain Lucide's original geometry and stroke width. Scaling follows existing transforms; absence
of a stroke-width override does not mean removing Lucide's outlined strokes. Layout determines the box and preserves
aspect ratio. Default sizing should track surrounding text scale; keep the exact sizing policy in the renderer, not a
new ad-hoc agent control. Use alt="" for decoration and an accessible label when the icon conveys meaning. Never replace
user words with an icon unless the user requested that replacement.

Icon is distinct from generic Image assets and does not implicitly satisfy an image slot. It is valid in ordinary
node containers and reusable definitions; text-only child rules and existing slot accepts still apply. Decorative
icons in definitions do not introduce user text. Runtime SVG path elements are trusted renderer output, not authored JSX
nodes; only the Icon's authored/expanded root participates in source identity and build grouping.

## Backend and rendering

Use a pinned local catalog, such as the individual SVGs from `lucide-static`. Lucide's official static package supplies
SVG files and server-side SVG utilities; it does not require a React renderer. See the [official static guide](https://lucide.dev/guide/static).
Pin an exact dependency/catalog version when implementing, retain upstream license notices, and record the catalog
version/digest in source dependency resolution, caches, and run/replay manifests. Do not change an existing deck's icon
appearance merely because a newer package becomes available; an unavailable pinned version is an error.

Render the selected trusted SVG inline using Hono's renderer so currentColor inherits in the same DOM context. A data-URL
image does not inherit its host element's CSS color; do not accidentally implement that path and claim inheritance.
Generate SVG nodes from the pinned trusted catalog, not agent-supplied markup. No runtime CDN, executable icon component,
client-side icon replacement script, external SVG reference, or icon font is needed. Bundle/emit only referenced SVGs
into a slide; a full searchable backend catalog does not require sending all icons to every viewer.

Use the same catalog data, theme resolution, and resolved icon colors in client/server renders. Theme changes must
invalidate the relevant render/check caches. Native browser checks cover icon bounds and surrounding layout; visual
review checks icon visibility/color/readability. Do not silently expand the existing native-text APCA thresholds into an
unagreed icon-specific contrast policy. Preserve stable IDs through edits, component expansion, reparenting, and builds.

This dedicated catalog does not close the broader provisional image/figure/table/font asset-management API. Keep those
provider decisions separate.

## Implementation checklist

1. Add Icon to parser vocabulary and strict primitive schemas, plus tests for unknown names/versions, forbidden props,
   children, duplicate IDs, and prohibited stroke utilities. The canonical parser now accepts the implemented primitive.
2. Add a pinned catalog adapter and full-catalog search/index/inspection tools with bounded responses and stable pagination.
3. Register the read-only tools with the real generation/editing agents, and version their schemas/prompts for replay.
4. Implement trusted inline rendering, inherited foreground, token override, existing transforms/builds, and accessible labels.
5. Test default/overridden color on light/dark/nested surfaces; fixed strokes; canonical name lookup; identical pinned
   client/server SVG; unavailable versions; safe output; and full-catalog reachability across pages.
6. Add a real-browser gallery/screenshot review and an offline recorded tool-call replay involving search, read, insert,
   re-theme, and reparent. Record actual results before updating capability documentation to say icons are available.
