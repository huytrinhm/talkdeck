# Consolidated first freeze

This batch supersedes the earlier surface-only hotfix without overwriting immutable archives. Work is frontend-only, local commit authorized, no GitHub push. No activation/storage/secret/relay changes. Experimental service implementations remain for future work, with UI/routes unmounted for this release.

## Reproduced causes and corrections

- Last transcript rule: the shared `.transcript .transcript-phrase` rule added a bottom border to every row, including the last. A browser regression reproduced1px on the final row. Meaningful internal separators remain; the last rendered row carries an explicit marker and no trailing rule. Sidebar, presenter and Review now share that renderer, preserving Review highlights, wrapping and saved provenance.
- Live row: legacy `.interim::after` appended a caret after the block paragraph, creating an orphan line (browser measured22.75px line height and an extra row below the text). It is removed. Empty/whitespace-only interim does not create a live box. Final/interim transitions are tested for a single captured phrase and no leftover live row. No transcript history or saved slide content is deleted. Parent inspected user screenshot pixels; main used caption/OCR and its own controlled browser reproduction, not user-pixel inspection.
- First-freeze scope: remove sender route and Connections bootstrap from App; settings contain Preferences/privacy only. No Phone/BYOK/coach controls or disabled placeholders. Coach mounts/history panels are removed from Workspace and Review. Existing internal services and pure unit tests remain for later. Experimental browser UI scenarios are explicitly skipped.
- Review navigation: Overview has no Done; completion remains available from Slide changes, retaining pending approval/rejection gates. Final Done returns to the same project workspace. App retains the selected stable slide across mode transitions instead of resetting selection on each keyed Workspace mount.
- Drawing: vertical rail; six larger swatches, divider, three spaced visual size choices. No select dropdown. Lower-right arrow restored per direct user correction; a separate full-tool anchor keeps positioning independent. Desktop horizontal row, narrow screens use two roomier rows. Choose left/right when space permits; otherwise place above/below the whole rail to avoid viewport/rail overlap.320px and moved-edge geometry are tested.
- Read-only review caught removal of a coach-owned visibility listener also removing Practice capture pause. Reproduced RED, restored as a capture-only listener, and tested hidden-page pause/late-callback rejection without any coach.

## Verification and limits

Run typecheck/unit/build and active browser suite before committing; exact counts and hashes are in the immutable manifest. Browser recognizers are replaced before loading and physical media blocked. Tests cover active/final rows in Talk/Practice/Present, saved Review, narrow timestamps, hidden controls/routes/no service bootstrap, proposal completion/selected return, visual choices, lower-right arrow and mobile placement. No real hardware, provider, key or paid call is claimed.

One local commit, one immutable source handoff, then exact actual-public-URL verification with hosting/QA. P0 stays false/R2 unbound. Only after verified deployment, inspect the latest published teammate repo read-only and deliver compatibility/wiring gaps; do not pull/rebase over this dirty tree or integrate automatically. Generated evidence and unfinished agent experiments stay unstaged.
