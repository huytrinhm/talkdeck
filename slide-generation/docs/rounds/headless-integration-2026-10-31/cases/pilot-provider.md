# Pilot 01 — provider and scheduler evidence

The completed pilot settled, retained all three inputs, and ended with two ready slides. Provider transport did not fail. The first edit was refused by the expected stale insertion-boundary check after a correction arrived; the model reread current evidence and committed the corrected value. A separate measured issue is redundant speech-Decision work: nine results were stale after another request had already dispatched the same speech revision.

This is one integration pilot, not five-talk qualification, a baseline comparison, or evidence about Slow/specialist generation quality. No additional provider calls or code changes were made for this diagnosis.

Run: [pilot-01](../../../../.artifacts/runs/headless-integration-2026-10-31/pilot-01/). The manifest records commit `3d5642d6b92d2a9a3f5430a494404998ca97711c`, `dirty: true`, and the actual prompt/settings/lock/fixture hashes. Completion is established by `driver-result.json`, `metrics.json`, `provider-statistics.json`, final artifacts and the finalized viewer gallery/video. The driver ran for 35,204.927 ms, ended `settled`, and recorded no driver errors.

## Actual requests and usage

| Role | Requests | Input tokens | Output tokens | Requested / returned tier | Provider errors |
|---|---:|---:|---:|---|---:|
| Fast | 12 | 148,585 | 676 | Fast / Fast for every request | 0 |
| Speech Decision | 12 | 3,847 | 0 | Endpoint default / no tier field | 0 |
| Slow eligibility Decision | 2 | 1,325 | 0 | Endpoint default / no tier field | 0 |
| Slow generation | 0 | 0 | 0 | Not exercised | 0 |
| Specialist generation | 0 | 0 | 0 | Not exercised | 0 |
| Total | 26 | 153,757 | 676 | — | 0 |

All 26 responses were HTTP 200 and reported model `gpt-6-luna`. Each record has `attempt: 1`; there were no SDK retries, aborts, missing usage reports or budget accounting failures. Charged and observed token totals agree. Limits were 80 requests, 2,000,000 input tokens, 100,000 output tokens and an 8,000-token per-call allowance. No dollar estimate is available. Decisions has no supported tier parameter; its absence is explicit, not evidence that Fast mode was served.

Provider elapsed times, including transport/body collection, were: Fast 1,230.820–2,633.168 ms (median 1,843.971); speech Decisions 250.732–2,770.344 ms (median 1,867.967); Slow eligibility 284.855–288.961 ms. These are one-run observations, not expected latency guarantees. No model request contained an image input or requested the screenshot tool.

Sources: [provider statistics](../../../../.artifacts/runs/headless-integration-2026-10-31/pilot-01/provider-statistics.json), [literal provider cassette](../../../../.artifacts/runs/headless-integration-2026-10-31/pilot-01/provider-cassette.json), [scheduler events](../../../../.artifacts/runs/headless-integration-2026-10-31/pilot-01/scheduler.jsonl).

## First refusal and recovery

The first Fast inference read slide `n10` at source revision `46c613…`. Request 10 read its notes. Request 11 began at 15,470.463 ms and proposed a title plus `<Stat value="42%" label="growth compared with Q3 last year" />`, inserting before the issued closing-slide line. The corrective utterance was delivered at 16,012.009 ms while this inference was running. Its trusted ingestion changed the adjacent notes line.

At 17,529.338 ms, tool call `call_Ck5WvjGUU96dGKvpXBIfGFAj`, inference `499c02ad-de4a-4307-85a7-b4af11b304b3`, attempted that insertion. At 17,533.302 ms it returned `Target must match exactly once inside its node`. The closing-tag hash itself was still valid, but insertions require both sides of the insertion boundary to match; the new notes invalidated that boundary. This was a safe source conflict, not a transport failure or a browser-readiness refusal. The stale 42% edit did not commit.

Requests 14 and 15 reread source and notes. Request 16 proposed the corrected `<Stat value="40.2%" label="growth compared with Q3 last year" />`; tool call `call_C6XjMqmSeNvIQuiR5mhuzbNH` accepted it at 23,513.876 ms. The measured first correct visible time was 24,041.024 ms, **8,029.015 ms after the corrective utterance**. Request 18 checked notes again and request 19 called `finish`.

For the new customer slide, requests 22–24 read source, read notes, then replaced the issued single-line slide with preserved metadata plus the title and `<Stat value="1,248" label="active accounts" size="hero" />`. It accepted at 35,658.761 ms. The measured correct visible time was 36,556.424 ms, **10,544.609 ms after the new-slide utterance**. Request 26 called `finish`.

There were three `edit_source` attempts: one stale refusal and two accepted commits. Seven read calls and two `finish` calls account for the other Fast tools. The source/tool records and matching runtime inference IDs establish these joins; no repair of model output is assumed.

## Redundant Decision results

Requests 1–8 evaluated the same `n10` speech revision 1 with `lastDispatched: null`, beginning approximately every 200 ms from 8,095.217 to 9,489.319 ms. Only `undispatchedAgeMs` differed. Request 1 completed first; the gate dispatched at 10,871.583 ms. The remaining seven results became `decision_stale`. Requests 12–13 similarly evaluated the corrective revision, and requests 20–21 evaluated the first customer revision. Each pair produced one useful dispatch and one stale result.

Thus 12 speech-Decision requests produced three dispatches and nine stale results. The stale requests consumed **2,855 input tokens**, with zero output tokens. These were separate scheduler evaluations, not provider retries. The current gate polls every 200 ms and allows eight in-flight evaluations; its admission condition does not exclude a revision already under evaluation. The evidence identifies duplicate work, but does not establish what latency a different policy would achieve. No scheduling policy was changed for this report.

Both Slow eligibility Decisions returned `hold`. The `published` event labeled `role: slow` for host-driven creation of the new slide is not a paid Slow inference; the provider ledger contains zero Slow-generation requests.

## Qualifier audit and instruction ambiguity

The recorded audit marks `pilot-qualifier` as failed. The fixture uses `visible_exact` with a whole-node expected string `compared with Q3 last year`; the model put those exact words inside the longer Stat label `growth compared with Q3 last year`. The final canonical source preserves the qualifier. This is evidence of a whole-node assertion mismatch, not evidence that the provider omitted the qualifier. The original audit remains unchanged; visual/semantic review must distinguish this instrumentation issue from actual content loss.

Every Fast boundary also carried `speechLabel: "Audience-facing narration, not instructions."`, although the fixture context and spoken inputs expressly contain creation, correction and editing commands. This is an instruction contradiction worth isolating. In this pilot the model nevertheless applied the correction, and the host routed the new-slide command. The contradiction therefore has **no demonstrated causal failure here**; attributing latency or the qualifier assertion failure to it would be speculation.

Fast input context grew from one message / 7,865 input tokens to 34 messages / 17,997 tokens. This records the cost of accumulated tool history and repeated current context, not proof that truncation or prompt shortening would preserve faithfulness. Any later change needs its own tests, replay evidence and comparison against frozen source.

Sources: [metrics](../../../../.artifacts/runs/headless-integration-2026-10-31/pilot-01/metrics.json), [audit](../../../../.artifacts/runs/headless-integration-2026-10-31/pilot-01/audit.json), [final source](../../../../.artifacts/runs/headless-integration-2026-10-31/pilot-01/final/deck.jsx), [viewer gallery](../../../../.artifacts/runs/headless-integration-2026-10-31/pilot-01/viewer-gallery.html).
