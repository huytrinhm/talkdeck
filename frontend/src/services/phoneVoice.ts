import type { SpeechOptions, SpeechState } from "./speech";
import type { SpeechSessionPort } from "./adapters";
export type PhoneStatus =
  | "unavailable"
  | "idle"
  | "pairing"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";
export interface PairingOffer {
  code: string;
  expiresAt: number;
  /** Service-issued HTTPS pairing/login entry. The UI never creates authentication. */
  qrUrl?: string;
}
export interface PhoneSnapshot {
  transport?: "raw-audio" | "transcript";
  receivingAudio: boolean;
  processingAvailable: boolean;
  status: PhoneStatus;
  source: "local" | "phone";
  muted: boolean;
  active: boolean;
  capturing: boolean;
  deviceName?: string;
  message?: string;
  pairing?: PairingOffer;
}
export interface PhoneTransportEvent {
  audioStream?: MediaStream | null;
  receivingAudio?: boolean;
  permission?: CaptureAcknowledgement["permission"];
  status?: PhoneStatus;
  active?: boolean;
  capturing?: boolean;
  muted?: boolean;
  deviceName?: string;
  message?: string;
  speech?: { text: string; final: boolean };
  level?: number;
}
/** Frontend integration port, not an agreed network schema. Implement auth, signaling,
 * expiry, revocation and transcription with the service owners before configuring it. */
