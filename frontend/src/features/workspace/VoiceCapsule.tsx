import { Mic, MicOff, Pause, Play, X } from "lucide-react";
import { Button } from "../../components/ui";
import type { SpeechState } from "../../services/speech";
export function VoiceCapsule({
  state,
  level,
  agent = false,
  showTarget = false,
  canTarget = false,
  onPause,
  onTarget,
  onMute,
}: {
  state: SpeechState;
  level: number;
  agent?: boolean;
  showTarget?: boolean;
  canTarget?: boolean;
  onPause: () => void;
  onTarget: () => void;
  onMute: () => void;
}) {
  const connecting = state.status === "connecting",
    busy = connecting || state.status === "listening";
  const listening = state.status === "listening" && !state.muted;
  const amplitude = Number.isFinite(level)
    ? Math.max(0, Math.min(1, level))
    : 0;
  const label = connecting
    ? "Cancel microphone"
    : busy
      ? "Pause (P)"
      : "Resume (P)";
  return (
    <div
      className={`voice-capsule ${agent ? "agent" : ""} ${state.muted ? "muted" : ""}`}
    >
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        title={label}
        data-speech-action={connecting ? "cancel" : busy ? "pause" : "resume"}
        onClick={onPause}
      >
        {connecting ? (
          <X data-slot="cancel-icon" aria-hidden="true" />
        ) : busy ? (
          <Pause aria-hidden="true" />
        ) : (
          <Play aria-hidden="true" />
        )}
      </Button>
      <div
        className="waveform"
        aria-label={listening ? "Microphone level" : "Microphone idle"}
      >
        {Array.from({ length: 18 }, (_, i) => (
          <span
            key={i}
            style={{
              height: listening
                ? 3 +
                  27 *
                    amplitude *
                    (0.35 + 0.65 * Math.sin(((i + 1) * Math.PI) / 19) ** 2)
                : 3,
              background: listening ? "var(--foreground)" : undefined,
            }}
          />
        ))}
      </div>
      {showTarget && (
        <Button
          variant="secondary"
          className="voice-target"
          aria-pressed={agent}
          disabled={!canTarget}
          onClick={onTarget}
        >
          To the {agent ? "agent" : "audience"}
          <kbd>Space</kbd>
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        aria-label={state.muted ? "Unmute (M)" : "Mute (M)"}
        title={state.muted ? "Unmute (M)" : "Mute (M)"}
        aria-pressed={state.muted}
        className={state.muted ? "panel-selected" : ""}
        onClick={onMute}
      >
        {state.muted ? (
          <MicOff aria-hidden="true" />
        ) : (
          <Mic aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}
