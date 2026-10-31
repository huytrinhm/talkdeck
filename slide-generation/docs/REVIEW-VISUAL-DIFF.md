# Prepared review images and visual differences

The integrated review uses `Preview.before/after.jpeg` and a separate
`Preview.visualDiff` overlay. Both sides retain their immutable capture bundle:
render and image digests, dependency inventory, source digest, measured nodes and
stable text parts. `BrowserValidationPipeline.captureReview(artifact)` waits for
pinned fonts and decoded images, measures DOM Ranges and captures the JPEG from
that same prepared page. Static previews show every build. Highlights never enter
canonical JSX, slide HTML, exports or audience publications.

`stable-parts-lcs-1` matches retained rendered node identities. Expanded identities
retain instance, definition and repeated-item provenance. New identities are
reported as additions/removals, never guessed moves. Text parts have stable names:
body, Stat value/label, Quote attribution, frame sides and bullet markers keyed by
child identity. Inline formatting does not change a part's identity. Text is
segmented into Unicode words, whitespace and punctuation with UTF-16 offsets for
DOM Range. Longest-common-subsequence alignment preserves order and duplicates;
ties deterministically choose deletion first. Over one million token pairs the
comparison conservatively marks the entire text part. Geometry uses design
coordinates rounded to 0.01px, with a 0.5px movement/size tolerance.

Changes may include text replacement, insertion, deletion, move/reflow, resizing,
computed style, icons/assets, reveal groups, speaker notes and slide order.
Addition/deletion gets a whole-slide region. Notes/order are separate metadata
changes, with no tint on unchanged content. Shared-definition/theme changes are
captured for every affected slide in the atomic proposal. A property that changes
rendered output without finer classified evidence receives an explicit whole-slide
comparison. Measurement failure refuses preparation; it never means no changes.

The preview signature includes image digests, effective geometry, render bytes,
dependencies, source scopes, affected order and deterministic changes. It excludes
source-only bookkeeping, unrelated deck source, capture timing and proposal version.
Acceptance always privately prepares against current source and checks this
signature, even if source revision is unchanged. Different valid preview bundles
produce a higher ready version requiring explicit acceptance. Invalid restaging
becomes stale. Existing immutable asset resolution also refuses changed bytes at
the same pinned identity/version. Canonical commit still runs normal validation;
no preview is marked accepted before its receipt.

`POST /practice/:id/request-change` with `{slideId,prompt}` starts a private review
job when the original review had no proposal. It uses current canonical context,
requires exactly one proposal, and uses the existing versioned acceptance path.
`revise` continues to prepare a replacement without superseding the original until
the replacement is ready. Failed/cancelled jobs do not mutate the deck.

Focused coverage lives in `test/practice-visual-diff.test.ts` and the existing
practice integration suite. Browser measurement/capture cases use real Chromium;
geometry mutation cases and reviewer adapters are explicitly synthetic. The
integrated application's browser evidence and live-provider evidence are recorded
separately; these tests do not establish physical microphone or live-model quality.
