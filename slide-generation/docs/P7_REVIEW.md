# Transaction/evidence review corrections

Independent review reproduced six failures before corrections. The immutable local probe output is
`.artifacts/review/p7-results.json`; its reproducer is `p7-probes.ts` in that directory. The probes deliberately use a
unit validator to isolate transaction/storage behavior. They are not recorded model responses or live browser claims.
The old reproducer includes a paused-retention race that now serializes correctly; use the regression tests for current
behavior rather than expecting the former timing schedule to remain possible.

| Reproduced failure | Correction and regression |
|---|---|
| Atomic replacement succeeded, then a repository readback threw; disk contained the edit while engine reads showed old source | CAS/initialization return the known written candidate after successful atomicWrite, without fallible post-commit readback. Post-replacement failures carry DurabilityError; engine retains the known candidate even if recovery reading also fails. |
| CRLF source was accepted by storage but normalized only by engine, so every edit failed CAS | Repository validation/loading and engine now use the same LF canonical source/hash. Trusted user CR/LF input is entity-encoded and survives exactly. |
| A conflicting redelivery after the first event had drained was acknowledged and permanently blocked every later input | Known committed input IDs are compared under the short source-write lock before acknowledgement. Exact duplicates return the retained result; conflicting reuse refuses before entering the queue. |
| Input retained just before slide deletion was left aimed at the deleted slide, without its words in archive | Receipt and commit use the same short source-write lock; the edit commit drains already-retained input before its current-source comparison. Changed evidence forces restaging/refusal before deletion. |
| Reordering slides with page numbering changed their visible page numbers but not their versions/affected IDs | Moved numbered-slide positions participate in affected-slide detection and version advancement. |
| Async trace/tool observers rejected after a successful operation as unhandled promises | Both synchronous throws and asynchronous rejections are caught/counted without falsely converting a committed operation into a refusal. |

Additional regressions verify input during the final CAS window, explicit stale-target retention, exact words across
reload, oversized input, and a canonical overlap pair identity independent of DOM traversal order. Overlap partners
are ordered by binary identity, so reordering an otherwise identical pair does not invent a new comparison key.

## Input that cannot currently be attributed or applied

An original utterance with a stale/unknown target is still retained durably. Its record becomes explicitly blocked,
with its original unmodified payload and a failure code, instead of silently choosing another slide or stopping later
valid utterances. Engine state reports blockedInputIds and lastInputError; `EvidenceInbox.blocked()` exposes exact
private evidence and reasons to the host. `retryBlocked(id)` requeues the same payload after a host resolves its
attribution/dependency; it does not rewrite the utterance or silently change its target.

The same mechanism retains an oversized utterance when the canonical source limit prevents applying it. Unrelated
smaller events can continue. A blocked event is unfinished work: retention in this inbox is not proof it reached a
slide's raw transcript, cleaned notes, or audience. Live qualification must report it as unresolved/missed until the
host explicitly resolves it. No automatic reattribution API or new product rule is introduced.

Model inference and browser checks never hold this write lock. The lock covers durable input receipt, source/CAS
writes, and queue-drain bookkeeping. Repository adapters must report DurabilityError after replacement; ordinary
failures guarantee no replacement. The built-in repository remains single-process and uses atomic JSON replacement.
Transport idempotency remains a bounded process-local cache, and restarted/evicted source snapshots require rereading.

## Verification

- `node --import tsx test/review-regressions.test.ts`:11 transaction/evidence regressions passed.
- `node --import tsx test/browser-policy.test.ts`:5 policy regressions passed, including reordered overlap identity.
- `npm run check`: passed after corrections.
- `git diff --check`: passed.
- Interim full-package result:165/166 passed; the only failure was an independently added actor-replay test expecting
  `/context differs/` while the implementation returned `Recorded model request differs from actual host context`.
  All transaction, storage, browser, runtime and host-session tests passed. Root performs final combined verification.

No model calls, API calls, benchmark comparison, or qualification claims were made during this review.
