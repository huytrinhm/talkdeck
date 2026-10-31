import { useState, useSyncExternalStore } from "react";
import { KeyRound, Eye, EyeOff } from "lucide-react";
import { Button, Input } from "../components/ui";
import {
  personalApiKey,
  type PersonalApiKeyController,
} from "../services/personalApiKey";
import "./api-key-settings.css";
const errors = {
  permission: "This key cannot list models. Check its permissions.",
  "rate-limited": "Too many checks. Wait, then Retry.",
  "key-required": "No key is saved for this session.",
  "invalid-key": "The key could not be verified. Re-enter it and try again.",
  unauthenticated:
    "Your visitor session expired. Refresh this app before adding a key.",
  network:
    "The key service could not connect. Check your connection and try again.",
  unknown:
    "The key operation could not be confirmed. Check its status before trying again.",
};
export function ApiKeySettings({
  controller = personalApiKey,
}: {
  controller?: PersonalApiKeyController;
}) {
  const state = useSyncExternalStore(
      controller.subscribe,
      controller.getSnapshot,
      controller.getSnapshot,
    ),
    [draft, setDraft] = useState(""),
    [reveal, setReveal] = useState(false),
    [editing, setEditing] = useState(false),
    [error, setError] = useState("");
  const busy = ["loading", "saving", "removing", "verifying"].includes(
      state.phase,
    ),
    showForm = !state.configured || editing;
  const clear = () => {
    setDraft("");
    setReveal(false);
    setError("");
  };
  async function save() {
    if (!state.available || busy) return;
    if (!draft.trim()) {
      setError("Enter an API key.");
      return;
    }
    const submitted = draft.trim();
    clear();
    await controller.save(submitted);
    if (controller.getSnapshot().phase === "idle") setEditing(false);
  }
  return (
    <section
      className="api-key-settings"
      aria-labelledby="api-key-heading"
      aria-busy={busy}
    >
      <h3 id="api-key-heading">
        <KeyRound aria-hidden="true" />
        Your API key
      </h3>
      <p className="muted">For this session · Your OpenAI billing</p>
      {!state.available && (
        <p className="api-key-notice">
          Personal API keys are not supported on this server yet.
        </p>
      )}
      {state.phase === "loading" && <p role="status">Checking key status…</p>}
      {state.configured && !editing && state.phase !== "error" && (
        <p role="status">
          <span aria-label="Saved API key">••••••••</span> · API key configured.{" "}
          <span>
            {state.validation === "verified" ? "Key verified" : "Not verified"}
          </span>
        </p>
      )}
      {state.phase === "error" && (
        <p role="alert">{errors[state.error ?? "unknown"]}</p>
      )}
      {showForm && state.available && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          autoComplete="off"
        >
          <label className="field" htmlFor="personal-api-key">
            OpenAI API key
          </label>
          <div className="api-key-input">
            <Input
              id="personal-api-key"
              type={reveal ? "text" : "password"}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={1024}
              disabled={!state.available || busy || state.needsReconciliation}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setError("");
              }}
            />
            <Button
              type="button"
              variant="ghost"
              aria-label={reveal ? "Hide API key" : "Show API key"}
              aria-pressed={reveal}
              disabled={!state.available || busy || state.needsReconciliation}
              onClick={() => setReveal((value) => !value)}
            >
              {reveal ? (
                <EyeOff aria-hidden="true" />
              ) : (
                <Eye aria-hidden="true" />
              )}
              <span>{reveal ? "Hide" : "Show"}</span>
            </Button>
          </div>
          {error && <p role="alert">{error}</p>}
          <div className="api-key-actions">
            <Button
              type="submit"
              disabled={!state.available || busy || state.needsReconciliation}
            >
              {state.phase === "saving"
                ? state.verifiesOnSave
                  ? "Verifying…"
                  : "Saving…"
                : editing
                  ? "Save replacement"
                  : state.verifiesOnSave
                    ? "Save & verify"
                    : "Save for session"}
            </Button>
            {editing && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy || state.needsReconciliation}
                onClick={() => {
                  clear();
                  setEditing(false);
                }}
              >
                Cancel replacement
              </Button>
            )}
          </div>
        </form>
      )}
      {state.available && state.configured && !editing && (
        <div className="api-key-actions">
          {state.canVerify && (
            <Button
              disabled={busy || state.needsReconciliation}
              onClick={() => void controller.verify()}
            >
              {state.phase === "verifying" ? "Checking key…" : "Check key"}
            </Button>
          )}
          <Button
            disabled={busy || state.needsReconciliation}
            onClick={() => {
              clear();
              setEditing(true);
            }}
          >
            Replace key
          </Button>
          <Button
            variant="ghost"
            disabled={busy || state.needsReconciliation}
            onClick={() => {
              clear();
              void controller.remove();
            }}
          >
            {state.phase === "removing" ? "Removing…" : "Remove key"}
          </Button>
        </div>
      )}
      <details className="api-key-help">
        <summary>About your key</summary>
        <p className="muted">
          No ChatGPT sign-in is required. Your key is cleared from this form on
          submit and is never saved with projects or in localStorage.{" "}
          {state.available
            ? "Saved keys expire within one hour."
            : "Key storage is not connected."}{" "}
          Check key verifies credential/model-list access; it does not prove
          model availability or API credits.
        </p>
      </details>
      {state.available && state.phase === "error" && (
        <Button variant="ghost" onClick={() => void controller.refresh()}>
          Check key status
        </Button>
      )}
    </section>
  );
}