export interface CaptureAcknowledgement {
  capturing: boolean;
  permission:
    "not-requested" | "pending" | "granted" | "denied" | "unavailable";
}
export interface PhoneTransportPort {
  mode: "raw-audio" | "transcript";
  attachStream?(stream: MediaStream): Promise<void>;
  detachStream?(): void;
  available: boolean;
  subscribe(listener: (event: PhoneTransportEvent) => void): () => void;
  createPairing(): Promise<PairingOffer>;
  join(code: string): Promise<void>;
  disconnect(): void;
  setActive(active: boolean): void;
  setMuted(muted: boolean): void;
  reportCapture(ack: CaptureAcknowledgement): void;
  sendSpeech(speech: { text: string; final: boolean }): void;
}
export interface PhoneAudioProcessorPort {
  available: boolean;
  createSpeech(stream: MediaStream, options: SpeechOptions): SpeechSessionPort;
}
interface RawConsumer {
  options: SpeechOptions;
  adapter?: SpeechSessionPort;
  stream?: MediaStream;
  running: boolean;
}
export class PhoneVoiceController {
  private remoteStream: MediaStream | null = null;
  private mediaReceipt = false;
  private audioProcessor?: PhoneAudioProcessorPort;
  private rawConsumers = new Set<RawConsumer>();
  getRemoteStream = () => this.remoteStream;
  configureAudioProcessor(port: PhoneAudioProcessorPort) {
    this.rawConsumers.forEach((c) => {
      c.adapter?.dispose();
      c.adapter = undefined;
      c.running = false;
    });
    this.audioProcessor = port;
    this.update({ processingAvailable: port.available });
  }
  async attachStream(stream: MediaStream) {
    if (
      this.state.status !== "connected" ||
      this.port?.mode !== "raw-audio" ||
      !this.port.attachStream
    )
      throw new Error("Phone audio is not connected.");
    await this.port.attachStream(stream);
  }
  detachStream() {
    this.port?.detachStream?.();
  }
  private state: PhoneSnapshot = {
    status: "unavailable",
    receivingAudio: false,
    processingAvailable: false,
    source: "local",
    muted: false,
    active: false,
    capturing: false,
  };
  private listeners = new Set<() => void>();
  private speechListeners = new Set<SpeechOptions>();
  private port?: PhoneTransportPort;
  private unsubscribe?: () => void;
  private epoch = 0;
  private expiry?: ReturnType<typeof setTimeout>;
  constructor(port?: PhoneTransportPort) {
    if (port) this.configure(port);
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<PhoneSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
    this.notifySpeech();
    this.rawConsumers.forEach((consumer) => this.syncRaw(consumer));
  }
  configure(port: PhoneTransportPort) {
    this.disconnect();
    this.unsubscribe?.();
    this.port = port;
    this.unsubscribe = port.subscribe((event) => this.receive(event));
    this.update({
      status: port.available ? "idle" : "unavailable",
      transport: port.mode,
      receivingAudio: false,
      message: undefined,
    });
  }
  private receive(event: PhoneTransportEvent) {
    if (event.audioStream !== undefined) this.remoteStream = event.audioStream;
    if (event.receivingAudio !== undefined)
      this.mediaReceipt = event.receivingAudio;
    // A service must explicitly establish a connection before any data is accepted.
    if (
      event.status === "connected" &&
      !["connecting", "pairing", "connected"].includes(this.state.status)
    )
      return;
    if (event.status) {
      if (["disconnected", "error", "unavailable"].includes(event.status)) {
        this.clearExpiry();
        this.remoteStream = null;
        this.mediaReceipt = false;
        this.update({
          status: event.status,
          active: false,
          capturing: false,
          receivingAudio: false,
          pairing: undefined,
          message: event.message,
        });
        return;
      }
      this.update({
        status: event.status,
        message: event.message,
        deviceName: event.deviceName ?? this.state.deviceName,
        ...(event.status === "connected"
          ? { pairing: undefined, receivingAudio: this.mediaReceipt }
          : {}),
      });
      if (event.status === "connected") this.clearExpiry();
    }
    if (this.state.status !== "connected") {
      if (
        ["disconnected", "error", "unavailable"].includes(this.state.status)
      ) {
        this.remoteStream = null;
        this.mediaReceipt = false;
      }
      return;
    }
    if (event.receivingAudio !== undefined)
      this.update({ receivingAudio: event.receivingAudio });
    if (
      event.capturing !== undefined ||
      event.muted !== undefined ||
      event.active !== undefined
    )
      this.update({
        capturing: event.capturing ?? this.state.capturing,
        muted: event.muted ?? this.state.muted,
        active: event.active ?? this.state.active,
      });
    if (
      this.port?.mode === "transcript" &&
      this.state.source === "phone" &&
      this.state.active &&
      this.state.capturing &&
      !this.state.muted
    ) {
      if (event.speech?.text.trim())
        this.speechListeners.forEach((o) =>
          event.speech!.final
            ? o.onFinal?.(event.speech!.text)
            : o.onInterim?.(event.speech!.text),
        );
      if (event.level !== undefined)
        this.speechListeners.forEach((o) =>
          o.onLevel?.(Math.max(0, Math.min(1, event.level!))),
        );
    }
  }
  private notifySpeech() {
    const s = this.state;
    const state: SpeechState = {
      status:
        s.status !== "connected"
          ? "error"
          : s.muted || !s.active
            ? "paused"
            : s.capturing
              ? "listening"
              : "connecting",
      muted: s.muted,
      message:
        s.status !== "connected"
          ? "Phone disconnected. Reconnect in Settings or select This device."
          : !s.capturing && s.active
            ? "Start the microphone on your phone."
            : s.muted
              ? "Phone microphone muted."
              : undefined,
    };
    this.speechListeners.forEach((o) => {
      o.onState?.(state);
      if (state.status !== "listening") o.onLevel?.(0);
    });
  }
  private clearExpiry() {
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = undefined;
  }
  async pair() {
    if (!this.port?.available) {
      this.update({ status: "unavailable" });
      return;
    }
    this.clearExpiry();
    const epoch = ++this.epoch;
    this.update({
      status: "connecting",
      pairing: undefined,
      message: undefined,
    });
    try {
      const offer = await this.port.createPairing();
      if (epoch !== this.epoch) return;
      if (!offer.code.trim() || offer.expiresAt <= Date.now())
        throw new Error("Pairing code expired. Create a new code.");
      this.update({ status: "pairing", pairing: offer });
      this.expiry = setTimeout(
        () => {
          this.disconnect();
          this.update({
            status: "error",
            message: "Pairing code expired. Create a new code.",
          });
        },
        Math.min(offer.expiresAt - Date.now(), 2147483647),
      );
    } catch (error) {
      if (epoch === this.epoch)
        this.update({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Pairing could not connect. Try again.",
        });
    }
  }
  async join(code: string) {
    if (!this.port?.available) {
      this.update({ status: "unavailable" });
      return;
    }
    if (!code.trim()) {
      this.update({
        status: "error",
        message: "Enter the pairing code shown in Settings.",
      });
      return;
    }
    const epoch = ++this.epoch;
    this.update({ status: "connecting", message: undefined });
    try {
      await this.port.join(code.trim());
    } catch (error) {
      if (epoch === this.epoch)
        this.update({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Could not connect. Check the code and try again.",
        });
    }
  }
  disconnect() {
    ++this.epoch;
    this.clearExpiry();
    this.port?.disconnect();
    this.remoteStream = null;
    this.mediaReceipt = false;
    this.update({
      status: this.port?.available ? "disconnected" : "unavailable",
      pairing: undefined,
      receivingAudio: false,
      active: false,
      capturing: false,
      muted: false,
      deviceName: undefined,
      message: undefined,
    });
  }
  selectSource(source: "local" | "phone") {
    if (source === "phone" && this.state.status !== "connected") return false;
    if (source === "local") this.setActive(false);
    this.update({ source });
    return true;
  }
  setActive(active: boolean) {
    const allowed = active && this.state.status === "connected";
    this.port?.setActive(allowed);
    this.update({ active: allowed });
  }
  setMuted(muted: boolean) {
    this.port?.setMuted(muted);
    this.update({ muted });
  }
  reportCapture(ack: CaptureAcknowledgement) {
    const capturing =
      ack.capturing &&
      ack.permission === "granted" &&
      this.state.status === "connected" &&
      this.state.active &&
      !this.state.muted;
    this.port?.reportCapture({ ...ack, capturing });
    this.update({ capturing });
  }
  sendSpeech(speech: { text: string; final: boolean }) {
    if (
      this.port?.mode === "transcript" &&
      this.state.status === "connected" &&
      this.state.active &&
      this.state.capturing &&
      !this.state.muted
    )
      this.port?.sendSpeech(speech);
  }
  private syncRaw(consumer: RawConsumer) {
    const s = this.state,
      o = consumer.options,
      stream = this.remoteStream;
    if (
      s.status !== "connected" ||
      !s.active ||
      s.muted ||
      !s.capturing ||
      !s.receivingAudio ||
      !stream
    ) {
      if (s.status !== "connected" || !stream) {
        consumer.adapter?.dispose();
        consumer.adapter = undefined;
        consumer.stream = undefined;
        consumer.running = false;
      }
      if (consumer.running) {
        consumer.adapter?.pause();
        consumer.running = false;
      }
      o.onLevel?.(0);
      o.onState?.({
        status:
          s.status !== "connected"
            ? "error"
            : !s.active || s.muted
              ? "paused"
              : "connecting",
        muted: s.muted,
        message:
          s.status !== "connected"
            ? "Phone disconnected. Reconnect in Settings or select This device."
            : s.muted
              ? "Phone microphone muted."
              : s.active
                ? "Start the microphone on your phone."
                : undefined,
      });
      return;
    }
    if (!this.audioProcessor?.available) {
      o.onState?.({
        status: "unsupported",
        muted: s.muted,
        message: "Phone audio received. Speech processing is not connected.",
      });
      o.onLevel?.(0);
      return;
    }
    if (consumer.stream !== stream) {
      consumer.adapter?.dispose();
      consumer.adapter = this.audioProcessor.createSpeech(stream, o);
      consumer.stream = stream;
      consumer.running = false;
    }
    if (!consumer.running) {
      consumer.running = true;
      consumer.adapter?.start();
    }
  }
  createSpeech(options: SpeechOptions): SpeechSessionPort {
    if (this.port?.mode === "raw-audio") {
      const consumer: RawConsumer = { options, running: false };
      this.rawConsumers.add(consumer);
      let disposed = false;
      const active = (value: boolean) => {
        if (!disposed) this.setActive(value);
      };
      return {
        start: () => active(true),
        resume: () => active(true),
        retry: () => active(true),
        pause: () => active(false),
        stop: () => active(false),
        setMuted: (muted) => {
          if (!disposed) this.setMuted(muted);
        },
        dispose: () => {
          if (disposed) return;
          disposed = true;
          consumer.adapter?.dispose();
          this.rawConsumers.delete(consumer);
          this.setActive(false);
        },
      };
    }

    this.speechListeners.add(options);
    let disposed = false;
    const activate = () => {
        if (!disposed) this.setActive(true);
      },
      pause = () => {
        if (!disposed) this.setActive(false);
      };
    return {
      start: activate,
      resume: activate,
      retry: activate,
      pause,
      stop: pause,
      setMuted: (muted) => {
        if (!disposed) this.setMuted(muted);
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.speechListeners.delete(options);
        this.setActive(false);
      },
    };
  }
}
export const phoneVoice = new PhoneVoiceController();
