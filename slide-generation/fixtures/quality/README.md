# Expanded quality fixtures

These separately versioned fixtures extend the original [five timed talks](../talks/README.md). They are authored test
inputs and evaluator expectations, not recorded successes. All content is fictional. The original five fixtures and
frozen measurements are unchanged.

| Fixture | Slides / utterances / expectations | Coverage | Review guide |
|---|---:|---|---|
| [mixed-layout-v1](mixed-layout-v1.json) | 12 / 20 / 68 | Comparisons, timeline, process/branch diagram, metrics, budget grid, dense columns, sparse quote, architecture, shared shapes | [Mixed layouts](../../docs/quality/MIXED_LAYOUT.md) |
| [theme-decoration-v1](theme-decoration-v1.json) | 10 / 32 / 57 | Three palettes, typography/frame changes, Panels/Bands/Rules/Shapes, dedicated icons, incoming-content races | [Themes and decoration](../../docs/quality/THEME_DECORATION.md) |
| [motion-builds-v1](motion-builds-v1.json) | 8 / 26 / 35 | Add/remove/reorder/reparent, retargeting, bounded counting, builds, grouped reveals, slide transitions | [Motion and builds](../../docs/quality/MOTION.md) |

All three passed the existing fixture schema and paced-input validation with zero model calls. Live and browser quality
validation remain pending. Only actual words, IDs and timing enter generation; aliases, expected facts and review guides
are evaluator data. Never count a manual/unsupported assertion as an automatic success.

Use a new output directory and record the exact fixture hash. The current headless runner accepts a fixture path;
the default batch remains the original five talks. Old frozen versions do not contain these new files. Freeze a new baseline containing them before subsequent fixes,
or explicitly implement and verify a common external-fixture bridge for older versions. Do not modify a frozen export
or silently add these files to an existing baseline measurement.

Every later live pass must include the full final deck as one ordered image, original per-slide screenshots and the
visible timeline. Theme changes need phase-specific frames. Motion needs actual browser/video evidence and presentation
controls where the audience differs from the editor. D56 permits bounded intermediate Stat digits as animation; exact
final targets and source claims remain mandatory. Asset/provider integration stays provisional; the budget grid uses
supported native composition and does not introduce a Table primitive or asset service.
