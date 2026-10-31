# O01: counting displays intermediate numeric claims

Date: 2026-10-31. Controlled real-Chromium viewer demonstration, not a model/talk evaluation.

Correction target: `$12.4 million` -> `$12.7 million` on a Stat-like native numeric element.
Observed intermediate visible text: `$12.5 million` and `$12.6 million`; final target `$12.7 million`.
Root inspected the intermediate screenshot showing `$12.6 million` and the recorded sample JSON.

Artifacts: `.artifacts/viewer-o01/before.png`, `intermediate.png`, `after.png`, `samples.json`, and `video/`.
Sample timestamps are browser performance timestamps from the controlled demo; they are not utterance-to-visible latency.
No model inference, canonical transaction or end-to-end talk performance claim is inferred from this demonstration.

First divergence: the owned viewer's approved bounded numeric interpolation writes intermediate digits. Both initial and
final source values remain exact; intermediate frames are the open D32/D49 tension already recorded as O01.
Classification: animation/product policy. Higher priority affected: numerical faithfulness; tradeoff: counting motion.

Question sent to the user:

> The browser demo confirms open decision O01: animating a correction from “$12.4 million” to “$12.7 million” briefly
> displays “$12.5 million” and “$12.6 million.” How should Stat updates behave?

Options:

1. Show exact target digits immediately; animate position, color or emphasis only (recommended for faithfulness).
2. Keep bounded counting; treat intermediate digits as animation rather than factual claims.

Status: unanswered at case creation. Do not change policy based on timeout or claim full numeric faithfulness.


Resolution (2026-10-31): user answered verbatim, “Keep bounded counting; treat intermediate digits as animation rather
than factual claims.” Recorded as D56. Keep bounded interpolation and exact endpoints; retain all intermediate evidence.
The case is resolved as an explicit product choice, not a renderer defect. Live talk qualification remains pending.
