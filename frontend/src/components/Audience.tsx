import { useEffect, useState } from "react";
import { ArrowLeft, Maximize, ExternalLink } from "lucide-react";
import { Button } from "./ui";
import { SlideView } from "./SlideView";
import { subscribeAudience, type AudiencePayload } from "../services/audience";
export function Audience({
  projectId,
  payload,
  onClose,
}: {
  projectId: string;
  payload?: AudiencePayload;
  onClose?: () => void;
}) {
  const [remote, setRemote] = useState<AudiencePayload | null>(null);
  const [fullscreen, setFullscreen] = useState(
      Boolean(document.fullscreenElement),
    ),
    [fullscreenError, setFullscreenError] = useState("");
  useEffect(() => {
    const change = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  const enterFullscreen = () => {
    if (document.fullscreenElement) return;
    setFullscreenError("");
    if (!document.documentElement.requestFullscreen) {
      setFullscreenError("Fullscreen is unavailable in this browser.");
      return;
    }
    void document.documentElement
      .requestFullscreen()
      .catch(() =>
        setFullscreenError(
          "Fullscreen could not open. Use your browser’s fullscreen control.",
        ),
      );
  };
  useEffect(() => subscribeAudience(projectId, setRemote), [projectId]);
  const p = payload ?? remote;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && document.fullscreenElement) {
        void document.exitFullscreen?.();
        return;
      }
      if (e.key === "Escape" || e.key.toLowerCase() === "a") onClose?.();
      if (e.key.toLowerCase() === "f") enterFullscreen();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <main
      className="audience-output"
      aria-label="Audience display"
      onDoubleClick={enterFullscreen}
    >
      {p?.black ? null : p?.ended ? (
        <p className="muted">Presentation ended</p>
      ) : p?.slide ? (
        <div className="slide-frame">
          <SlideView slide={{ ...p.slide, notes: "" }} />
        </div>
      ) : (
        <p className="muted">Waiting for presentation…</p>
      )}
      <div className="audience-tools">
        {onClose && (
          <Button onClick={onClose}>
            <ArrowLeft />
            Return
          </Button>
        )}
        {!fullscreen && (
          <Button aria-label="Fullscreen (F)" onClick={enterFullscreen}>
            <Maximize />
          </Button>
        )}
        {fullscreenError && <span role="status">{fullscreenError}</span>}
        {onClose && (
          <Button
            onClick={() => {
              const w = window.open(
                `${import.meta.env.BASE_URL}audience.html?project=${encodeURIComponent(projectId)}`,
                "talkdeck-audience",
              );
              if (!w)
                alert(
                  "The audience window was blocked. Allow popups and try again.",
                );
            }}
          >
            <ExternalLink />
            Separate window
          </Button>
        )}
      </div>
    </main>
  );
}
