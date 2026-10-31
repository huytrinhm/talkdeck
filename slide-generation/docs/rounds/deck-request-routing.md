# Explicit deck request routing

The canonical Fast prompt assigns cross-slide, theme and library work to Slow. Before this fix, Fast had only `finish` among scheduler lifecycle tools, while idle Slow refinement required a Fast publication. An explicit structural request could therefore have no path to its authorized actor when Fast had nothing local to publish.

Canonical Fast now has `request_deck_edit({ scope, sourceQuote })`. It forwards a complete original user input to Slow as an existing `edit_comment` task. This is explicit requested work, so it bypasses autonomous refinement eligibility and needs no prior Fast publication. The target remains the original working slide. Fast's actual source-edit permissions are unchanged.

The runtime requires the quote to equal an entire durably received input on that slide and appear in the inference's retained speech. Substrings that drop negations or qualifiers, paraphrases, invented instructions and arbitrary additional task fields are refused. Slow is told to verify the explicit request and perform only its requested scope. This is provenance enforcement; no lexical rule claims to prove semantic intent. Identical quotes from the same slide/speech revision queue once. Tool results and the request event retain its source utterance identity.

Real engine/Chromium tests verify a requested theme edit through Slow with zero Fast publications and zero refinement Decision calls, exact raw-note retention, deduplication, and unchanged Fast edit restrictions. Negative controls cover fabricated wording, dropped negation, additional task fields, legacy mode and Slow tool exposure. Existing scheduler/refinement tests remain passing. No paid model calls were used, so a live effectiveness or latency improvement is not established by these tests.

The bounded recorded-event actor replayer explicitly refuses traces using this new delegation tool until generated task identities are qualified. Transaction replay remains separate. Previously recorded actor requests also differ after adding a tool definition; replay must not silently ignore that contract change.
