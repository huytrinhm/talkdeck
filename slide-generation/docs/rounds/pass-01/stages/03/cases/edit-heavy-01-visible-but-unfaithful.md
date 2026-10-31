# Edit-heavy candidate 1: visible generation, literal mispatch and incomplete recovery

Frozen generator: `734d84a`. This is a **new live model run** after the bullet-marker fix, not the offline repaired rendering of round 02's recorded candidate. There were 84 real provider calls, 894,397 input tokens and 3,396 output tokens. Fast made 26 calls, Slow four, speech Decisions 49 and Slow Decisions five; specialists were unused. No paid calls or additional browser probes were made by this reviewer.

The marker fix unblocked actual generation. Six model transactions accepted: five Fast visual edits and one Slow slide deletion. The result is still unfaithful and ends with host-error. Three of 30 automatic expectations pass, 12 fail and 15 require manual review. Final readiness and final count of two live slides pass; canonical retention is 21/22. Durable raw pending receipts are 22/22. These outcomes do not establish five-talk qualification or a successful-work speed comparison.

## What the viewer actually showed

The real PNG timeline and both final JPEGs were inspected. Checklist content first appears in settled frame 4 at 15,389.625 ms host time, 7,193.077 ms after the first utterance ended. It shows Launch checklist and Draft, Review, Publish, Monitor. By this point the user has already corrected Review and requested Monitor first; those changes have not yet appeared.

At frame 6 (23,889.725 ms), Review is corrected to Verify and the order is Monitor, Verify, Publish, Draft. This order does not preserve Draft's requested position. Frame 14 (33,738 ms) shows **Monitor, Verify, Draft, Draft**: Publish has disappeared and Draft is duplicated. At frame 16 (48,822 ms), the duplicate is removed but Publish never returns. Final checklist remains Launch checklist with Monitor, Verify, Draft and teal Verify. The requested Release title, Publish, caption, correct ordering and highlight removal are missing. It also remains before Owners despite the reorder request.

The final Owners slide is readable and displays the correct latest associations: Verify — Ada, Publish — Jo, Monitor — Samira. Its first nonempty settled frame is frame 26 at 67,941 ms, roughly 10.31 seconds after the Samira correction and over 40 seconds after the slide creation input. Earlier Owners captures are blank. The earlier Lin/Jo and Sam states never visibly fulfill their own time windows; the final correct associations do not retroactively satisfy them.

The three automatic successful latency samples are 5,517.207, 7,193.077 and 11,693.775 ms (p50 7,193.077; p90/p95/max 11,693.775). They cover initial title presence, title wording preservation after the enlargement instruction, and Review→Verify correction. The title-preservation assertion does not itself prove the requested size change. The 27 remaining expectations are still included as misses/manual checks. There is no finite worst-case claim over those misses.

Final visual review: legible native type, clear left alignment, no obvious overlap or cropping in the inspected captures, and a sparse consistent neutral palette. The checklist title is substantially larger than Owners and Verify remains highlighted despite the removal instruction. Content loss and unintended edits take priority over these limited visual successes. No live audience build/reveal session or full-video frame-by-frame review is claimed.

## Publish loss is a literal model mispatch, not stale target application

At approximately 31,284–32,203 ms, the accepted transaction uses snapshot `6a36647a-dbce-431e-b120-a603eefacff6` and line 16 hash `f305ac8936815ad1a1128c3cb77aefc219a3f3de6cfec0d8ad91d7c125bd70f7`. The exact issued line is:

```jsx
<Text id="t22" role="body">Publish</Text>
```

The latest context contains utterance 008, “Put Draft back immediately after Monitor.” The same source read already shows Monitor on line 14, Verify on line 15 and an existing Draft (`t23`) on line 17. Nevertheless, the model requests a `replace` of **Publish's line** with:

```jsx
<Text role="body">Draft</Text>
```

The preceding attempt targeted the same wrong line with `id="t23"` and correctly refused duplicate identity. Its retry removes the explicit ID but preserves the wrong semantic replacement. The engine assigns `t33`, accepts the exact requested replacement, and publishes revision `4e3e60882c7cb163b4c7859eb5197f3cc005d2c3bf1c9558f719a0bc6102128f`. The read/anchor is accurate. Additional unrelated input does not explain replacing Publish with Draft. This is direct evidence of model intent violating the latest requested edit, not a renderer, relocation or stale-state bug.

At approximately 46,689–47,696 ms, another accepted transaction removes the old `t23` Draft. This eliminates the duplicate but leaves the new Draft in Publish's former position. The loss is still present at final capture.

## Correct refusals and failed recovery

There are 11 edit attempts total: six accepted and five refused. The five refusals are one invalid color `--color-accent`, one unissued/unknown source snapshot (`Read this node before editing`), one duplicate `t23`, and two attempts to reintroduce deleted `t22` as a system-assigned ID. The last two transactions bundle the rename and other corrections with invalid identity edits, so atomic refusal also blocks otherwise useful changes. The final retry abandons those changes and merely removes the duplicate Draft.

The source/ID failures are real tool-contract errors, distinct from visual correctness. Preserving exact hash/identity checks is appropriate. Narrow fixes should improve issued-snapshot/ID usage and recovery, plus a pre-edit comparison of the proposed literal change against the requested operation. Do not add a semantic runtime judge or reinterpret a successful transaction as proof of faithful editing; those would reopen settled decisions.

## Automatic Slow gate lacks the actual slide content

