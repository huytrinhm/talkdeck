# First-freeze surface hotfix

Narrow correction after localcommit5340e53/publicversion4. User screenshots were available as caption/OCR only; no actual-pixel inspection claim. No cache diagnosis and no deletion of transcript/slide data.

Root causes:
- Review Overview always mounts CoachReviewNotes. That separate component previously emitted Practice coach, No coach feedback and session/approval boilerplate even with no service or feedback. The stage PracticeCoach guard did not cover this component. Changes/completion contain no separate coach mount.
- Workspace explicitly rendered active interim text in p.speech-status over .stage, separate from the Transcript components. Earlier lifecycle verification checked accepted/cleared events, not absence of this display. This hotfix removes that interim render entirely, independent of input provenance. Connecting/error controls remain status messages, not transcript overlays.

Corrections:
- CoachReviewNotes returns null unless the current service is available, the recorded turn was available, and substantive received feedback exists. Saved notes/history are retained, including hidden notes. Whitespace-only feedback does not make an empty surface available.
- No current-line narration is rendered over the main slide stage. Active speech and attributed saved history remain in explicit Transcript sidebar/presenter transcript surfaces.
- Empty derived review feedback cards are hidden; unconditional generic Tone/Coaching tip is removed. Actual captured pace/clarity evidence remains available.
- No coach added to main slide view, no P0 activation/resource changes, no pet/Deep Refine, no local/cloud user-data cleanup.

Regression evidence: exact two defects reproduced RED before implementation; unit tests exercise empty Overview→Changes→Completion and current/recorded service/feedback combinations, including whitespace and retained notes. Active interim must be present in .workspace-sidebar .interim while .stage .speech-status is absent. Browser scenario exercises active Talk, Pause/Finish, empty Practice/Review/reload/Changes/Completion. Final immutable manifest records counts and committed/deployed identity separately; production verification is mandatory before claiming this release complete.
