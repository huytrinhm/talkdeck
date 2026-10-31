// @vitest-environment jsdom
import { afterEach, it, expect, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PracticeCoach } from "./PracticeCoach";
import {
  PracticeCoachController,
  type CoachPort,
  type CoachEvent,
} from "../services/practiceCoach";
import { practicePreferences } from "../services/practicePreferences";
const context = () => ({
  projectId: "p",
  rehearsalId: "r",
  slideId: "s",
  slideTitle: "Title",
  transcript: [],
});
afterEach(() => {
  cleanup();
  practicePreferences.reset();
});
it("hides the unavailable coach without fabricated feedback or idle prompts", () => {
  const c = new PracticeCoachController(context);
  const view = render(
    <PracticeCoach
      controller={c}
      onPausePractice={() => {}}
      onResumePractice={() => {}}
      onSettings={() => {}}
    />,
  );
  expect(view.container.textContent).toBe("");
  expect(screen.queryByTestId("otter-avatar")).toBeNull();
  c.dispose();
});
it("pauses before a consented typed question and separates input/output/interrupt/resume controls", async () => {
  let emit = (_: CoachEvent) => {};
  const ask = vi.fn(async () => {}),
    start = vi.fn(async () => {}),
    stopSpeaking = vi.fn();
  const port: CoachPort = {
    available: true,
    inputMode: "audio",
    voiceOutput: true,
    open: async (_, fn) => {
      emit = fn;
      return {
        ask,
        startInput: start,
        stopInput: vi.fn(),
        setInputMuted: vi.fn(),
        setOutputMuted: vi.fn(),
        stopSpeaking,
        close: vi.fn(),
      };
    },
  };
  const c = new PracticeCoachController(context, port),
    pause = vi.fn(),
    resume = vi.fn();
  render(
    <PracticeCoach
      controller={c}
      onPausePractice={pause}
      onResumePractice={resume}
      onSettings={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Pause & ask coach" }));
  expect(pause).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByLabelText("Question for coach"), {
    target: { value: "What can I clarify?" },
  });
  expect(
    screen
      .getByRole("button", { name: "Send question" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByLabelText(/Share my question/));
  fireEvent.click(screen.getByLabelText("Play this reply aloud"));
  fireEvent.click(screen.getByRole("button", { name: "Send question" }));
  await waitFor(() => expect(ask).toHaveBeenCalledOnce());
  expect(start).not.toHaveBeenCalled();
  emit({ type: "reply", text: "An actual service reply" });
  emit({ type: "playback", state: "speaking" });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Stop speaking" })).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Stop speaking" }));
  expect(stopSpeaking).toHaveBeenCalled();
  expect(c.getSnapshot().task).toBe("running");
  fireEvent.click(screen.getByRole("button", { name: "Resume practice" }));
  expect(resume).toHaveBeenCalledOnce();
  expect(c.getSnapshot().outputMuted).toBe(true);
  c.dispose();
});

import { CoachReviewNotes } from "./PracticeCoach";
import { coachHistory, configureCoachPort } from "../services/practiceCoach";
it.each([
  {
    service: false,
    recorded: true,
    feedback: [{ id: "f", text: "Actual feedback" }],
    visible: false,
  },
  {
    service: true,
    recorded: false,
    feedback: [{ id: "f", text: "Actual feedback" }],
    visible: false,
  },
  { service: true, recorded: true, feedback: [], visible: false },
  {
    service: true,
    recorded: true,
    feedback: [{ id: "f", text: "   " }],
    visible: false,
  },
  {
    service: true,
    recorded: true,
    feedback: [{ id: "f", text: "Actual feedback" }],
    visible: true,
  },
])(
  "Review coach gate requires service and substantive received feedback: %j",
  ({ service, recorded, feedback, visible }) => {
    configureCoachPort({
      available: service,
      inputMode: "text",
      voiceOutput: false,
      open: async () => {
        throw new Error("No service calls in test");
      },
    });
    coachHistory.save("gate", {
      available: recorded,
      feedback,
      notes: "Preserve private notes",
      incomplete: false,
    });
    const view = render(<CoachReviewNotes rehearsalId="gate" />);
    expect(Boolean(view.container.querySelector(".coach-review-notes"))).toBe(
      visible,
    );
    expect(coachHistory.get("gate")?.notes).toBe("Preserve private notes");
    cleanup();
    coachHistory.clear();
    configureCoachPort({
      available: false,
      inputMode: "text",
      voiceOutput: false,
      open: async () => {
        throw new Error("Unavailable");
      },
    });
  },
);
