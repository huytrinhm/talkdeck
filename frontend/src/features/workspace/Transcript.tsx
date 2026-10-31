import type { ReactNode } from "react";
import type { TranscriptSegment } from "../../domain/types";
const time = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
export function Transcript({
  segments,
  interim,
  sessionIds = new Set<string>(),
  variant = "sidebar",
  renderText,
  renderDetail,
}: {
  segments: TranscriptSegment[];
  interim: string;
  sessionIds?: ReadonlySet<string>;
  variant?: "sidebar" | "presenter" | "review";
  renderText?: (segment: TranscriptSegment) => ReactNode;
  renderDetail?: (segment: TranscriptSegment) => ReactNode;
}) {
  const live = interim.trim();
  return (
    <div className={`transcript transcript-${variant}`}>
      {!segments.length && !live && (
        <div className="transcript-empty">
          <strong>Ready when you are</strong>
          <p className="idle">Your words appear here as you speak.</p>
        </div>
      )}
      {([false, true] as const).map((current) => {
        const phrases = segments.filter(
          (s) => sessionIds.has(s.id) === current,
        );
        if (!phrases.length) return null;
        return (
          <section key={String(current)}>
            <h3 className="muted transcript-session-label">
              {current ? "This session" : "Saved transcript"}
            </h3>
            <ol
              className="transcript-phrases"
              aria-label={
                current ? "Current session narration" : "Saved transcript"
              }
            >
              {phrases.map((s) => (
                <li
                  className="transcript-phrase"
                  data-last-phrase={
                    (!live && s.id === segments.at(-1)?.id) || undefined
                  }
                  key={s.id}
                >
                  <div className="phrase-meta">
                    <span>
                      {current ? "Narration" : "Saved narration"}
                      {s.inputSource
                        ? ` · ${s.inputSource === "phone" ? "Phone microphone" : "This device"}`
                        : ""}
                    </span>
                    <time>
                      {time(s.start)} – {time(s.end)}
                    </time>
                  </div>
                  <p>{renderText ? renderText(s) : s.text}</p>
                  {renderDetail?.(s)}
                  {s.provisional && (
                    <small className="muted">Unfinished phrase</small>
                  )}
                </li>
              ))}
            </ol>
          </section>
        );
      })}
      {live && (
        <div className="transcript-phrase interim" data-last-phrase>
          <div className="phrase-meta">
            <span>Speaking now</span>
            <span className="transcript-live-dot" aria-hidden="true" />
          </div>
          <p>{live}</p>
        </div>
      )}
    </div>
  );
}
