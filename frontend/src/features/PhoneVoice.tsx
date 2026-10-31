import { useEffect, useState, useSyncExternalStore } from "react";
import { Smartphone, Mic, MicOff, Link2 } from "lucide-react";
import { Button, Input } from "../components/ui";
import { phoneVoice, type PhoneVoiceController } from "../services/phoneVoice";
import { RawMicrophoneCapture } from "../services/rawMicrophone";
import { PairingQr } from "./PairingQr";
import "./phone-voice.css";
export function usePhoneVoice(controller = phoneVoice) {
  return useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
}
const labels = {
  unavailable: "Not available",
  idle: "Not connected",
  pairing: "Waiting for phone",
  connecting: "Connecting…",
  connected: "Connected",
  disconnected: "Disconnected",
  error: "Connection failed",
};
function ConnectionStatus({
  controller,
}: {
  controller: PhoneVoiceController;
}) {
  const s = usePhoneVoice(controller);
  return (
    <div className="phone-status" role="status">
      <span className={`connection-dot ${s.status}`} aria-hidden="true" />
      {labels[s.status]}
      {s.deviceName && ` · ${s.deviceName}`}
    </div>
  );
}
export function PhoneSettings({
  controller = phoneVoice,
}: {
  controller?: PhoneVoiceController;
}) {
  const s = usePhoneVoice(controller),
    [copied, setCopied] = useState("");
  const busy = s.status === "connecting",
    pairing = s.status === "pairing",
    connected = s.status === "connected";
  return (
    <section className="phone-settings" aria-labelledby="voice-input-heading">
      <h3 id="voice-input-heading">
        <Smartphone aria-hidden="true" />
        Voice devices
      </h3>
      <div
        className="voice-source-options"
        role="group"
        aria-label="Voice input device"
      >
        <Button
          size="sm"
          variant={s.source === "local" ? "secondary" : "ghost"}
          aria-pressed={s.source === "local"}
          onClick={() => controller.selectSource("local")}
        >
          This device
        </Button>
        <Button
          size="sm"
          variant={s.source === "phone" ? "secondary" : "ghost"}
          aria-pressed={s.source === "phone"}
          disabled={!connected}
          onClick={() => controller.selectSource("phone")}
        >
          Phone
        </Button>
      </div>
      <ConnectionStatus controller={controller} />
      {s.status === "unavailable" ? (
        <p className="phone-notice">
          Phone connections are not available on this server yet.
        </p>
      ) : (
        <>
          {connected ? (
            <>
              <p role="status">
                {s.muted
                  ? "Mic muted"
                  : s.capturing
                    ? s.receivingAudio
                      ? "Receiving audio"
                      : "Waiting for audio"
                    : "Mic off"}
              </p>
              {s.transport === "raw-audio" &&
                s.receivingAudio &&
                !s.processingAvailable && (
                  <p className="muted">
                    Audio connected. Speech processing not connected.
                  </p>
                )}
              <div className="phone-actions">
                <Button size="sm" onClick={() => controller.setMuted(!s.muted)}>
                  {s.muted ? "Unmute phone" : "Mute phone"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => controller.disconnect()}
                >
                  Disconnect phone
                </Button>
              </div>
            </>
          ) : (
            !busy &&
            !pairing && (
              <Button size="sm" onClick={() => void controller.pair()}>
                <Link2 aria-hidden="true" />
                {s.status === "error" || s.status === "disconnected"
                  ? "Reconnect phone"
                  : "Connect phone"}
              </Button>
            )
          )}
          {s.pairing && (
            <div className="phone-setup">
              <div className="qr-pairing-layout">
                {s.pairing.qrUrl && <PairingQr url={s.pairing.qrUrl} />}
                <p>
                  Scan on the same network. Start the microphone on your phone.
                </p>
              </div>
              <details className="pairing-code">
                <summary>Use a pairing code instead</summary>
                <label htmlFor="pairing-code">Pairing code</label>
                <Input id="pairing-code" readOnly value={s.pairing.code} />
                <p className="muted">
                  Expires{" "}
                  {new Date(s.pairing.expiresAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(s.pairing!.code);
                      setCopied("Code copied.");
                    } catch {
                      setCopied("Select and copy the code.");
                    }
                  }}
                >
                  Copy code
                </Button>
                <span role="status">{copied}</span>
              </details>
            </div>
          )}
          {(busy || pairing) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => controller.disconnect()}
            >
              Cancel pairing
            </Button>
          )}
        </>
      )}
      {s.message && (
        <p role="alert" className="phone-notice">
          {s.message}
        </p>
      )}
    </section>
  );
}
function consumePairingCode() {
  const params = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const code = params.get("pair") ?? "";
  if (code)
    history.replaceState(
      history.state,
      "",
      location.pathname + location.search + "#phone",
    );
  return code;
}
export function PhoneSender({
  controller = phoneVoice,
  getUserMedia,
}: {
  controller?: PhoneVoiceController;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}) {
  const s = usePhoneVoice(controller),
    [code, setCode] = useState(consumePairingCode),
    [secureError, setSecureError] = useState("");
  const [capture] = useState(
    () =>
      new RawMicrophoneCapture({
        canCapture: () =>
          controller.getSnapshot().status === "connected" &&
          controller.getSnapshot().transport === "raw-audio",
        getUserMedia,
        attach: (stream) => controller.attachStream(stream),
        detach: () => controller.detachStream(),
        report: (ack) => controller.reportCapture(ack),
      }),
  );
  const mic = useSyncExternalStore(
      capture.subscribe,
      capture.getSnapshot,
      capture.getSnapshot,
    ),
    started = ["requesting", "capturing", "muted"].includes(mic.phase);
  function stop() {
    capture.stop();
    controller.setActive(false);
  }
  useEffect(() => {
    if (s.status !== "connected") capture.stop();
  }, [s.status, capture]);
  useEffect(() => {
    if (
      !s.active &&
      ["requesting", "capturing", "muted"].includes(capture.getSnapshot().phase)
    )
      capture.stop();
  }, [s.active, capture]);
  useEffect(() => {
    capture.setMuted(s.muted);
  }, [s.muted, capture]);
  useEffect(() => {
    if (mic.phase === "error") controller.setActive(false);
  }, [mic.phase, controller]);
  useEffect(() => {
    const nextPair = () => {
      if (location.hash.split("?")[0] !== "#phone") return;
      const next = consumePairingCode();
      if (next) {
        capture.stop();
        controller.disconnect();
        setCode(next);
      }
    };
    window.addEventListener("hashchange", nextPair);
    return () => window.removeEventListener("hashchange", nextPair);
  }, [capture, controller]);
  useEffect(() => {
    const hide = () => {
      capture.stop();
      controller.setActive(false);
    };
    const leave = () => {
      hide();
      controller.disconnect();
    };
    const visibility = () => {
      if (document.hidden) hide();
    };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      capture.dispose();
      controller.setActive(false);
      controller.disconnect();
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [capture, controller]);
  const permission = {
    "not-requested": "Not requested",
    pending: "Waiting for browser permission",
    granted: "Allowed",
    denied: "Blocked",
    unavailable: "Unavailable",
  }[mic.permission];
  async function start() {
    setSecureError("");
    if (!window.isSecureContext) {
      setSecureError("Use HTTPS to start the microphone.");
      return;
    }
    controller.setMuted(false);
    controller.setActive(true);
    await capture.start();
  }
  return (
    <main className="phone-sender">
      <a className="phone-brand" href="#folder/all">
        Talkdeck
      </a>
      <div className="phone-sender-card">
        <Smartphone className="phone-hero-icon" aria-hidden="true" />
        <h1>Phone microphone</h1>
        <ConnectionStatus controller={controller} />
        {s.status !== "connected" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void controller.join(code);
            }}
          >
            <label className="field">
              Pairing code
              <Input
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={128}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <Button
              type="submit"
              disabled={
                s.status === "unavailable" ||
                s.status === "connecting" ||
                !code.trim()
              }
            >
              {s.status === "connecting"
                ? "Connecting…"
                : s.status === "error" || s.status === "disconnected"
                  ? "Reconnect to presentation"
                  : "Connect to presentation"}
            </Button>
          </form>
        )}
        {s.status === "unavailable" && (
          <p className="phone-notice">
            Phone connections are not available on this server yet.
          </p>
        )}
        {s.message && (
          <p role="alert" className="phone-notice">
            {s.message}
          </p>
        )}
        <div className="sender-mic-status" role="status">
          {mic.phase === "capturing" ? (
            <Mic aria-hidden="true" />
          ) : (
            <MicOff aria-hidden="true" />
          )}
          <strong>
            {mic.phase === "requesting"
              ? "Waiting for microphone"
              : mic.phase === "capturing"
                ? "Microphone on"
                : mic.phase === "muted"
                  ? "Microphone muted"
                  : "Microphone off"}
          </strong>
          <span>Permission: {permission}</span>
        </div>
        {(mic.message || secureError) && (
          <p role="alert">{mic.message || secureError}</p>
        )}
        <div className="phone-actions">
          <Button
            disabled={s.status !== "connected" || s.transport !== "raw-audio"}
            onClick={started ? stop : () => void start()}
          >
            {started ? "Stop microphone" : "Start microphone"}
          </Button>
          <Button
            variant="ghost"
            disabled={!started || mic.phase === "requesting"}
            onClick={() => controller.setMuted(!s.muted)}
          >
            {s.muted ? "Unmute microphone" : "Mute microphone"}
          </Button>
          <Button
            variant="ghost"
            disabled={
              s.status === "unavailable" ||
              s.status === "idle" ||
              s.status === "disconnected"
            }
            onClick={() => {
              stop();
              controller.disconnect();
            }}
          >
            Disconnect
          </Button>
        </div>
        <details>
          <summary>Microphone help</summary>
          <p className="muted">
            Start sends raw audio to your paired desktop. Mute stops outgoing
            audio; Stop releases the microphone. Backgrounding stops capture.
            Resume with Start.
          </p>
        </details>
      </div>
    </main>
  );
}
