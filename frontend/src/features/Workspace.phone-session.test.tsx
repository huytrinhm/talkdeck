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
import { phoneVoice } from "../services/phoneVoice";
import type { SpeechOptions } from "../services/speech";
vi.mock("./PhoneVoice", () => ({ usePhoneVoice: () => ({ source: "phone" }) }));
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("starts the phone consumer without disposing pre-existing raw capture and forwards remote unmute", () => {
  let callbacks: SpeechOptions = {};
  const dispose = vi.fn(),
    start = vi.fn(),
    mute = vi.fn((value) =>
      callbacks.onState?.({
        status: value ? "paused" : "listening",
        muted: value,
      }),
    );
  const create = vi
    .spyOn(phoneVoice, "createSpeech")
    .mockImplementation((options) => {
      callbacks = options;
      return {
        start,
        resume: start,
        retry: start,
        pause: vi.fn(),
        stop: vi.fn(),
        setMuted: mute,
        dispose,
      };
    });
  const p = newProject([]);
  p.slides = [blankSlide()];
  const change = vi.fn();
  render(
    <Workspace
      project={p}
      mode="create"
      onChange={change}
      onBack={() => {}}
      onMode={() => {}}
    />,
  );
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Resume (P)" }));
  expect(start).toHaveBeenCalledOnce();
  expect(dispose).not.toHaveBeenCalled();
  act(() => callbacks.onState?.({ status: "paused", muted: true }));
  act(() => callbacks.onFinal?.("must reject muted input"));
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Unmute (M)" }));
  expect(mute).toHaveBeenCalledWith(false);
  act(() => callbacks.onFinal?.("phone narration"));
  expect(change).toHaveBeenCalledOnce();
  const segment = change.mock.calls[0][0].transcript[0];
  expect(segment.inputSource).toBe("phone");
  expect(segment.captureSessionId).toEqual(expect.any(String));
  fireEvent.blur(window);
  expect(dispose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Pause (P)" }));
  expect(dispose).toHaveBeenCalledOnce();
  act(() => callbacks.onFinal?.("late phone input"));
  expect(change).toHaveBeenCalledOnce();
});
