import { useState, useSyncExternalStore } from "react";
import { Button, Textarea } from "../components/ui";
import {
  practicePreferences,
  usePracticePreferences,
} from "../services/practicePreferences";
import {
  PracticeCoachController,
  coachHistory,
  useCoachAvailability,
  type CoachFeedback,
} from "../services/practiceCoach";
import "./practice-coach.css";
function Otter() {
  return (
    <svg
      data-testid="otter-avatar"
      className="otter-avatar"
      viewBox="0 0 100 90"
      aria-hidden="true"
    >
      <path
        d="M20 40Q5 15 24 15L36 26Q50 17 65 26L78 14Q95 20 82 42Q94 83 50 85Q6 84 20 40"
        fill="#9dc7c6"
        stroke="#244b59"
        strokeWidth="3"
      />
      <ellipse cx="50" cy="56" rx="25" ry="20" fill="#e1efdf" />
      <circle cx="34" cy="43" r="4" fill="#173844" />
      <circle cx="66" cy="43" r="4" fill="#173844" />
      <path d="M44 54Q50 48 56 54L50 61Z" fill="#173844" />
      <path
        d="M50 61Q40 70 36 62M50 61Q60 70 64 62"
        fill="none"
        stroke="#173844"
        strokeWidth="2.5"
      />
    </svg>
  );
}
const labels = {
  unavailable: "Live coach is not connected.",
  ready: "Coach ready",
  connecting: "Connecting coach",
  listening: "Listening to your question",
  working: "Preparing feedback",
  speaking: "Coach speaking",
  interrupted: "Reply stopped",
  error: "Coach disconnected. Input paused.",
};
export function PracticeCoach({
  controller,
  onPausePractice,
  onResumePractice,
  onSettings,
}: {
  controller: PracticeCoachController;
  onPausePractice: () => void;
  onResumePractice: () => void;
  onSettings: () => void;
}) {
  const s = useSyncExternalStore(
      controller.subscribe,
      controller.getSnapshot,
      controller.getSnapshot,
    ),
    prefs = usePracticePreferences();
  const [notesOpen, setNotesOpen] = useState(false),
    [question, setQuestion] = useState(""),
    [share, setShare] = useState(false),
    [voice, setVoice] = useState(prefs.voiceReplies);
  function begin() {
    onPausePractice();
    controller.beginTurn();
  }
  const status =
    s.available && !s.turnOpen && s.phase !== "error"
      ? "Coach is quiet while you speak."
      : labels[s.phase];
  if (!s.available) return null;
  if (!s.turnOpen && !s.feedback.length)
    return (
      <Button size="sm" onClick={begin}>
        Pause &amp; ask coach
      </Button>
    );
  return (
    <section
      className="practice-coach"
      aria-label="Practice coach"
      data-reduced-motion={prefs.reduceMotion || undefined}
    >
      <div className="coach-identity">
        {prefs.avatarVisible && <Otter />}
        <div>
          <strong role="status" aria-live="polite">
            {status}
          </strong>
          <span className="muted">
            {s.input === "muted"
              ? "Coach input muted"
              : s.input === "starting"
                ? "Waiting for coach microphone"
                : s.input === "listening"
                  ? "Coach input listening"
                  : "Coach microphone off"}
            {s.outputMuted ? " · Coach voice off" : ""}
          </span>
        </div>
      </div>
      <div className="coach-actions">
        {!s.available ? (
          <>
            <Button size="sm" onClick={onSettings}>
              Open app settings
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                begin();
                setNotesOpen(true);
              }}
            >
              Type notes
            </Button>
          </>
        ) : !s.turnOpen ? (
          <Button size="sm" onClick={begin}>
            Pause &amp; ask coach
          </Button>
        ) : null}
        {s.playback === "speaking" && (
          <Button size="sm" onClick={() => controller.stopSpeaking()}>
            Stop speaking
          </Button>
        )}
      </div>
      {s.available && s.turnOpen && (
        <div className="coach-turn">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (share) {
                void controller.ask(question, {
                  shareContext: share,
                  voiceOutput: voice,
                });
                setQuestion("");
              }
            }}
          >
            <label className="field">
              Question for coach
              <Textarea
                value={question}
                maxLength={4000}
                onChange={(e) => setQuestion(e.target.value)}
              />
            </label>
            <label className="coach-consent">
              <input
                type="checkbox"
                checked={share}
                onChange={(e) => {
                  setShare(e.target.checked);
                  if (!e.target.checked) controller.stopInput();
                }}
              />
              Share my question, current slide and practice transcript with the
              coach
            </label>
            {s.voiceOutput && (
              <label className="coach-consent">
                <input
                  type="checkbox"
                  checked={voice}
                  onChange={(e) => {
                    setVoice(e.target.checked);
                    if (!e.target.checked) controller.muteOutput(true);
                  }}
                />
                Play this reply aloud
              </label>
            )}
            <div className="coach-actions">
              <Button
                type="submit"
                size="sm"
                disabled={
                  !share ||
                  !question.trim() ||
                  s.pending ||
                  s.task === "running"
                }
              >
                Send question
              </Button>
              {s.inputMode === "audio" &&
                (s.input === "off" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={!share || s.pending || s.task === "running"}
                    onClick={() =>
                      void controller.startInput({
                        shareContext: share,
                        microphone: true,
                        voiceOutput: voice,
                      })
                    }
                  >
                    Start coach microphone
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => controller.stopInput()}
                  >
                    Stop coach input
                  </Button>
                ))}
            </div>
          </form>
          <div className="coach-actions">
            {s.input !== "off" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => controller.muteInput(s.input !== "muted")}
              >
                {s.input === "muted"
                  ? "Unmute coach input"
                  : "Mute coach input"}
              </Button>
            )}
            {s.voiceOutput && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => controller.muteOutput(!s.outputMuted)}
              >
                {s.outputMuted ? "Turn coach voice on" : "Turn coach voice off"}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setNotesOpen((v) => !v)}
            >
              {notesOpen ? "Hide notes" : "Type notes"}
            </Button>
          </div>
        </div>
      )}
      {s.reply && (
        <div className="coach-reply">
          <h4>Coach reply</h4>
          <p>{s.reply}</p>
        </div>
      )}
      {s.feedback.length > 0 && <Feedback items={s.feedback} />}
      {s.task !== "idle" && (
        <p className="coach-task muted" role="status">
          {s.task === "running"
            ? "Coach task running"
            : s.task === "complete"
              ? "Coach task complete"
              : "Feedback incomplete; the service task may still be running."}
        </p>
      )}
      {notesOpen && (
        <label className="field coach-local-notes">
          Your practice notes
          <Textarea
            aria-label="Your practice notes"
            value={s.notes}
            maxLength={6000}
            onChange={(e) => controller.setNotes(e.target.value)}
          />
          <span className="muted">
            Your own notes, separate from coach feedback.
          </span>
        </label>
      )}
      {s.turnOpen && (
        <Button
          size="sm"
          onClick={() => {
            controller.resumePractice();
            setShare(false);
            setQuestion("");
            onResumePractice();
          }}
        >
          Resume practice
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="hide-companion"
        onClick={() =>
          practicePreferences.set({ avatarVisible: !prefs.avatarVisible })
        }
      >
        {prefs.avatarVisible ? "Hide companion" : "Show companion"}
      </Button>
    </section>
  );
}
const time = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
function Feedback({ items }: { items: CoachFeedback[] }) {
  return (
    <div className="coach-feedback">
      <h4>Coach feedback</h4>
      {items.map((item) => (
        <div key={item.id}>
          <p>{item.text}</p>
          {(item.slideId || item.interval) && (
            <small className="muted">
              {item.slideId ? `Slide reference: ${item.slideId}` : ""}
              {item.interval
                ? ` · Transcript ${time(item.interval.start)}–${time(item.interval.end)}`
                : ""}
            </small>
          )}
        </div>
      ))}
    </div>
  );
}
export function CoachReviewNotes({ rehearsalId }: { rehearsalId: string }) {
  const available = useCoachAvailability();
  const review = coachHistory.get(rehearsalId);
  if (
    !available ||
    !review?.available ||
    !review.feedback.some((item) => item.text.trim())
  )
    return null;
  return (
    <section className="coach-review-notes">
      <h3>Practice coach</h3>
      {review?.feedback.length ? (
        <Feedback items={review.feedback} />
      ) : (
        <p className="muted">
          No coach feedback was received for this practice.
        </p>
      )}
      {review?.incomplete && (
        <p>
          Feedback incomplete when practice ended. The service task may still be
          running.
        </p>
      )}
      {review?.notes && (
        <div>
          <h4>Your practice notes</h4>
          <p>{review.notes}</p>
        </div>
      )}
      <p className="muted">
        Coach notes last for this app session. Slide changes still require your
        approval.
      </p>
    </section>
  );
}
