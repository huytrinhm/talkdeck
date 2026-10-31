# Pinned rendering data

The renderer is a Node/tsx source-distributed service. `src/render/pipeline.ts` hashes its renderer, parser, schema,
expansion and normalization source dependencies; render artifacts also identify exact compiler/contrast versions and
all font, image and catalog byte digests. Runtime HTML contains only referenced icons/images and embedded fonts.

## Lucide

`icons/lucide.json` is the complete static geometry catalog extracted from the locally installed **lucide-react 1.55.0**
package, not a React renderer or a curated list. It has **1,877 canonical icons and 264 aliases**. Metadata available in
that package consists of names and aliases; no tags/descriptions were invented. Runtime uses only JSON literals and
Hono SVG nodes. `LICENSE-LUCIDE.txt` preserves the ISC license and Feather-derived icon MIT notice.

Reproduce from that exact installed package:

```
node scripts/import-lucide.mjs /path/to/lucide-react-1.55.0
```

The Acorn extractor reads data syntax without evaluating package code. Input-module aggregate SHA256:
`dc8ed37197aebf1f8356ff58f5d982b58f29eafabff5270d4627a46052f5bda7`.
Catalog output SHA256: `4dda5661ac24463c3e7f30e6207ecf4ac3b5279ea91ba71dd6a6688e970d5a5a`.
The version is pinned; installing a newer package does not alter existing deck references.

## Fonts

Default Noto Sans regular/bold files are bundled unchanged from Debian's fonts-noto-core package and carry its full
upstream OFL 1.1 notice in `fonts/LICENSE-NOTO.txt`. They are registered as `Talkdeck Noto Sans` at weights 400/700.

- Regular SHA256: `89c3c497f618fdaa0b2d1e98fef93582f28c71debd2c4a8cdf41f190ced2909d`.
- Bold SHA256: `e83493c945848ecd4a9ad0f6d19164541a0d3e23a9c952304a00a46e00272ac5`.

`Theme font={{id,version}}` is the provisional custom-font seam through the injected AssetResolver. Runtime family names
include the byte digest, and the font's declared weight/variable weight range is retained. Native bold/italic synthesis
can supply styles absent from a custom single-face asset; all clients still receive identical source font bytes. Fontkit
checks decoding and coverage before rendering; absent glyphs refuse instead of relying on a host-system fallback.
An explicit font-family token must name the resolved family. Font collections require an explicit individual face.

## Contrast and assets

APCA calculations delegate to exact `apca-w3@0.1.9`, base algorithm 0.0.98G-4g, with signed results and official upstream
reference-vector tests. `APCA-LICENSE.md` retains the upstream notice; the installed npm package also includes its license.
Source: https://github.com/Myndex/apca-w3 . Color compositing and role thresholds are separate from that predictor.

Image/font provider integration remains provisional. References must resolve their exact id/version; renderer instances
reject providers that change a version's bytes. PNG/JPEG/WebP/SVG are embedded and use contain allocation. The resolver
must provide sanitized self-contained SVG: the boundary rejects scripts, foreignObject, animation/event handlers,
external references, entity/doctype declarations, and external/escaped CSS URLs. It does not implement asset management,
OCR, cropping, or a provider-specific storage API. Internal asset typography is reviewed through screenshots.

## Actual verification

`node --import tsx --test test/render.test.ts test/render-browser.test.ts` exercises the complete pinned catalog,
APCA vectors, derived colors, cumulative font floors/source normalization, all primitive rendering, escaped inline text,
real Tailwind utility compilation, font/asset version checks, and actual Chromium inheritance/floor measurements.
`.artifacts/renderer-gallery/representative.jpg` is a real 1920x1080 JPEG; its manifest records dependencies and measured
geometry. It was visually inspected. This is renderer verification, not live-model qualification or an improvement-loop
baseline. Whole-deck edit/readiness checks belong to the browser pipeline and transaction engine.
