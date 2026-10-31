import { expect, it, vi } from "vitest";
import {
  PracticeCoachController,
  coachHistory,
  type CoachEvent,
  type CoachPort,
  type CoachSession,
} from "./practiceCoach";
it("invalidates pending input/question consent and old-turn intent while preserving output revocation", async () => {
  for (const action of [
    "withdraw",
    "new-turn",
    "voice-off",
    "question-withdraw",
  ]) {
    const { port, session } = fixture();
    let resolve!: (s: CoachSession) => void;
    port.open = () => new Promise((r) => (resolve = r));
    const c = new PracticeCoachController(context, port);
    c.beginTurn();
    const pending =
      action === "question-withdraw"
        ? c.ask("help", { shareContext: true, voiceOutput: true })
        : c.startInput({
            shareContext: true,
            microphone: true,
            voiceOutput: true,
          });
    if (action === "new-turn") {
      c.resumePractice();
      c.beginTurn();
    } else if (action === "voice-off") c.muteOutput(true);
    else c.stopInput();
    resolve(session);
    await pending;
    if (action === "voice-off") {
      expect(session.startInput).toHaveBeenCalledOnce();
      expect(session.setOutputMuted).not.toHaveBeenCalledWith(false);
      expect(c.getSnapshot().outputMuted).toBe(true);
    } else {
      expect(session.startInput).not.toHaveBeenCalled();
      expect(session.ask).not.toHaveBeenCalled();
    }
    c.dispose();
  }
});
it("serializes questions and input while an uncorrelated service task is pending", async () => {
  const { c, session, emit } = fixture();
  c.beginTurn();
  await c.ask("A", { shareContext: true });
  await c.ask("B", { shareContext: true });
  await c.startInput({ shareContext: true, microphone: true });
  expect(session.ask).toHaveBeenCalledOnce();
  expect(session.startInput).not.toHaveBeenCalled();
  emit({ type: "task", state: "complete" });
  await c.ask("B", { shareContext: true });
  expect(session.ask).toHaveBeenCalledTimes(2);
  expect(c.finish("serialized").incomplete).toBe(true);
});
const context = () => ({
  projectId: "p",
  rehearsalId: "r",
  slideId: "s",
  slideTitle: "Title",
  transcript: [],
});
function fixture() {
  let emit = (_: CoachEvent) => {};
  const session: CoachSession = {
    ask: vi.fn(async () => {}),
    startInput: vi.fn(async () => {}),
    stopInput: vi.fn(),
    setInputMuted: vi.fn(),
    setOutputMuted: vi.fn(),
    stopSpeaking: vi.fn(),
    close: vi.fn(),
  };
  const port: CoachPort = {
    available: true,
    inputMode: "audio",
    voiceOutput: true,
    open: vi.fn(async (_, fn) => {
      emit = fn;
      return session;
    }),
  };
  return {
    session,
    port,
    emit: (e: CoachEvent) => emit(e),
    c: new PracticeCoachController(context, port),
  };
}
it("has an honest unavailable default and never creates feedback", async () => {
  const c = new PracticeCoachController(context);
  c.beginTurn();
  await c.ask("help", { shareContext: true });
  expect(c.getSnapshot().phase).toBe("unavailable");
  expect(c.finish("r").feedback).toEqual([]);
});
it("requires separate context/microphone and output consent before opening any resources", async () => {
  const { c, port, session } = fixture();
  c.beginTurn();
  await c.ask("help", { shareContext: false });
  await c.startInput({ shareContext: true, microphone: false });
  expect(port.open).not.toHaveBeenCalled();
  await c.ask("help", { shareContext: true });
  expect(port.open).toHaveBeenCalledTimes(1);
  expect(session.startInput).not.toHaveBeenCalled();
  expect(session.setOutputMuted).toHaveBeenCalledWith(true);
  expect(c.getSnapshot().outputMuted).toBe(true);
  c.dispose();
});
it("separates acknowledged capture, playback interrupt, input mute and task state", async () => {
  const { c, session, emit } = fixture();
  c.beginTurn();
  await c.startInput({
    shareContext: true,
    microphone: true,
    voiceOutput: true,
  });
  expect(c.getSnapshot().input).toBe("starting");
  emit({ type: "input", state: "listening" });
  emit({ type: "task", state: "running" });
  emit({ type: "reply", text: "Actual reply" });
  emit({ type: "playback", state: "speaking" });
  expect(c.getSnapshot().phase).toBe("speaking");
  c.stopSpeaking();
  expect(session.stopSpeaking).toHaveBeenCalledOnce();
  expect(c.getSnapshot().task).toBe("running");
  expect(c.getSnapshot().input).toBe("listening");
  expect(c.getSnapshot().phase).toBe("interrupted");
  c.muteOutput(true);
  expect(c.getSnapshot().input).toBe("listening");
  c.muteInput(true);
  expect(c.getSnapshot().input).toBe("muted");
  expect(c.getSnapshot().reply).toBe("Actual reply");
  c.dispose();
});
it("does not restart input or playback on resume, and retains only received scoped feedback", async () => {
  const { c, emit, session } = fixture();
  c.beginTurn();
  await c.ask("help", { shareContext: true, voiceOutput: true });
  emit({
    type: "feedback",
    item: {
      id: "f",
      text: "Use one example",
      slideId: "s",
      interval: { start: 1, end: 3 },
    },
  });
  emit({ type: "task", state: "running" });
  c.setNotes("My own note");
  c.resumePractice();
  emit({ type: "input", state: "listening" });
  emit({ type: "playback", state: "speaking" });
  expect(c.getSnapshot().input).toBe("off");
  expect(c.getSnapshot().playback).not.toBe("speaking");
  expect(session.startInput).not.toHaveBeenCalled();
  const review = c.finish("r");
  expect(review.incomplete).toBe(true);
  expect(review.feedback[0].text).toBe("Use one example");
  expect(coachHistory.get("r")?.notes).toBe("My own note");
  emit({ type: "feedback", item: { id: "late", text: "late" } });
  expect(coachHistory.get("r")?.feedback).toHaveLength(1);
  expect(session.close).toHaveBeenCalledOnce();
});
it("closes a late-opened session and ignores late events after disposal", async () => {
  const { port, session } = fixture();
  let resolve!: (s: CoachSession) => void;
  let emit = (_: CoachEvent) => {};
  port.open = (_, fn) => {
    emit = fn;
    return new Promise((r) => (resolve = r));
  };
  const c = new PracticeCoachController(context, port);
  c.beginTurn();
  const ask = c.ask("help", { shareContext: true });
  c.dispose();
  resolve(session);
  await ask;
  emit({ type: "reply", text: "late" });
  expect(session.close).toHaveBeenCalledOnce();
  expect(c.getSnapshot().reply).toBe("");
});
it("disconnect pauses resources and keeps confirmed text without claiming completion", async () => {
  const { c, emit, session } = fixture();
  c.beginTurn();
  await c.ask("help", { shareContext: true });
  emit({ type: "reply", text: "Received text" });
  emit({ type: "task", state: "running" });
  emit({ type: "error" });
  expect(c.getSnapshot().phase).toBe("error");
  expect(c.getSnapshot().input).toBe("off");
  expect(c.getSnapshot().reply).toBe("Received text");
  expect(c.getSnapshot().task).toBe("incomplete");
  expect(session.close).toHaveBeenCalledOnce();
  c.dispose();
});
it("drops input acknowledgements while muted and cuts playback if no readable reply exists", async () => {
  const { c, emit, session } = fixture();
  c.beginTurn();
  await c.startInput({
    shareContext: true,
    microphone: true,
    voiceOutput: true,
  });
  c.muteInput(true);
  emit({ type: "input", state: "listening" });
  expect(c.getSnapshot().input).toBe("muted");
  emit({ type: "playback", state: "speaking" });
  expect(c.getSnapshot().playback).not.toBe("speaking");
  expect(session.stopSpeaking).toHaveBeenCalled();
  c.dispose();
});
