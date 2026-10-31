import type { CaptureAcknowledgement } from "./phoneVoice";
export interface RawMicrophoneSnapshot {
  phase: "idle" | "requesting" | "capturing" | "muted" | "error";
  permission: CaptureAcknowledgement["permission"];
  message?: string;
}
export interface RawMicrophoneOptions {
  canCapture: () => boolean;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  attach: (stream: MediaStream) => Promise<void>;
  /** Synchronously stop forwarding audio; capture tracks are also stopped locally. */
  detach: () => void;
  report: (ack: CaptureAcknowledgement) => void;
}
/** Raw audio only. No SpeechRecognition, recordings, playback or automatic restart. */
export class RawMicrophoneCapture {
  private state: RawMicrophoneSnapshot = {
    phase: "idle",
    permission: "not-requested",
  };
  private listeners = new Set<() => void>();
  private stream?: MediaStream;
  private epoch = 0;
  private disposed = false;
  private muted = false;
  private ended = () => {
    if (this.stream) {
      this.stop();
      this.update({
        phase: "error",
        message: "Microphone stopped. Tap Start to reconnect.",
      });
    }
  };
  constructor(private options: RawMicrophoneOptions) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private update(patch: Partial<RawMicrophoneSnapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  private release(stream: MediaStream) {
    for (const track of stream.getTracks()) {
      track.removeEventListener("ended", this.ended);
      track.stop();
    }
  }
  private valid(epoch: number) {
    return !this.disposed && epoch === this.epoch && this.options.canCapture();
  }
  async start() {
    if (
      this.disposed ||
      !this.options.canCapture() ||
      this.state.phase === "requesting" ||
      this.stream
    )
      return;
    const epoch = ++this.epoch;
    this.muted = false;
    this.update({
      phase: "requesting",
      permission: "pending",
      message: undefined,
    });
    this.options.report({ capturing: false, permission: "pending" });
    let stream: MediaStream | undefined;
    try {
      const capture =
        this.options.getUserMedia ??
        ((constraints) => navigator.mediaDevices.getUserMedia(constraints));
      stream = await capture({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (!this.valid(epoch)) {
        this.release(stream);
        return;
      }
      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState === "ended")
        throw new DOMException("No audio track", "NotFoundError");
      this.stream = stream;
      track.addEventListener("ended", this.ended);
      await this.options.attach(stream);
      if (!this.valid(epoch)) {
        if (this.stream === stream) {
          this.options.detach();
          this.stream = undefined;
        }
        this.release(stream);
        return;
      }
      for (const audio of stream.getAudioTracks()) audio.enabled = !this.muted;
      this.update({
        phase: this.muted ? "muted" : "capturing",
        permission: "granted",
      });
      this.options.report({ capturing: !this.muted, permission: "granted" });
    } catch (error) {
      if (stream) {
        if (this.stream === stream) {
          this.options.detach();
          this.stream = undefined;
        }
        this.release(stream);
      }
      if (!this.valid(epoch)) return;
      const name = error instanceof Error ? error.name : "";
      const denied =
        name === "NotAllowedError" || name === "PermissionDeniedError";
      const permission: CaptureAcknowledgement["permission"] = denied
        ? "denied"
        : "unavailable";
      this.update({
        phase: "error",
        permission,
        message: denied
          ? "Microphone blocked. Allow access, then Retry."
          : name === "NotFoundError"
            ? "No microphone found. Connect one, then Retry."
            : "Microphone could not start. Retry when ready.",
      });
      this.options.report({ capturing: false, permission });
    }
  }
  setMuted(muted: boolean) {
    if (this.disposed) return;
    this.muted = muted;
    if (!this.stream) return;
    for (const track of this.stream.getAudioTracks()) track.enabled = !muted;
    this.update({ phase: muted ? "muted" : "capturing" });
    this.options.report({ capturing: !muted, permission: "granted" });
  }
  stop() {
    ++this.epoch;
    this.options.detach();
    const stream = this.stream;
    this.stream = undefined;
    if (stream) this.release(stream);
    this.options.report({
      capturing: false,
      permission: this.state.permission,
    });
    this.update({ phase: "idle", message: undefined });
  }
  dispose() {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.listeners.clear();
  }
}
