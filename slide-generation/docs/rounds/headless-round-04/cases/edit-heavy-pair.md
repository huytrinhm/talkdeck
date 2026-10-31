# Round 04: edit-heavy serial pair

One baseline/candidate repetition completed with real models, actual scheduler, viewer and mandatory Chromium checks. Baseline was frozen `734d84a`; candidate was frozen `7aee9be`. This is diagnostic evidence, not five-talk qualification or a statistically supported improvement claim.

Evidence roots (relative to `slide-generation/`):

- Baseline: `.artifacts/runs/headless-round-04/baseline/edit-heavy/1/execution/slide-generation/.artifacts/run/`
- Candidate: `.artifacts/runs/headless-round-04/candidate/edit-heavy/1/execution/slide-generation/.artifacts/run/`
- Candidate offline transaction replay: `.artifacts/replays/headless-round04-candidate/`

Each live root contains the literal provider cassette, scheduler events, operations, canonical commits, final source, metrics, audit and viewer evidence. Investigation during the timed pair was read-only; the offline browser replay ran after both trials completed.

## Result and faithfulness limit

| Recorded fact | Baseline | Candidate |
|---|---:|---:|
| Retained/canonical input events | 22/22 | 22/22 |
| Recorded model calls | 89 | 88 |
| Input tokens | 938,894 | 1,112,369 |
| Output tokens | 2,851 | 6,204 |
| Accepted model edit transactions | 6 | 7 |
| Successful visible observations / expected | 8/30 | 8/30 |
| Settled / recording complete / final mandatory readiness | true / true / true | true / true / true |

Source evidence confirms a candidate fidelity regression despite its passing readiness: baseline checklist order ends `Monitor, Draft, Publish, Verify`; candidate ends `Monitor, Draft, Verify, Publish`, contrary to the requested Publish-before-Verify order. Both end with Release checklist before Owners rather than the requested reverse order. Both retain a third, blank Parking lot slide instead of deleting it and archiving its original evidence. Candidate correctly retains the full original transcript, but retention and valid geometry do not satisfy these requested visible/structural changes. Owners ends with Ada, Jo and Samira in both versions. Reveal behavior and design quality require their separate viewer/manual checks; this source inspection does not qualify them.

## First observed divergences and gate evidence

Candidate's first edit committed at 13,062.611ms; baseline's first edit attempt failed at 18,913.424ms on `Text: color: Invalid string: must match pattern /^[a-z][a-z0-9-]*$/`, and its first edit committed at 23,323.617ms. The first recorded correct title frame is 13,911.792ms for candidate versus 24,251.941ms for baseline. These are observations from this pair, not proof that a particular change caused a responsiveness improvement.

The new Slow context path is directly verified in provider request bodies: baseline's four Slow Decisions all receive `current.source=""` without `spokenEdits`; candidate's three receive actual JSX and `spokenEdits:true`. The first two inspected candidate source lengths were 1,080 and 780 characters. Candidate's first Slow decision wakes at 13,344.357ms, and Slow commits edits at 22,797.153ms and 25,910.691ms. Baseline's first Slow decision holds at 23,648.762ms. Different model decisions/timing prevent attributing the entire final difference to this context fix, but the intended source exposure is present.

The Fast speech gate still has contradictory narration-only question wording, but this pair supplies no evidence that it suppressed explicit edits: all 52 baseline and 46 candidate recorded provider answers were `dispatch`, with zero `hold`. Each trial has 21 effective dispatches; stale overlapping answers account for the other responses. Do not diagnose an observed gate hold from this run.

## ID delegation works; the requested reorder still fails

Candidate Fast called exactly `request_deck_edit({"scope":"cross_slide","utteranceId":"edit-heavy-016"})`. At 50,465.438ms the audit event records ID `012c2e42-3682-4904-8df9-aac80a595fc6`, slide `n10`, speech revision 14, and exact text `Move the Owners slide before Release checklist.` The tool returned success, and the Slow inference at 50,639.946ms contains that same ID and full original task. This is a successful measured use of the ID interface, with no model-supplied task text.

For contrast, baseline first submitted a combined create-and-delete quote and was refused. Its later accepted delegation was the final stop-layout instruction, not the earlier deletion request. The candidate made no delegation for deletion of Parking lot. Successful routing of one request therefore does not establish completion of all deck work.

Candidate Slow attempted the delegated reorder twice, and both correctly refused stale source ranges:

- At 59,004.413ms, its insertion anchor still matched, but the copied/deleted Owners block started with `version={4}`. New Owners input had already changed that block before tool execution.
- At 71,038.234ms, both the checklist opening anchor (`version={20}`) and the copied/deleted Owners block (`version={6}`) no longer matched. Further retained input and visible edits had changed them.

These causes were checked by matching each issued snapshot's exact selected lines against the last authoritative commit before the invocation, in addition to the recorded `stale_anchor` error codes. The transaction engine resolves all ranges against the pre-transaction source; this is not an insert-then-delete self-conflict. No recording or hash precondition was repaired to obtain a pass.

## Other literal candidate refusals

| Tool result time (ms) | Actor | Recorded cause |
|---:|---|---|
| 19,991.817 | Fast | Uses `color="--color-accent"`; schema expects the token role name, such as `accent`. |
| 24,968.233 | Fast | Stale title and Review line after Slow changed those exact lines. Other selected lines still match; the atomic transaction refuses. |
| 30,977.711 | Slow | Replaces a single empty line in deck `n1`. The issued hash is SHA-256 of the empty string, and there are multiple exact empty-line matches. Recorded code is `ambiguous_anchor`. |
| 40,324.671 | Fast | Inserts an extra `</Bullets>` immediately before the existing closing tag; parsing fails with `Expected corresponding JSX closing tag for <Slide> (36:4)`. |
| 59,004.413 and 71,038.234 | Slow | Stale whole-slide movement ranges described above. |

The failed 40s transaction still orders Verify before Publish in its replacement text. Later successful repairs retain that wrong order. This is a substantive missed request, not merely an unfinished validator repair. Broad source ranges and unstable version/evidence lines increase contention for structural moves; any next fix should preserve exact source/evidence protections and be verified separately.

## Replay evidence and outstanding coverage

After the pair, the current `scripts/headless-replay.ts` replayed the candidate offline into a new directory, with actual Chromium checks. All 55 transaction-replay steps matched, final readiness was true, and final source SHA-256 was `18d5ee9fb38aeb0496ea721547d2edf85b74c2dfb11ee9f0c2dcbdbb5f8e005b`. See `report.json`, `cassette.json` and final source in the replay evidence directory. The report explicitly says `actorReplay:false`; replay preserves the measured wrong final state rather than repairing it.

The new successful utterance-ID delegation trace can exercise the proposed bounded actor replay extension. Current actor replay still refuses delegation and navigation; baseline additionally uses four `send_message` calls. The separate [replay plan](../replay-plan.md) requires exact provenance-validated identities and actual lifecycle scheduling before any support claim. Transaction replay alone does not verify those actor/provider interleavings. No actor replay was claimed or run for this pair.
