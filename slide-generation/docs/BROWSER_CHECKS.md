# Static browser validation

`src/browser/pipeline.ts` exports `BrowserValidationPipeline`. It accepts the real renderer's immutable artifact, and
implements complete-deck `check(source)`, explicit `checkSlides(source, slideIds)`, `screenshot(source, slideIds)`, and
`close()`. `inspect(artifact)` exposes measurement evidence for tests/diagnosis. Screenshots require one to four distinct
slides and return JPEG bytes at exactly 1920x1080 with source/artifact digests. They are never added automatically to an
edit response or model context.

The browser pool limits active contexts (default 2), queued requests (16), and queue/operation time (20 seconds). Rendering/font/asset resolution also has a20-second deadline; a hung resolver cannot wait forever before browser work begins.
Every context uses Chromium, a fixed 1920x1080 viewport and device scale 1, page JavaScript disabled, blocked service
workers/downloads, aborted external requests, and a static-document CSP. Trusted Playwright evaluation measures the
DOM. Animations/transitions are disabled. Exact declared font faces must load successfully; generic fallback does not
count as a font load. Images must decode with positive intrinsic dimensions.

Measurement styles are inserted synchronously through trusted evaluation. Playwright `addStyleTag` waits for an event
that did not arrive with page JavaScript disabled in an actual test; enabling page scripts was not used as a workaround.
The tsx function-name helper is installed as an identity operation by trusted automation for its serialized callbacks.

## Measurements and relative-error magnitudes

All geometry is at design-canvas scale, including cumulative content zoom. The check-policy version is
`browser-checks-v1`, combined with the exact APCA dependency version in evidence. Leaf DOM Text-node Range fragments
represent words once, avoiding the parent/descendant duplicate-text problem. Every text run has its source/expanded
identity, role, computed weight, effective pixel size, foreground alpha, own bounds and containing surfaces.

| Check | Trigger | Quantitative magnitude / independent subject |
|---|---|---|
| overflow, node | Bounds extend >2px beyond canvas | Maximum outward extent in px; subject `canvas:<expanded-id>` |
| overflow, text | Text escapes own/surface/canvas bounds by >0.3em of that measured run | Excess after tolerance in px, separately for each text run and boundary |
| overlap | Distinct leaf text ranges intersect | Summed intersection area in px², separately for each pair of text runs |
| stat-wrap | Stat value occupies multiple lines | Number of extra lines, grouped by the Stat value identity |
| text-size | Effective role floor fails after cumulative zoom; filled-surface text also requires 20px | Missing px, separately per text run |
| contrast | Actual underlying background yields APCA below its 45/60/75 role/weight threshold | Worst Lc deficit over native glyph-covered pixels, separately per text run |
| shape-under | Solid Shape paint intersects native glyph paint | Number of intersecting pixels, separately per Shape/text-run pair |

`Finding.subject` distinguishes independent measurements under the same check/slide/authored node. An improving error
cannot hide a newly introduced or worse error at another boundary/overlap partner. Expanded IDs remain in subjects;
`nodeId` uses the nearest available authored identity. The pipeline does not reuse cached baseline reports.

Typography floors are label20, caption24, body32, lead/subtitle36, heading/quote44, title72, stat112, numeral128,
display max(144,1.5×the deck title scale), hero180. Font-weight>=700 is bold for APCA policy. Adjacent line glyph boxes
can overlap vertically even when a Stat has wrapped, so Stat lines cluster fragment centers rather than treating any
vertical intersection as one line.

## Actual backgrounds and shape silhouettes

A private PNG capture with only text glyph fill hidden preserves actual surface/image/Shape backgrounds and alpha
composition without reflow. A second transparent glyph-coverage mask makes even completely invisible text measurable;
comparing original/background screenshots alone would incorrectly omit its pixels. Background colors are sampled at
all measured glyph-covered pixels, including antialias edges. Secondary text foreground alpha (normally0.75) is
composited over those actual pixels before the pinned APCA calculation.

Each solid Shape gets a separate transparent paint mask. Shape-under uses the intersection of Shape and native glyph
coverage, rather than a rectangle that incorrectly flags the empty center of a ring. These internal captures are
validation data, not explicit screenshot feedback. Temporary masks are removed before capture or page disposal.

Unsupported group-opacity compositing (as opposed to foreground alpha or a transparent leaf) refuses measurement;
the renderer emits secondary text with RGBA foreground alpha. Non-translation CSS matrices also refuse because this
source contract scales with zoom. Measurement is bounded to10,000 rendered nodes,2,000 text runs and12million visited
text-rectangle pixels per slide. Exhausting a bound, missing glyph coverage, an unknown role, corrupt assets, font
failure, browser crash/timeout, or missing stage produces `complete=false`. No incomplete result is cached or promoted
to readiness. Fully clipped/off-canvas text may therefore be unmeasurable as well as geometrically invalid.

Decorative Shape/Rule bleed is explicitly marked by renderer output. It exempts that decorative node's canvas box,
never text geometry. Positive build groups remain in final static layout; presentation hold state is handled by the
viewer. Authored/expanded Pending is collected from the artifact and from DOM markers, including an empty Pending.

## Actual validation evidence

After the environment was restarted with working process/network permissions, normal Chromium launch succeeded.
The earlier syscall denial is recorded in `docs/continuation/browser.md`; it is historical, not a current browser block.

Commands:

- `node --import tsx test/browser.integration.test.ts`:9 actual Chromium tests passed, no skips/mocks.
- `node --import tsx test/browser-policy.test.ts`: 4 pure quantitative-policy controls passed (also in package suite), including same-node Stat value/label overlap.
- `npm run check`: passed after browser implementation.
- An interim package run passed142/143 tests; its only failure was a concurrently changing viewer CSP expectation,
  not a browser-pipeline failure. Root performs final combined verification before commit.

An additional negative test uses a deliberately unresolved renderer and verifies deadline refusal without claiming browser success. The real tests cover a clean slide, all six required failures, alpha backgrounds, invisible text, zoom floors, ring
silhouette negative control, missing font, corrupt image, page-script/network isolation, pool timeout/overflow/browser
crash/recovery, Pending and screenshot limits. A real Hono renderer artifact is measured and explicitly captured with
identical source/artifact digests. The JPEG is decoded independently to verify1920x1080. Local evidence:
`.artifacts/browser/clean-evidence.json`, `clean.jpg`, and `hono-slide.jpg`. The latter was visually inspected: exact
headline/body words and Stat value/label, clear typography and no overlap/overflow. These are subsystem tests, not live-model talks or
an improvement-loop qualification claim.