All five recorded Slow-decision requests have `current.source:""`, `geometry:[]`, `diagnostics:[]`. Their deck context includes IDs, titles and notes/transcript, but no actual visual source/content projection. Their only input part is `input_text`; no screenshot is supplied. This includes provider-request-37 immediately after the Publish→Draft mispatch and provider-request-59 after duplicate deletion. Every gate answers `hold`.

Thus the gate is asked to inspect current source/visual quality without receiving current visual content. It can read the intended instructions but cannot distinguish this actual corrupted list from a faithful one with the same title and notes. This is a verified adapter/context omission. It does not prove that an informed gate would wake or that Slow would repair the list. A canonical content projection can supply the missing evidence without introducing automatic screenshots contrary to the requested-only image policy. Also, this gate's instruction still says narration is not commands, despite explicit editing inputs.

Explicit Slow handoff does work in this run. At 55,644 ms, `request_deck_edit` quotes exactly “Delete the Parking lot slide. Keep its original transcript and notes in the archive.” Slow accepts a whole-deck deletion at 62,892–63,973 ms, and final source contains ArchivedSlide `n47`, source slide `n40`, with both original creation/deletion Prompts and notes intact. This proves that particular archive path. It does not prove reorder, theme work or automatic refinement.

## Remaining routing and measurement gaps

Because the rename never commits, utterance 021 naming Release checklist is rejected as an unknown live target. Its exact raw pending receipt is retained but its canonical Prompt is absent. The final host-error preserves this failure. The two-slide final count and structural ready=true are independent of that source-integration failure.

The final Owners screenshot also exposes the existing whole-node `visible_exact` granularity limitation: assertion a028 expects standalone “Ada” and “Jo,” while the displayed text includes them correctly in “Verify — Ada” and “Publish — Jo.” The automatic miss remains unchanged; manual review distinguishes it from missing/wrong ownership. This does not repair the many genuine checklist failures or authorize changing assertions mid-comparison.

Next verification should separately test canonical visual context for Slow decisions, literal move/reinsert recovery using actual issued reads/IDs, and unresolved rename routing. Preserve these requests and accepted bad source for recorded-response replay; a replay of the same bad patch must not silently repair its semantics. Any subsequent live remeasurement is a new sample. Full five-talk repetitions and semantic/design qualification remain unfinished.

## Original evidence

- [Run report][report], [metrics with all observations][metrics], [failure][failure], [final canonical source/archive][source]
- [Issued source read proving Publish at line 16][read], [exact mispatch model context/response][request], [accepted mispatch][edit]
- [Slow gate after mispatch][gate], [explicit accepted Slow handoff][handoff]
- [Duplicate Draft frame][duplicate], [final checklist][checklist], [final Owners][owners], [complete PNG/video gallery][gallery]

[report]: ../../../../../../.artifacts/runs/headless-round-03/candidate/edit-heavy/1/execution/slide-generation/.artifacts/run/review.md
[metrics]: ../../../../../../.artifacts/runs/headless-round-03/candidate/edit-heavy/1/execution/slide-generation/.artifacts/run/metrics.json
[failure]: ../../../../../../.artifacts/runs/headless-round-03/candidate/edit-heavy/1/execution/slide-generation/.artifacts/run/failure.json
[source]: ../../../../../../.artifacts/runs/headless-round-03/candidate/edit-heavy/1/execution/slide-generation/.artifacts/run/final/deck.jsx
[read]: ../../../../../../.artifacts/runs/headless-round-03/candidate/edit-heavy/1/execution/slide-generation/.artifacts/run/tools/393f10603fbaf8275014403859a4c61caa045473e3d9c011643789c588a61868.json
[request]: ../../../../../../.artifacts/runs/headless-round-03/candidate/edit-heavy/1/execution/slide-generation/.artifacts/run/model/847e85c4e2fed2d1777c479e942e841d705f92156bb0fd8a0b205ae9dd2b1ab2.json
[edit]: ../../../../../../.artifacts/runs/headless-round-03/candidate/edit-heavy/1/execution/slide-generation/.artifacts/run/tools/30bce85d20723f3f8defeb6793c34af5db225b17122d3536a9764fe4c85d0445.json
[gate]: ../../../../../../.artifacts/runs/headless-round-03/candidate/edit-heavy/1/execution/slide-generation/.artifacts/run/model/00cb092df08d40017b6f272538d9dab588abe411eff273f7a60eeb14ae850ef4.json
[handoff]: ../../../../../../.artifacts/runs/headless-round-03/candidate/edit-heavy/1/execution/slide-generation/.artifacts/run/tools/c1fde58538eb8dce7a70fcbcfd57377e046985589ac885cc3b136f230ec4b601.json
[duplicate]: ../../../../../../.artifacts/runs/headless-round-03/candidate/edit-heavy/1/execution/slide-generation/.artifacts/run/viewer/frame-000014.png
[checklist]: ../../../../../../.artifacts/runs/headless-round-03/candidate/edit-heavy/1/execution/slide-generation/.artifacts/run/final/slide-n10.jpg
[owners]: ../../../../../../.artifacts/runs/headless-round-03/candidate/edit-heavy/1/execution/slide-generation/.artifacts/run/final/slide-n28.jpg
[gallery]: ../../../../../../.artifacts/runs/headless-round-03/candidate/edit-heavy/1/execution/slide-generation/.artifacts/run/viewer-gallery.html
