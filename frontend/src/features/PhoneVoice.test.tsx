// @vitest-environment jsdom
import { afterEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PhoneSettings, PhoneSender } from "./PhoneVoice";
import { PhoneVoiceController } from "../services/phoneVoice";
import { frontendAdapters } from "../services/adapters";
import { waitFor } from "@testing-library/react";
afterEach(cleanup);
it("starts raw audio only on the phone button and never creates a phone recognizer", async () => {
  vi.stubGlobal("isSecureContext", true);
  const speech = vi.spyOn(frontendAdapters, "createSpeech");
  let emit = (e: any) => {};
  const attach = vi.fn(async () => {}),
    report = vi.fn();
  const c = new PhoneVoiceController({
    mode: "raw-audio",
    available: true,
    subscribe: (fn) => {
      emit = fn;
      return () => {};
    },
    createPairing: async () => ({
      code: "fixture",
      expiresAt: Date.now() + 1000,
    }),
    join: async () => {},
    disconnect: () => {},
    setActive: () => {},
    setMuted: () => {},
    sendSpeech: () => {},
    reportCapture: report,
    attachStream: attach,
    detachStream: () => {},
  });
  await c.join("fixture");
  emit({ status: "connected" });
  const track: any = {
    kind: "audio",
    readyState: "live",
    enabled: true,
    stop: vi.fn(),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const getUserMedia = vi.fn(
    async () =>
      ({
        getTracks: () => [track],
        getAudioTracks: () => [track],
      }) as unknown as MediaStream,
  );
  render(<PhoneSender controller={c} getUserMedia={getUserMedia} />);
  expect(getUserMedia).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Start microphone" }));
  await waitFor(() =>
    expect(screen.getByText("Microphone on", { exact: true })).toBeTruthy(),
  );
  expect(attach).toHaveBeenCalledOnce();
  expect(speech).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Stop microphone" }));
  expect(track.stop).toHaveBeenCalled();
  expect(report).toHaveBeenLastCalledWith({
    capturing: false,
    permission: "granted",
  });
  speech.mockRestore();
  vi.unstubAllGlobals();
});
it("shows unavailable setup without a fake pairing code or connected status", () => {
  render(<PhoneSettings controller={new PhoneVoiceController()} />);
  expect(
    screen.getByText("Phone connections are not available on this server yet."),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "This device" })
      .hasAttribute("disabled"),
  ).toBe(false);
  expect(screen.queryByRole("link", { name: "Open phone sender" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Create pairing QR" }),
  ).toBeNull();
  expect(
    screen.queryByText(/shared HTTPS|create a pairing QR here/i),
  ).toBeNull();
  expect(screen.queryByLabelText("Pairing code")).toBeNull();
});
it("keeps the sender microphone off until connected and explicitly started", () => {
  render(<PhoneSender controller={new PhoneVoiceController()} />);
  expect(
    screen
      .getByRole("button", { name: "Start microphone" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByText("Microphone off")).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Connect to presentation" })
      .hasAttribute("disabled"),
  ).toBe(true);
});
