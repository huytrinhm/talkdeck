import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { Button, Modal } from "../components/ui";
import {
  practicePreferences,
  usePracticePreferences,
} from "../services/practicePreferences";
import "./global-settings.css";
/** Old target names remain source-compatible for unmounted future integrations. */
export type SettingsTab = "connections" | "coach" | "preferences";
export function GlobalSettings({
  open,
  onOpenChange,
  returnLabel = "Back to presentation",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: SettingsTab;
  returnLabel?: string;
}) {
  const preferences = usePracticePreferences();
  useEffect(() => {
    document.documentElement.dataset.reduceMotion = String(
      preferences.reduceMotion,
    );
  }, [preferences.reduceMotion]);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="App settings"
      className="global-settings"
    >
      <Button
        variant="ghost"
        className="settings-back"
        onClick={() => onOpenChange(false)}
      >
        <ArrowLeft />
        {returnLabel}
      </Button>
      <section className="settings-body">
        <h2>Preferences</h2>
        <label className="settings-preference">
          <input
            type="checkbox"
            checked={preferences.reduceMotion}
            onChange={(e) =>
              practicePreferences.set({ reduceMotion: e.target.checked })
            }
          />
          <span>Reduce motion</span>
        </label>
        <details className="voice-privacy">
          <summary>Voice and privacy</summary>
          <p className="muted">
            Speech recognition may use your browser’s online service. This app
            does not save audio recordings.
          </p>
        </details>
      </section>
    </Modal>
  );
}
