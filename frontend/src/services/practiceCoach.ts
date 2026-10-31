import { useSyncExternalStore } from "react";
export interface CoachContext {
  projectId: string;
  rehearsalId: string;
  slideId: string;
  slideTitle: string;
  transcript: { text: string; slideId: string; start: number; end: number }[];
}
export interface CoachFeedback {
  id: string;
  text: string;
  slideId?: string;
  interval?: { start: number; end: number };
}
export type CoachEvent =
  | { type: "input"; state: "listening" | "muted" | "off" }
  | { type: "task"; state: "running" | "complete" }
  | { type: "reply"; text: string }
  | { type: "playback"; state: "speaking" | "idle" }
  | { type: "feedback"; item: CoachFeedback }
  | { type: "error" | "disconnected" };
/** Internal UI boundary, NOT a GPT-Live wire schema. Open must never start capture
 * or playback. Local stop/mute/close methods synchronously cut off media/queues;
 * stopSpeaking also reconciles heard/unheard context in the serving adapter.
 * Closing this media session does not promise cancellation of a remote task. */
export interface CoachSession {
  ask(request: { question: string; context: CoachContext }): Promise<void>;
  startInput(): Promise<void>;
  stopInput(): void;
  setInputMuted(muted: boolean): void;
  setOutputMuted(muted: boolean): void;
  stopSpeaking(): void;
  close(): void;
}
export interface CoachPort {
  available: boolean;
  inputMode: "text" | "audio";
  voiceOutput: boolean;
  open(
    request: { context: CoachContext; outputMuted: true },
    emit: (event: CoachEvent) => void,
  ): Promise<CoachSession>;
}
export interface CoachSnapshot {
  available: boolean;
  inputMode: "text" | "audio";
  voiceOutput: boolean;
  turnOpen: boolean;
  pending: boolean;
  phase:
    | "unavailable"
    | "ready"
    | "connecting"
    | "listening"
    | "working"
    | "speaking"
    | "interrupted"
    | "error";
  input: "off" | "starting" | "listening" | "muted";
  outputMuted: boolean;
  playback: "idle" | "speaking" | "stopped";
  task: "idle" | "running" | "complete" | "incomplete";
  reply: string;
  feedback: CoachFeedback[];
  notes: string;
}
export interface CoachReview {
  feedback: CoachFeedback[];
  notes: string;
  incomplete: boolean;
  available: boolean;
}
const history = new Map<string, CoachReview>();
export const coachHistory = {
  get: (id: string) => history.get(id),
  save: (id: string, review: CoachReview) => {
    history.set(id, structuredClone(review));
    while (history.size > 12) history.delete(history.keys().next().value!);
  },
  clear: () => history.clear(),
};
const unavailable: CoachPort = {
  available: false,
  inputMode: "text",
  voiceOutput: false,
  open: async () => {
    throw new Error("Unavailable");
  },
};
let configuredPort: CoachPort = unavailable;
const availabilityListeners = new Set<() => void>();
/** Configure only after the serving/auth/session contract is agreed. No endpoint is implied. */
export function configureCoachPort(port: CoachPort) {
  configuredPort = port;
  availabilityListeners.forEach((fn) => fn());
}
export function useCoachAvailability() {
  return useSyncExternalStore(
    (fn) => {
      availabilityListeners.add(fn);
      return () => {
        availabilityListeners.delete(fn);
      };
    },
    () => configuredPort.available,
    () => false,
  );
}
export class PracticeCoachController {
  private state: CoachSnapshot;
  private listeners = new Set<() => void>();
  private session?: CoachSession;
  private opening?: Promise<CoachSession | undefined>;
  private epoch = 0;
  private disposed = false;
  private inputRequested = false;
  private voiceAllowed = false;
  private inputMuted = false;
  private intent = 0;
  private pendingCommand?: number;
  constructor(
    private context: () => CoachContext,
    private port: CoachPort = configuredPort,
  ) {
    this.state = {
      available: port.available,
      inputMode: port.inputMode,
      voiceOutput: port.voiceOutput,
      turnOpen: false,
      pending: false,
      phase: port.available ? "ready" : "unavailable",
      input: "off",
      outputMuted: true,
      playback: "idle",
      task: "idle",
      reply: "",
      feedback: [],
      notes: "",
    };
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private update(patch: Partial<CoachSnapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  beginTurn() {
    if (!this.disposed) {
      ++this.intent;
      this.pendingCommand = undefined;
      this.update({
        pending: false,
        turnOpen: true,
        phase: this.port.available ? "ready" : "unavailable",
      });
    }
  }
  setNotes(notes: string) {
    this.update({ notes: notes.slice(0, 6000) });
  }
  private receive(event: CoachEvent, epoch: number) {
    if (this.disposed || epoch !== this.epoch) return;
    switch (event.type) {
      case "input":
        if (
          this.inputRequested &&
          this.state.turnOpen &&
          (!this.inputMuted || event.state !== "listening")
        ) {
          this.update({
            input: event.state,
            phase: event.state === "listening" ? "listening" : this.state.phase,
          });
        }
        break;
      case "task":
        this.update({
          task: event.state,
          ...(event.state === "running" &&
          this.state.turnOpen &&
          this.state.playback !== "speaking"
            ? { phase: "working" as const }
            : event.state === "complete" &&
                this.state.playback !== "speaking" &&
                this.state.input !== "listening"
              ? { phase: "ready" as const }
              : {}),
        });
        break;
      case "reply":
        this.update({ reply: event.text.slice(0, 24000) });
        break;
      case "feedback":
        if (event.item.id && event.item.text.trim()) {
          const item = { ...event.item, text: event.item.text.slice(0, 12000) };
          this.update({
            feedback: [
              ...this.state.feedback.filter((f) => f.id !== item.id),
              item,
            ].slice(-40),
          });
        }
        break;
      case "playback":
        if (event.state === "speaking") {
          if (
            this.state.turnOpen &&
            !this.state.outputMuted &&
            this.voiceAllowed &&
            this.state.reply.trim()
          )
            this.update({ playback: "speaking", phase: "speaking" });
          else this.session?.stopSpeaking();
        } else
          this.update({
            playback: "idle",
            phase:
              this.state.task === "running"
                ? "working"
                : this.state.input === "listening"
                  ? "listening"
                  : "ready",
          });
        break;
      case "error":
      case "disconnected":
        this.fail();
        break;
    }
  }
  private async connect() {
    if (this.session) return this.session;
    if (this.opening) return this.opening;
    const epoch = this.epoch;
    this.update({ phase: "connecting" });
    const pending = this.port
      .open({ context: this.context(), outputMuted: true }, (event) =>
        this.receive(event, epoch),
      )
      .then((session) => {
        if (this.disposed || epoch !== this.epoch) {
          session.close();
          return undefined;
        }
        this.session = session;
        session.setOutputMuted(true);
        this.update({ phase: "ready" });
        return session;
      })
      .catch(() => {
        if (epoch === this.epoch) this.fail();
        return undefined;
      })
      .finally(() => {
        if (this.opening === pending) this.opening = undefined;
      });
    this.opening = pending;
    return pending;
  }
  private allowVoice(session: CoachSession) {
    session.setOutputMuted(!this.voiceAllowed);
    this.update({ outputMuted: !this.voiceAllowed });
  }
  private currentIntent(intent: number, epoch: number) {
    return (
      !this.disposed &&
      epoch === this.epoch &&
      intent === this.intent &&
      this.state.turnOpen
    );
  }
  private prepareCommand(voiceOutput = false) {
    const intent = ++this.intent;
    this.pendingCommand = intent;
    this.voiceAllowed = Boolean(voiceOutput && this.port.voiceOutput);
    this.update({ pending: true });
    return intent;
  }
  private settleCommand(intent: number) {
    if (this.pendingCommand === intent) {
      this.pendingCommand = undefined;
      this.update({ pending: false });
    }
  }
  private haltInput() {
    this.inputRequested = false;
    this.session?.stopInput();
    this.update({ input: "off" });
  }
  async ask(
    question: string,
    consent: { shareContext: boolean; voiceOutput?: boolean },
  ) {
    if (
      this.disposed ||
      !this.port.available ||
      !this.state.turnOpen ||
      !consent.shareContext ||
      !question.trim() ||
      this.pendingCommand !== undefined ||
      this.state.task === "running"
    )
      return;
    const epoch = this.epoch,
      intent = this.prepareCommand(consent.voiceOutput);
    const session = await this.connect();
    if (!session || !this.currentIntent(intent, epoch)) {
      this.settleCommand(intent);
      return;
    }
    this.haltInput();
    if (this.state.playback === "speaking") session.stopSpeaking();
    this.allowVoice(session);
    this.update({
      phase: "working",
      task: "running",
      playback: "idle",
      reply: "",
    });
    this.settleCommand(intent);
    try {
      await session.ask({
        question: question.trim().slice(0, 4000),
        context: this.context(),
      });
    } catch {
      if (this.currentIntent(intent, epoch)) this.fail();
    }
  }
  async startInput(consent: {
    shareContext: boolean;
    microphone: boolean;
    voiceOutput?: boolean;
  }) {
    if (
      this.disposed ||
      !this.port.available ||
      this.port.inputMode !== "audio" ||
      !this.state.turnOpen ||
      !consent.shareContext ||
      !consent.microphone ||
      this.pendingCommand !== undefined ||
      this.state.task === "running" ||
      this.inputRequested
    )
      return;
    const epoch = this.epoch,
      intent = this.prepareCommand(consent.voiceOutput);
    const session = await this.connect();
    if (!session || !this.currentIntent(intent, epoch)) {
      this.settleCommand(intent);
      return;
    }
    this.allowVoice(session);
    this.inputRequested = true;
    this.inputMuted = false;
    this.update({ input: "starting" });
    this.settleCommand(intent);
    try {
      await session.startInput();
    } catch {
      if (this.currentIntent(intent, epoch)) this.fail();
    }
  }
  stopInput() {
    ++this.intent;
    this.pendingCommand = undefined;
    this.haltInput();
    this.update({ pending: false });
  }
  muteInput(muted: boolean) {
    if (!this.session || !this.inputRequested) return;
    this.inputMuted = muted;
    this.session.setInputMuted(muted);
    this.update({ input: muted ? "muted" : "starting" });
  }
  muteOutput(muted: boolean) {
    if (this.disposed || (!muted && !this.port.voiceOutput)) return;
    this.voiceAllowed = !muted;
    this.session?.setOutputMuted(muted);
    if (muted) this.stopSpeaking();
    this.update({ outputMuted: muted });
  }
  stopSpeaking() {
    this.session?.stopSpeaking();
    this.update({
      playback: "stopped",
      phase: this.port.available ? "interrupted" : "unavailable",
    });
  }
  /** Explicit user action; input/output off while remote task status stays independent. */
  resumePractice() {
    this.stopInput();
    this.session?.setOutputMuted(true);
    this.session?.stopSpeaking();
    this.voiceAllowed = false;
    this.update({
      turnOpen: false,
      outputMuted: true,
      playback: "idle",
      phase: this.port.available ? "ready" : "unavailable",
    });
  }
  pause() {
    this.resumePractice();
  }
  private fail() {
    this.inputRequested = false;
    this.voiceAllowed = false;
    ++this.epoch;
    ++this.intent;
    this.pendingCommand = undefined;
    this.session?.close();
    this.session = undefined;
    this.opening = undefined;
    this.update({
      phase: "error",
      pending: false,
      input: "off",
      playback: "idle",
      outputMuted: true,
      task: this.state.task === "running" ? "incomplete" : this.state.task,
    });
  }
  finish(id: string) {
    const result: CoachReview = {
      feedback: structuredClone(this.state.feedback),
      notes: this.state.notes,
      incomplete: ["running", "incomplete"].includes(this.state.task),
      available: this.port.available,
    };
    coachHistory.save(id, result);
    this.dispose();
    return result;
  }
  dispose() {
    if (this.disposed) return;
    ++this.epoch;
    ++this.intent;
    this.pendingCommand = undefined;
    this.inputRequested = false;
    this.voiceAllowed = false;
    const session = this.session;
    this.session = undefined;
    this.disposed = true;
    session?.close();
    this.listeners.clear();
  }
}
