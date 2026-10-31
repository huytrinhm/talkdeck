import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Presentation,
  RotateCcw,
  X,
} from "lucide-react";
import {
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../components/ui";
import { SlideView } from "../components/SlideView";
import type { Project, TranscriptSegment } from "../domain/types";
import {
  clarityMatches,
  decideProposal,
  paceTimeline,
  wordCount,
} from "../domain/review";
import "./review.css";
import { CoachReviewNotes } from "./PracticeCoach";
const time = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
function MarkedTranscript({ segment }: { segment: TranscriptSegment }) {
  const matches = clarityMatches(segment.text);
  let end = 0;
  const parts = matches.flatMap((m, i) => {
    const prefix = segment.text.slice(end, m.index);
    end = m.index + m.text.length;
    return [prefix, <mark key={i}>{m.text}</mark>];
  });
  return (
    <p>
      <span className="review-time">
        {time(segment.start)}–{time(segment.end)}
      </span>{" "}
      {parts}
      {segment.text.slice(end)}
    </p>
  );
}
export function Review({
  project,
  onChange,
  onAgain,
  onPresent,
  onDone,
}: {
  project: Project;
  onChange: (project: Project) => void;
  onAgain: () => void;
  onPresent: () => void;
  onDone: () => void;
}) {
  const rehearsal = project.rehearsals.at(-1);
  const [tab, setTab] = useState("overview"),
    [index, setIndex] = useState(0),
    [cursor, setCursor] = useState(0),
    [complete, setComplete] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      if (
        tab !== "changes" ||
        complete ||
        !rehearsal ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.target instanceof Element &&
          event.target.closest(
            'input,textarea,select,button,[contenteditable="true"],[role="dialog"],[role="menu"]',
          ))
      )
        return;
      const delta =
        event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      if (delta) {
        event.preventDefault();
        setIndex((i) =>
          Math.max(0, Math.min(rehearsal.snapshot.length - 1, i + delta)),
        );
        setCursor(0);
        setError("");
      }
    };
    window.addEventListener("keydown", navigate);
    return () => window.removeEventListener("keydown", navigate);
  }, [tab, complete, rehearsal]);
  if (!rehearsal)
    return (
      <main className="review-page">
        <Button onClick={onDone}>
          <ArrowLeft /> Back to slides
        </Button>
        <h1>No practice session yet</h1>
        <p>
          Practice with your slides to capture speech and review your delivery.
        </p>
        <Button onClick={onAgain}>Practice</Button>
      </main>
    );
  const pending = rehearsal.proposals.filter((p) => p.status === "pending"),
    approved = rehearsal.proposals.filter(
      (p) => p.status === "accepted",
    ).length,
    rejected = rehearsal.proposals.filter(
      (p) => p.status === "rejected",
    ).length;
  const words = rehearsal.transcript.reduce((n, t) => n + wordCount(t.text), 0),
    covered = new Set(
      rehearsal.transcript
        .filter((t) => wordCount(t.text))
        .map((t) => t.slideId),
    ).size,
    wpm =
      rehearsal.elapsed > 0 ? Math.round((words * 60) / rehearsal.elapsed) : 0;
  const slide = rehearsal.snapshot[index],
    suggestions = rehearsal.proposals.filter((p) => p.slideId === slide?.id),
    proposal = suggestions[cursor] ?? suggestions[0],
    segments = rehearsal.transcript.filter((t) => t.slideId === slide?.id),
    vague = rehearsal.transcript.reduce(
      (n, t) => n + clarityMatches(t.text).length,
      0,
    ),
    timeline = paceTimeline(rehearsal.transcript, rehearsal.elapsed),
    maxPace = Math.max(200, ...timeline.map((t) => t.wpm));
  const chooseSlide = (n: number) => {
    setIndex(n);
    setCursor(0);
    setError("");
  };
  const remaining = () => {
    const first = pending[0];
    if (first) {
      setTab("changes");
      chooseSlide(
        Math.max(
          0,
          rehearsal.snapshot.findIndex((s) => s.id === first.slideId),
        ),
      );
      setCursor(
        rehearsal.proposals
          .filter((p) => p.slideId === first.slideId)
          .findIndex((p) => p.id === first.id),
      );
    }
  };
  const decide = (decision: "accepted" | "rejected") => {
    if (!proposal) return;
    const result = decideProposal(project, rehearsal.id, proposal.id, decision);
    if (result.error) {
      setError(result.error);
      return;
    }
    onChange(result.project);
    setError("");
    const next = suggestions.findIndex(
      (p, i) => i > cursor && p.status === "pending",
    );
    if (next >= 0) setCursor(next);
  };
  const finish = () => {
    const next = structuredClone(project);
    next.rehearsals.find((r) => r.id === rehearsal.id)!.completedAt =
      Date.now();
    onChange(next);
    onDone();
  };
  if (complete)
    return (
      <main className="review-complete">
        <span className="review-success">
          <Check size={30} />
        </span>
        <h1>Review complete</h1>
        <p>Your decisions are saved.</p>
        <div className="review-counts">
          <div>
            <strong>{approved}</strong>Approved
          </div>
          <div>
            <strong>{rejected}</strong>Rejected
          </div>
        </div>
        {covered < rehearsal.snapshot.length && (
          <p className="muted">
            {rehearsal.snapshot.length - covered}{" "}
            {rehearsal.snapshot.length - covered === 1
              ? "slide was"
              : "slides were"}{" "}
            not rehearsed.
          </p>
        )}
        <div className="review-actions">
          <Button onClick={onAgain}>
            <RotateCcw />
            Practice again
          </Button>
          <Button variant="primary" onClick={finish}>
            Done
          </Button>
        </div>
      </main>
    );
  return (
    <main className="review-page">
      <header className="review-header">
        <div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back to slides"
            onClick={onDone}
          >
            <ArrowLeft />
          </Button>
          <h1>Practice review</h1>
        </div>
        <div>
          <Button onClick={onAgain}>
            <RotateCcw />
            Practice again
          </Button>
          <Button onClick={onPresent}>
            <Presentation />
            Present
          </Button>
        </div>
      </header>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value);
          if (value === "changes") chooseSlide(0);
        }}
      >
        <div className="review-tabs">
          <TabsList aria-label="Practice review sections">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="changes" onClick={() => chooseSlide(0)}>
              Slide changes{" "}
              {pending.length > 0 && (
                <span className="review-badge">{pending.length}</span>
              )}
            </TabsTrigger>
          </TabsList>
          <Button
            variant={pending.length ? "default" : "primary"}
            onClick={() => (pending.length ? remaining() : setComplete(true))}
          >
            Done
          </Button>
        </div>
        <TabsContent value="overview" className="review-overview">
          <h2>Your practice, at a glance</h2>
          <CoachReviewNotes rehearsalId={rehearsal.id} />
          <p className="muted">
            Review your delivery and choose which slide changes to keep.
          </p>
          <dl className="review-statistics">
            <div>
              <dt>Rehearsal time</dt>
              <dd>{time(rehearsal.elapsed)}</dd>
            </div>
            <div>
              <dt>Slides rehearsed</dt>
              <dd>
                {covered}
                <small> / {rehearsal.snapshot.length}</small>
              </dd>
            </div>
            <div>
              <dt>Words per minute</dt>
              <dd>{words && rehearsal.elapsed > 0 ? wpm : "—"}</dd>
            </div>
          </dl>
          <section className="review-speed">
            <h3>Speaking pace</h3>
            {timeline.length ? (
              <>
                <div className="review-chart">
                  <div className="review-chart-axis">
                    <span>{maxPace}</span>
                    <span>0</span>
                  </div>
                  <div className="review-bars">
                    {timeline.map((interval, i) => (
                      <div
                        key={i}
                        tabIndex={0}
                        role="img"
                        aria-label={`${time(interval.start)} to ${time(interval.end)}: estimated ${interval.wpm} words per minute`}
                        title={`${time(interval.start)}–${time(interval.end)} · ${interval.wpm} WPM`}
                        style={{
                          height: `${Math.max(1, (interval.wpm / maxPace) * 100)}%`,
                        }}
                      />
                    ))}
                  </div>
                </div>
                <div className="review-chart-times">
                  <span>0:00</span>
                  <span>{time(rehearsal.elapsed)}</span>
                </div>
              </>
            ) : (
              <p className="review-no-data">
                No speech captured yet. Practice again to see your speaking
                pace.
              </p>
            )}
            {timeline.length > 0 && (
              <p className="muted review-small">
                Estimated speaking pace, including pauses.
              </p>
            )}
          </section>
          {words > 0 && (
            <div
              className={`review-feedback ${!words ? "neutral" : wpm >= 100 && wpm <= 180 ? "positive" : "attention"}`}
            >
              <h3>
                Pace ·{" "}
                {!words
                  ? "No data"
                  : wpm < 100
                    ? "Measured"
                    : wpm > 180
                      ? "Fast"
                      : "Steady"}
              </h3>
              <p>
                {!words
                  ? "Practice again and speak to see your pace."
                  : wpm < 100
                    ? "Leave room for explanation while keeping your points moving."
                    : wpm > 180
                      ? "Try slowing down and pausing between your main points."
                      : "Your overall pace falls within the 100–180 words per minute guide."}
              </p>
            </div>
          )}
          {vague > 0 && (
            <div
              className={`review-feedback ${vague ? "attention" : "neutral"}`}
            >
              <h3>Clarity · {vague ? "Needs attention" : "Keep in mind"}</h3>
              <p>
                {vague
                  ? `${vague} vague ${vague === 1 ? "phrase" : "phrases"} matched in your transcript. Name the specific idea or object when possible.`
                  : "Use specific terms and explain how each point connects."}
              </p>
            </div>
          )}
        </TabsContent>
        <TabsContent value="changes" className="review-changes">
          {slide ? (
            <>
              <div className="review-slide-nav">
                <Button
                  disabled={index === 0}
                  aria-label="Previous slide"
                  onClick={() => chooseSlide(index - 1)}
                >
                  <ChevronLeft />
                  {rehearsal.proposals.filter(
                    (p) =>
                      p.status === "pending" &&
                      rehearsal.snapshot.findIndex((s) => s.id === p.slideId) <
                        index,
                  ).length || ""}
                </Button>
                <span>
                  Slide {index + 1} of {rehearsal.snapshot.length} ·{" "}
                  {slide.title}
                </span>
                <Button
                  disabled={index === rehearsal.snapshot.length - 1}
                  aria-label="Next slide"
                  onClick={() => chooseSlide(index + 1)}
                >
                  {rehearsal.proposals.filter(
                    (p) =>
                      p.status === "pending" &&
                      rehearsal.snapshot.findIndex((s) => s.id === p.slideId) >
                        index,
                  ).length || ""}
                  <ChevronRight />
                </Button>
              </div>
              {proposal ? (
                <>
                  {suggestions.length > 1 && (
                    <div className="review-actions">
                      <Button
                        disabled={cursor === 0}
                        onClick={() => setCursor(cursor - 1)}
                      >
                        Previous suggestion
                      </Button>
                      <span>
                        {cursor + 1} / {suggestions.length}
                      </span>
                      <Button
                        disabled={cursor === suggestions.length - 1}
                        onClick={() => setCursor(cursor + 1)}
                      >
                        Next suggestion
                      </Button>
                    </div>
                  )}
                  <div className="review-comparison">
                    <section
                      className={
                        proposal.status === "accepted" ? "unchosen" : ""
                      }
                    >
                      <h3>
                        Before{" "}
                        <small>
                          {proposal.status === "accepted"
                            ? "Original"
                            : proposal.status === "rejected"
                              ? "Kept"
                              : ""}
                        </small>
                      </h3>
                      <div className="review-before slide-frame">
                        <SlideView
                          slide={proposal.before}
                          compare={proposal.after}
                          diff="removed"
                        />
                      </div>
                    </section>
                    <section
                      className={
                        proposal.status === "rejected" ? "unchosen" : ""
                      }
                    >
                      <h3>
                        After{" "}
                        <small>
                          {proposal.status === "accepted"
                            ? "Applied"
                            : proposal.status === "rejected"
                              ? "Not applied"
                              : ""}
                        </small>
                      </h3>
                      <div className="review-after slide-frame">
                        <SlideView
                          slide={proposal.after}
                          compare={proposal.before}
                          diff="added"
                        />
                      </div>
                      {proposal.extraSlides?.map((s) => (
                        <div
                          className="review-after review-extra slide-frame"
                          key={s.id}
                        >
                          <SlideView slide={s} diff="added" />
                        </div>
                      ))}
                    </section>
                  </div>
                  <div className="review-suggestion">
                    <div>
                      <h2>{proposal.title}</h2>
                      <p>{proposal.reason}</p>
                    </div>
                    <span className={`review-decision ${proposal.status}`}>
                      {proposal.status === "accepted" ? (
                        <Check size={14} />
                      ) : proposal.status === "rejected" ? (
                        <X size={14} />
                      ) : null}
                      {proposal.status === "pending"
                        ? "Suggested"
                        : proposal.status === "accepted"
                          ? "Approved"
                          : "Rejected"}
                    </span>
                  </div>
                  {proposal.type === "reorder" && (
                    <p>
                      Proposed slide order:{" "}
                      {proposal.order
                        ?.map(
                          (id) =>
                            rehearsal.snapshot.find((s) => s.id === id)
                              ?.title ?? id,
                        )
                        .join(" → ")}
                    </p>
                  )}
                  {proposal.status === "pending" && (
                    <div className="review-actions review-decisions">
                      <Button
                        className="approve"
                        onClick={() => decide("accepted")}
                      >
                        <Check />
                        Approve
                      </Button>
                      <Button
                        className="reject"
                        onClick={() => decide("rejected")}
                      >
                        <X />
                        Reject
                      </Button>
                    </div>
                  )}
                  {error && (
                    <p role="alert" className="review-error">
                      {error}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <h2>
                    {segments.length
                      ? "No slide changes suggested"
                      : "Not rehearsed yet"}
                  </h2>
                  <p className="muted">
                    {segments.length
                      ? "Your existing slide is kept."
                      : "No captured speech for this slide. Practice again to add an explanation."}
                  </p>
                  <div className="review-single slide-frame">
                    <SlideView slide={slide} />
                  </div>
                </>
              )}
              {pending.length > 0 && (
                <div className="review-remaining">
                  <span>
                    {pending.length}{" "}
                    {pending.length === 1
                      ? "suggestion remains"
                      : "suggestions remain"}{" "}
                    to review.
                  </span>
                  <Button onClick={remaining}>Review remaining</Button>
                </div>
              )}
              <section className="review-transcript">
                <h3>Captured transcript</h3>
                {segments.length ? (
                  segments.map((t) => (
                    <div key={t.id}>
                      <MarkedTranscript segment={t} />
                      {clarityMatches(t.text).length > 0 ? (
                        <p className="review-comment">
                          Name the specific concept instead of the highlighted
                          phrase.
                        </p>
                      ) : (
                        <p className="review-comment">
                          {t.text.trim().toLowerCase() ===
                          slide.title.trim().toLowerCase()
                            ? "Go beyond the heading and explain what it means."
                            : "Connect this explanation to the key idea on your slide."}
                        </p>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="muted">No captured speech.</p>
                )}
              </section>
            </>
          ) : (
            <p>No slides in this rehearsal.</p>
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}
