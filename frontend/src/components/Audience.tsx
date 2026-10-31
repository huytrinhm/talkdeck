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
  useEffect(() => subscribeAudience(projectId, setRemote), [projectId]);
  const p = payload ?? remote;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key.toLowerCase() === "a") onClose?.();
      if (e.key.toLowerCase() === "f")
        void document.documentElement.requestFullscreen?.();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <main
      className="audience-output"
      aria-label="Audience display"
      onDoubleClick={() => void document.documentElement.requestFullscreen?.()}
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
        <Button
          aria-label="Fullscreen (F)"
          onClick={() => void document.documentElement.requestFullscreen?.()}
        >
          <Maximize />
        </Button>
        {onClose && (
          <Button
            onClick={() => {
              const w = window.open(
                `/audience.html?project=${encodeURIComponent(projectId)}`,
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
