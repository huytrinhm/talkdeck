export type SpeechStatus =
  "idle" | "connecting" | "listening" | "paused" | "error" | "unsupported";
export interface SpeechState {
  status: SpeechStatus;
  message?: string;
  muted: boolean;
}
interface RecognitionResult {
  isFinal: boolean;
  [index: number]: { transcript: string };
}
export interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<RecognitionResult>;
      }) => void)
    | null;
  start(): void;
  abort(): void;
}
export interface SpeechOptions {
  onState?: (state: SpeechState) => void;
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onLevel?: (level: number) => void;
  recognitionFactory?: () => RecognitionLike;
}
const errors: Record<string, string> = {
  "not-allowed":
    "Microphone access denied. Allow access in browser settings, then Retry.",
  "service-not-allowed":
    "Browser speech service access denied. Check browser settings, then Retry.",
  "audio-capture": "No microphone available. Connect a microphone, then Retry.",
  network:
    "Speech service could not connect. Check your connection, then Retry.",
  "no-speech": "No speech detected. Resume when ready.",
  aborted: "Microphone capture cancelled.",
};
/** Local reference adapter. Browser speech services may receive audio; raw audio is never stored here. */
export class BrowserSpeechAdapter {
  private recognition: RecognitionLike | null = null;
  private epoch = 0;
  private disposed = false;
  private muted = false;
  private resumeAfterMute = false;
  private status: SpeechStatus = "idle";
  private stream: MediaStream | null = null;
  private audio: AudioContext | null = null;
  private frame: number | null = null;
  constructor(private options: SpeechOptions = {}) {}
  private state(status: SpeechStatus, message?: string) {
    this.status = status;
    this.options.onState?.({ status, message, muted: this.muted });
  }
  private cleanup() {
    this.epoch++;
    const r = this.recognition;
    this.recognition = null;
    if (r) {
      r.onstart = r.onend = r.onerror = r.onresult = null;
      try {
        r.abort();
      } catch {}
    }
    this.stopMeter();
    this.options.onInterim?.("");
  }
  start() {
    if (this.disposed || this.muted || this.recognition) return;
    this.cleanup();
    const global = globalThis as unknown as {
      SpeechRecognition?: new () => RecognitionLike;
      webkitSpeechRecognition?: new () => RecognitionLike;
    };
    const Ctor = global.SpeechRecognition ?? global.webkitSpeechRecognition;
    if (!this.options.recognitionFactory && !Ctor) {
      this.state(
        "unsupported",
        "Speech recognition is unavailable. Try Chrome or Edge.",
      );
      return;
    }
    let r: RecognitionLike;
    try {
      r = this.options.recognitionFactory?.() ?? new Ctor!();
    } catch {
      this.state(
        "error",
        "Could not create microphone recognition. Retry when ready.",
      );
      return;
    }
    this.recognition = r;
    const epoch = this.epoch,
      valid = () =>
        !this.disposed && this.recognition === r && this.epoch === epoch,
      delivered = new Set<number>();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onstart = () => {
      if (!valid()) return;
      this.state("listening");
      void this.startMeter(epoch);
    };
    r.onresult = (e) => {
      if (!valid()) return;
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!valid()) return;
        const result = e.results[i],
          words = result[0]?.transcript.trim();
        if (!words) continue;
        if (result.isFinal) {
          if (!delivered.has(i)) {
            delivered.add(i);
            this.options.onFinal?.(words);
          }
        } else interim += `${words} `;
      }
      if (valid()) this.options.onInterim?.(interim.trim());
    };
    r.onerror = (e) => {
      if (!valid()) return;
      this.cleanup();
      this.state(
        "error",
        errors[e.error] ?? `Microphone error: ${e.error}. Retry when ready.`,
      );
    };
    r.onend = () => {
      if (!valid()) return;
      this.cleanup();
      this.state(
        "idle",
        "Microphone session ended. Resume when you are ready.",
      );
    };
    this.state(
      "connecting",
      "Connecting microphone… Allow access when prompted",
    );
    try {
      r.start();
    } catch {
      this.cleanup();
      this.state(
        "error",
        "Could not start microphone recognition. Retry when ready.",
      );
    }
  }
  stop() {
    if (this.disposed) return;
    this.resumeAfterMute = false;
    this.cleanup();
    this.state("idle");
  }
  pause() {
    if (this.disposed) return;
    this.resumeAfterMute = false;
    this.cleanup();
    this.state("paused", "Microphone paused.");
  }
  resume() {
    this.start();
  }
  retry() {
    if (this.disposed) return;
    this.cleanup();
    this.start();
  }
  setMuted(muted: boolean) {
    if (this.disposed || this.muted === muted) return;
    if (muted) {
      this.resumeAfterMute =
        this.status === "listening" || this.status === "connecting";
      this.muted = true;
      this.cleanup();
      this.state("paused", "Microphone muted.");
    } else {
      this.muted = false;
      const resume = this.resumeAfterMute;
      this.resumeAfterMute = false;
      if (resume) this.start();
      else this.state(this.status);
    }
  }
  dispose() {
    if (this.disposed) return;
    this.cleanup();
    this.disposed = true;
  }
  private stopMeter() {
    if (this.frame !== null && typeof cancelAnimationFrame !== "undefined")
      cancelAnimationFrame(this.frame);
    this.frame = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.audio) {
      void this.audio.close().catch(() => {});
      this.audio = null;
    }
    this.options.onLevel?.(0);
  }
  private async startMeter(epoch: number) {
    if (
      !this.options.onLevel ||
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof AudioContext === "undefined"
    )
      return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return;
    }
    if (this.disposed || epoch !== this.epoch) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;
    try {
      const context = new AudioContext();
      this.audio = context;
      const source = context.createMediaStreamSource(stream),
        analyser = context.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      const tick = () => {
        if (this.disposed || epoch !== this.epoch) return;
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (const x of data) sum += x * x;
        this.options.onLevel?.(Math.min(1, Math.sqrt(sum / data.length)));
        this.frame = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      this.stopMeter();
    }
  }
}
