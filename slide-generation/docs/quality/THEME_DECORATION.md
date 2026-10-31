# Theme, decoration, and motion quality fixture v1

Status: authored and schema-validated; **not run with models or browsers**. This is a separately versioned expanded-quality fixture, not a replacement for any of the existing five talks. The in-flight breadth batch and its original fixtures/recordings are unchanged.

Fixture: [theme-decoration-v1.json](../../fixtures/quality/theme-decoration-v1.json). It contains 10 slides, 32 paced utterances and 57 expectations. At 2.8 words/second, the final utterance ends at 376,229 ms. Its final 15-second silence and 15-second observation period end at 406,229 ms; a further drain is bounded to 120 seconds. Preserve that pacing in primary measurements. Zero paid calls were made while authoring it.

## Compositions and temporal theme phases

| Slide | Authored content/composition | Main visual pressure |
|---|---|---|
| Signals and space | Sparse opener and exact subtitle | Short Rule, faint ring Shape, later larger title |
| Readiness pair | Ready/Waiting headings with distinct exact sentences | Two equal Panels, later swap positions while preserving associations |
| Handoff flow | Receive / Check / Send, then Confirm | Horizontal icon/label groups, inheritance and one theme override, build changes |
| Operating notes | Six full sentences in two columns | Dense composition without dropped words, readable shared scale |
| Practice window | Practice time: 25 → 30 → 28 minutes, exact qualification | Large Stat, correction latency, bounded counting |
| One voice | Exact Mara quotation | Sparse Quote, byline and open space without an empty panel |
| Review pair | Observed/Unobserved headings and exact sentences | Reuse the comparison design without duplicate slot shapes |
| Review lenses | Accent heading Band, four-caption Grid | Icons on page/Band surfaces; caption reparented from Band to below Grid |
| A quiet signal | One exact sentence | Short Rule, faint dots Shape, intentional whitespace |
| Leave a clear next step | Exact title, main sentence and caption | Sparse ending; local decoration removal without other-slide changes |

Three global palettes occur within one talk: warm ivory/charcoal/deep teal; dark navy/light text/warm amber; then high-key white/near-black/restrained blue. Each re-theme is followed by incoming content or a positional edit without waiting for generation. Pauses before and after selected changes allow actual visual review of earlier phases; the final contact sheet alone will show only the final state.

The running frame starts Studio rehearsal / Draft review with page numbers and a fine rule, then changes to Studio rehearsal / Final review. A later shared type-scale request sets title 96px, body 36px and caption 24px; the opening title subsequently becomes larger than that shared title scale. All phases retain the bundled font. Exact original text, units and qualifications must survive color/scale/frame changes.

## Supported primitives and explicit boundaries

The fixture uses existing native capabilities: Text, Stat, Quote, Row/Stack/Grid or Split, Panel, Band, Rule, Shape, dedicated Icon, shared definitions and build groups. Decoration requests use only ring and dots motifs, staying within the current two-kind theme motif vocabulary. Faint Shapes must not obstruct content. The comparison panels are requested content groupings; the sparse quote/ending should not acquire empty decorative panels.

Icons are dedicated Lucide nodes. Spoken input explicitly requests full-catalog search for named/suitable icons, foreground inheritance, an accent-token override only for the confirmation icon, and an inherited eye icon inside the heading Band. Record search/read calls and actual catalog references. Preserve catalog geometry and strokes; no custom stroke width/color, authored SVG, emoji substitution or replacement of words by icons is requested. See [Lucide contract](../LUCIDE_ICONS.md).

No image/table/chart/font provider is introduced. No external asset is required, and no provisional asset API is treated as settled. This fixture complements the separate mixed-layout proposal; it does not claim to cover unsupported native tables or arbitrary graph connectors.

## Automatic evidence versus required review

The existing schema/evaluator can check eligible exact native text, exact Stat labels/values, the two corrections, quotation/byline, source retention, slide count and final readiness. These require actual corresponding frames; private notes or an offscreen final image cannot satisfy visible timing. Earlier values superseded before display remain censored misses. Current whole-node matching can miss intact phrases embedded in a longer node; preserve raw scores and document such cases separately rather than changing assertions after a run.

The following are intentionally explicit manual-review expectations using existing `theme`, `frame`, `style_target`, `layout_family`, `consistent_pair`, `unchanged_except`, `relative_position`, `sparse_design`, `build_order`, `build_groups` and `no_churn` kinds. They must not be silently counted as automatic successes:

- Inspect the entire final deck contact sheet plus phase-specific original screenshots/video. Check all three palette phases, correct foregrounds on Panel/Band surfaces, late stale-theme reversion and preservation of all words/order.
- Verify actual frame labels/page sequence and type-scale hierarchy across slides. Use real native measurements for fit/contrast; inspect layout and decorative balance manually. A successful readiness report does not establish design quality.
- Inspect authored/expanded Icon references, discovery results, inherited effective colors and the single explicit theme override. In particular, verify the heading-band eye icon inherits that surface's foreground after both theme switches. Unknown or missing icons remain failures.
- Compare Readiness pair and Review pair: shared structure/design, no duplicate equivalent layout, correct sentence ownership after swapping Panels. Verify complete dense-column sentences and unchanged quote/byline.
- Review motion from actual publications: panel movement, caption reparenting, title resizing, palette transitions, entrances/exits and slide crossfades. Inspect stable node identities and settled DOM; do not infer motion quality from before/after JPEGs.
- For the Stat, preserve exact 25/30/28-minute endpoints and label/caption. D56 allows bounded intermediate digits as animation; correct-visible timing still waits for the requested exact endpoint. Do not invent extra figures or claim an interruption occurred unless frames/acknowledgments demonstrate one.
- Verify the first three-step reveal order, then the requested two groups Receive+Check and Send+Confirm. Icons and labels must reveal together, final geometry must remain reserved, and ancestor gating must hold. The current live harness lacks a separate simultaneous audience reveal session: until exercised, those checks remain unsupported/manual misses, not a pass based only on `build` attributes.
- During final silence, distinguish justified unfinished work from unsolicited later changes. An incomplete deck that stops changing is not successful stability.

## Evaluation isolation and execution

Only `initialContext` and the existing `spokenInput(event)` projection may reach generation. Semantic aliases, expected strings, layout families, final slide order and this review checklist are evaluator-only. Aliases must bind from validated actual creation evidence, never from a later wrong route. The fixture's labels are not an input-controller answer key.

Do not add this file to the current five-talk batch retroactively. A future explicitly configured run can use `headless:run --fixture fixtures/quality/theme-decoration-v1.json` with a new output directory, frozen source/dependencies and a recorded budget. The batch CLI currently resolves its normal fixture list under `fixtures/talks/`; this separate quality fixture is not automatically included. Plan any expanded runner change separately.

Before qualification, use matched versions with the same fixture bytes/observer/evaluator, fresh sessions, repeated runs and a whole-deck contact sheet for every completed capture set. Retain missing/censored expectations, failures, raw previous frames and all provider usage. At least one independent visual reviewer should assess theme/decorative quality while another checks exact source/claims and timing; their observations need actual artifact references, not inferred success from unit tests.

## Authoring validation

Validation used the existing `loadFixture` Zod schema only, plus lightweight checks for 10 unique explicit creation aliases, paced durations and exact `spokenInput` keys (`id`, `text`, `scheduledEndMs`). All passed. No browser, live API, model execution, timing benchmark or quality result is claimed. The original five fixture files and in-flight batch were not edited.
