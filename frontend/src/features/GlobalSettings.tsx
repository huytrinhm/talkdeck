import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import {
  Button,
  Modal,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../components/ui";
import { PhoneSettings } from "./PhoneVoice";
import { ApiKeySettings } from "./ApiKeySettings";
import {
  practicePreferences,
  usePracticePreferences,
} from "../services/practicePreferences";
import { useCoachAvailability } from "../services/practiceCoach";
import "./global-settings.css";
export type SettingsTab = "connections" | "coach" | "preferences";
export function GlobalSettings({
  open,
  onOpenChange,
  initialTab = "connections",
  returnLabel = "Back to presentation",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: SettingsTab;
  returnLabel?: string;
}) {
  const [tab, setTab] = useState<string>(initialTab);
  const preferences = usePracticePreferences(),
    coachAvailable = useCoachAvailability();
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
      <Tabs value={tab} onValueChange={setTab} className="settings-layout">
        <TabsList
          className="settings-navigation"
          aria-label="App settings sections"
        >
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="coach">Coach</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
        </TabsList>
        <div className="settings-body">
          {tab === "connections" && (
            <TabsContent value="connections">
              <h2>Connections</h2>
              <p className="muted">
                Your connections apply across your projects.
              </p>
              <PhoneSettings />
              <ApiKeySettings />
              <details className="voice-privacy">
                <summary>Voice and privacy</summary>
                <p className="muted">
                  Speech recognition may use your browser’s online service.
                  Audio recordings are not saved by this app. Device selection
                  does not start capture.
                </p>
              </details>
            </TabsContent>
          )}
          {tab === "coach" && (
            <TabsContent value="coach">
              <h2>Practice coach</h2>
              <p role="status">
                {coachAvailable
                  ? "Coach service available. Start a coach turn in Practice."
                  : "Live coach is not connected."}
              </p>
              <p className="muted">
                Practice and your own notes remain available. A personal key
                alone does not connect the coach.
              </p>
              <Preference
                label="Allow spoken coach replies"
                checked={preferences.voiceReplies}
                onChange={(voiceReplies) =>
                  practicePreferences.set({ voiceReplies })
                }
              />
              <p className="muted">
                Voice replies need a connected coach and your explicit turn
                consent. Turning voice off leaves text replies available.
              </p>
            </TabsContent>
          )}
          {tab === "preferences" && (
            <TabsContent value="preferences">
              <h2>Preferences</h2>
              <Preference
                label="Show practice companion"
                checked={preferences.avatarVisible}
                onChange={(avatarVisible) =>
                  practicePreferences.set({ avatarVisible })
                }
              />
              <Preference
                label="Reduce companion motion"
                checked={preferences.reduceMotion}
                onChange={(reduceMotion) =>
                  practicePreferences.set({ reduceMotion })
                }
              />
              <p className="muted">
                Feedback stays visible when the companion is hidden. System
                reduced motion is always respected.
              </p>
            </TabsContent>
          )}
          <p className="settings-session-note muted">
            Connections apply across your projects in this browser.
          </p>
        </div>
      </Tabs>
    </Modal>
  );
}
function Preference({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="settings-preference">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
