// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  act,
} from "@testing-library/react";
import { Workspace } from "./Workspace";
import { blankSlide, newProject } from "../domain/types";
import { frontendAdapters } from "../services/adapters";
import type { SpeechOptions } from "../services/speech";
let callbacks: SpeechOptions;
let starts = 0;
beforeEach(() => {
  starts = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(frontendAdapters, "createSpeech").mockImplementation((options) => {
    callbacks = options;
    const start = () => {
      starts++;
      options.onState?.({ status: "connecting", muted: false });
    };
    return {
      start,
      resume: start,
      retry: start,
      pause: () => options.onState?.({ status: "paused", muted: false }),
      stop: () => options.onState?.({ status: "idle", muted: false }),
      setMuted: (muted) =>
        options.onState?.({ status: muted ? "paused" : "listening", muted }),
      dispose: () => {
        options.onFinal?.("late disposed input");
      },
    };
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setup(mode: "create" | "present" | "practice" = "create") {
  const project = newProject([]);
  project.slides = [blankSlide()];
  const change = vi.fn();
  const view = render(
    <Workspace
      project={project}
      mode={mode}
      onChange={change}
      onMode={() => {}}
      onBack={() => {}}
    />,
  );
  return { ...view, change, project };
}
it("direct route/reload mounts are microphone-off and reject unsolicited/pre-start callbacks", () => {
  const { change } = setup();
  expect(starts).toBe(0);
  expect(frontendAdapters.createSpeech).not.toHaveBeenCalled();
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Resume (P)" }));
  expect(starts).toBe(1);
  act(() => {
    callbacks.onInterim?.("before capture ack");
    callbacks.onFinal?.("before capture ack");
  });
  expect(change).not.toHaveBeenCalled();
  act(() => {
    callbacks.onState?.({ status: "listening", muted: false });
    callbacks.onInterim?.("current spoken line");
  });
  expect(document.querySelector(".stage .speech-status")).toBeNull();
  expect(
    document.querySelector(".workspace-sidebar .interim")?.textContent,
  ).toContain("current spoken line");
  fireEvent.click(screen.getByRole("button", { name: "Pause (P)" }));
  expect(document.querySelector(".speech-status")).toBeNull();
  const count = change.mock.calls.length;
  act(() => {
    callbacks.onState?.({ status: "listening", muted: false });
    callbacks.onInterim?.("late line");
    callbacks.onFinal?.("late final");
  });
  expect(change).toHaveBeenCalledTimes(count);
  expect(screen.queryByText("late line")).toBeNull();
});
it("route cleanup rejects callbacks synchronously emitted during dispose", () => {
  const { change, unmount } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Resume (P)" }));
  act(() => callbacks.onState?.({ status: "listening", muted: false }));
  unmount();
  expect(change).not.toHaveBeenCalled();
  act(() => callbacks.onFinal?.("late after route"));
  expect(change).not.toHaveBeenCalled();
});
it("saved transcript is labelled as saved history and never appears as current input", () => {
  const project = newProject([]);
  project.transcript = [
    {
      id: "saved",
      slideId: "x",
      text: "prior session words",
      start: 0,
      end: 1,
    },
  ];
  render(
    <Workspace
      project={project}
      mode="create"
      onChange={() => {}}
      onMode={() => {}}
      onBack={() => {}}
    />,
  );
  expect(screen.getByRole("list", { name: "Saved transcript" })).toBeTruthy();
  expect(document.querySelector(".speech-status")).toBeNull();
  expect(starts).toBe(0);
});
it("initial Practice has no inert coach panel and Present blackout is icon-only", () => {
  const view = setup("practice");
  expect(screen.queryByRole("region", { name: "Practice coach" })).toBeNull();
  expect(document.querySelector(".practice-coach")).toBeNull();
  view.unmount();
  setup("present");
  const blackout = screen.getByRole("button", {
    name: "Black out audience screen (B)",
  });
  expect(blackout.textContent).toBe("");
  expect(blackout.getAttribute("title")).toBe("Black out audience screen (B)");
  fireEvent.click(blackout);
  expect(
    screen
      .getByRole("button", { name: "Restore audience screen (B)" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
});

it.each(["error", "idle"] as const)(
  "rejects late listening/text after terminal %s without a new Resume",
  (status) => {
    const { change } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Resume (P)" }));
    act(() => callbacks.onState?.({ status: "listening", muted: false }));
    act(() => callbacks.onState?.({ status, muted: false }));
    act(() => {
      callbacks.onState?.({ status: "listening", muted: false });
      callbacks.onInterim?.("late terminal interim");
      callbacks.onFinal?.("late terminal final");
    });
    expect(change).not.toHaveBeenCalled();
    expect(screen.queryByText("late terminal interim")).toBeNull();
  },
);

it("an explicit settings pause revokes the earlier device mute resume intent", () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Resume (P)" }));
  act(() => callbacks.onState?.({ status: "listening", muted: false }));
  fireEvent.click(screen.getByRole("button", { name: "Mute (M)" }));
  expect(starts).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "App settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Unmute (M)" }));
  expect(starts).toBe(1);
  expect(screen.getByRole("button", { name: "Resume (P)" })).toBeTruthy();
});
it("pauses Practice on hidden-page visibility change even without blur and rejects late speech", () => {
  const { change } = setup("practice");
  fireEvent.click(screen.getByRole("button", { name: "Resume (P)" }));
  act(() => callbacks.onState?.({ status: "listening", muted: false }));
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  fireEvent(document, new Event("visibilitychange"));
  expect(screen.getByRole("button", { name: "Resume (P)" })).toBeTruthy();
  act(() => callbacks.onFinal?.("late hidden-page speech"));
  expect(change).not.toHaveBeenCalled();
});
