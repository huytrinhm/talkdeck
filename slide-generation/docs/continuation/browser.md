# Browser agent checkpoint — 2026-10-31

Stopped at the user's request for a restart with more permissions. No browser implementation files or tests have been
written. Do not infer P6 implementation or success from this checkpoint. Root owns commits and integration.

## Scope and agreed interfaces

Read AGENTS.md, SPEC.md browser/validation sections, P6/P7 in IMPLEMENTATION_PLAN.md, DECISIONS.md, current contracts,
validation and package configuration. Own future `src/browser/` and browser tests; do not modify engine/storage/schema.

Planned export: `BrowserValidationPipeline` implements `ValidationPipeline.check(source)`, plus
`screenshot(source, slideIds)` (at most four 1920x1080 JPEGs) and `close()`.

Renderer agent `/root/rendering` agreed to return HTML slide fragment, CSS containing embedded font bytes, slideId,
normalized source, dependencies `{renderer, compiler, fonts, assets, icons}`, fonts with family/weight/style, and expanded
pendingNodeIds. It is implementing `src/render/contrast.ts` with the pinned APCA-W3 0.1.9 / 0.0.98G-4g calculation and
`apcaContrast(textRGB, backgroundRGB)` signed Lc. Check its actual files and final report; that code was not verified by
this agent. Default bundled family is planned as `Talkdeck Noto Sans` regular/bold.

Renderer attributes requested/agreed: data-node, data-content, data-role, data-stat-value, data-shape,
data-shape-opacity, data-surface. Stat value and label need their own roles. Clarify root marker, decorative bleed
marker, and artifact exact type before implementing measurements. Secondary text should use resolved foreground alpha
0.75, or leaf opacity with no background, to avoid ambiguous group-opacity compositing.

## Environment evidence

Commands run from slide-generation with normal sandbox permissions:

- Node v22.22.1; Playwright package 1.64.1.
- `chromium.executablePath()` gives `/home/zap/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`, which does not
  exist. This is not the executable used by default headless launch.
- Default `chromium.launch({headless:true,timeout:10000})` runs the installed
  `chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell` and fails with:
  `FATAL:content/browser/sandbox_host_linux.cc:41] Check failed: . shutdown: Operation not permitted (1)`; SIGTRAP.
- The installed headless shell's `--version` succeeds: Google Chrome for Testing 156.0.8078.4.
- `ldd` on that installed headless executable resolves all listed shared libraries; no missing-library output.
- Headless installation has INSTALLATION_COMPLETE and DEPENDENCIES_VALIDATED markers.
- `/proc/self/status` reports NoNewPrivs=1, Seccomp=2, Seccomp_filters=1, CapEff=0.
- There are no environment variable names matching BROWSER, PLAYWRIGHT, CDP or CHROME. No secrets were read/logged.

Root independently probed sockets and reported: AF_UNIX socket/socketpair succeed; AF_INET socket creation returns
EPERM; socketpair shutdown(SHUT_RD/WR/RDWR) all return EPERM, matching Chromium's failure; ptrace is also denied.
Root found no remote browser tool/endpoint. This evidence identifies environment syscall policy as the current cause,
not a missing installed headless shell or missing shared libraries. Do not work around denied syscalls with preload,
emulation or weakened security flags. Re-run normal launch after permissions change.

No real browser measurements, screenshots, gallery review, or browser acceptance tests have succeeded.

## Implementation plan on resume

1. Confirm renderer artifact/API and APCA export. Probe normal Chromium launch before broad work.
2. Add a bounded shared Chromium launcher/page semaphore with queue and operation timeouts. Each static page uses an
   isolated context at 1920x1080/deviceScaleFactor=1, JavaScript disabled for page code, all external requests aborted,
   no service workers/downloads, strict CSP, and disabled transitions/animations. Trusted Playwright evaluate performs
   measurements. Wait for document.fonts.ready, explicitly load/check each bundled font face (not generic fallback),
   and decode every img with positive natural dimensions.
3. Implement measured leaf Text-node ranges (TreeWalker/Range), not parent textContent boxes, to avoid counting the
   same glyphs twice. Track nearest data-node/content/role, own bounds, surface ancestors, effective font size after
   cumulative zoom, computed foreground alpha and exact final build geometry. Enforce resource limits by refusing
   incomplete measurement, never silently dropping nodes.
4. Quantitative mandatory checks: node canvas overflow >2px; text own/card/canvas overflow >0.3em of largest involved
   font; distinct content-text intersections; multi-line Stat value; role floors after scaling; filled-surface 20px
   minimum; APCA role thresholds 45/60/75; solid Shape beneath content text. Decorative bleed rules need explicit
   renderer contract rather than accidental exemption of native content.
5. For actual composited backgrounds, planned approach is internal measurement-only PNG capture with only text glyph
   fill hidden via `-webkit-text-fill-color:transparent` (preserve layout, backgrounds, currentColor icons/shapes), then
   restore exact style attributes. Trusted browser canvas can sample screenshot pixels without a PNG dependency.
   Evaluate sufficient actual pixels per native text range; do not silently pretend a single center sample proves all
   gradients/images. These internal captures never become automatic model screenshot feedback. Handle group opacity
   correctly or report measurement unavailable. This approach is only a plan, not implemented or verified.
6. Missing font/asset, browser timeout/crash, unsupported compositor measurement or unavailable APCA makes
   `complete=false` or throws a typed validation-unavailable error. No partial successful report or cache entry.
7. Return explicit requested JPEG screenshots from the same immutable artifact used for measurement. Include
   source/render/dependency/check-policy digests in evidence and future cache keys. Do not cache incomplete reports.
8. Add pure policy negative controls and separate real-browser adversarial tests for every required check, transforms,
   translucent backgrounds, hidden build groups, fonts/assets, crashes/timeouts, script/network isolation, JPEG dimensions
   and identical check/capture inputs. A failed or unavailable real-browser suite is not a passing unit suite.

## Finding discriminator recommendation (not applied)

Sent root a proposal to add optional `Finding.subject?: string` and include it in introducedErrors' comparison key.
Several independent violations can share (check, slideId, nodeId): canvas vs own/card bounds, or multiple overlap
partners. Taking only their maximum magnitude can let one improving violation mask a new/worse different violation.
Keep public check names stable; use subjects such as canvas, box:<id>, card:<id>, pair:<other-node/run>, with quantitative
magnitudes per subject. Root had not applied this change when work stopped.
