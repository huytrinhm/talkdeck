import { it, expect, vi } from "vitest";
import {
  PhoneVoiceController,
  type PhoneTransportPort,
  type PhoneTransportEvent,
} from "./phoneVoice";
function transport() {
  let receive: (event: PhoneTransportEvent) => void = () => {};
  const port: PhoneTransportPort = {
    available: true,
    mode: "transcript",
    subscribe: (fn) => {
      receive = fn;
      return () => {
        receive = () => {};
      };
    },
    createPairing: async () => ({
      code: "TEST-ONLY",
      expiresAt: Date.now() + 60000,
    }),
    join: async () => {},
    disconnect: vi.fn(),
    setActive: vi.fn(),
    setMuted: vi.fn(),
    reportCapture: vi.fn(),
    sendSpeech: vi.fn(),
  };
  return { port, emit: (event: PhoneTransportEvent) => receive(event) };
}
it("never claims pairing or phone readiness without a configured transport", async () => {
  const c = new PhoneVoiceController();
  await c.pair();
  expect(c.getSnapshot().status).toBe("unavailable");
  expect(c.getSnapshot().pairing).toBeUndefined();
  expect(c.selectSource("phone")).toBe(false);
  expect(c.getSnapshot().source).toBe("local");
});
it("gates remote transcripts by explicit source, active intent, connection and mute, and never falls back on disconnect", async () => {
  const t = transport(),
    c = new PhoneVoiceController(t.port);
  await c.pair();
  expect(c.getSnapshot().status).toBe("pairing");
  t.emit({ status: "connected", deviceName: "Test phone" });
  expect(c.selectSource("phone")).toBe(true);
  const onFinal = vi.fn(),
    s = c.createSpeech({ onFinal });
  s.start();
  t.emit({ status: "connected", capturing: true });
  t.emit({ speech: { text: "hello", final: true } });
  expect(onFinal).toHaveBeenCalledWith("hello");
  s.setMuted(true);
  t.emit({ speech: { text: "blocked", final: true } });
  expect(onFinal).toHaveBeenCalledTimes(1);
  c.disconnect();
  expect(c.getSnapshot().source).toBe("phone");
  expect(c.getSnapshot().status).toBe("disconnected");
  t.emit({ speech: { text: "stale", final: true } });
  expect(onFinal).toHaveBeenCalledTimes(1);
  s.dispose();
});
it("drops pairing credentials after connection, rejects stale requests and exposes pairing failures", async () => {
  const t = transport(),
    c = new PhoneVoiceController(t.port);
  let resolve!: (value: { code: string; expiresAt: number }) => void;
  t.port.createPairing = () =>
    new Promise((r) => {
      resolve = r;
    });
  const pending = c.pair();
  c.disconnect();
  resolve({ code: "stale", expiresAt: Date.now() + 60000 });
  await pending;
  expect(c.getSnapshot().pairing).toBeUndefined();
  t.port.createPairing = async () => {
    throw new Error("Pairing could not connect. Try again.");
  };
  await c.pair();
  expect(c.getSnapshot().status).toBe("error");
  expect(c.getSnapshot().message).toContain("Try again");
});
it("does not send speech until sender capture is acknowledged, and pause intent is not capture acknowledgement", async () => {
  const t = transport(),
    c = new PhoneVoiceController(t.port);
  await c.join("fixture");
  t.emit({ status: "connected" });
  c.setActive(true);
  c.sendSpeech({ text: "blocked", final: true });
  expect(t.port.sendSpeech).not.toHaveBeenCalled();
  c.reportCapture({ capturing: true, permission: "granted" });
  c.sendSpeech({ text: "allowed", final: true });
  expect(t.port.sendSpeech).toHaveBeenCalledOnce();
  c.setActive(false);
  expect(c.getSnapshot().capturing).toBe(true);
  c.reportCapture({ capturing: false, permission: "granted" });
  expect(c.getSnapshot().capturing).toBe(false);
});
it("routes actual raw media separately and never calls it recognized speech or connected processing", async () => {
  const t = transport();
  t.port.mode = "raw-audio";
  t.port.attachStream = vi.fn(async () => {});
  t.port.detachStream = vi.fn();
  const c = new PhoneVoiceController(t.port);
  await c.join("fixture");
  t.emit({ status: "connected" });
  c.selectSource("phone");
  const onState = vi.fn(),
    onFinal = vi.fn(),
    session = c.createSpeech({ onState, onFinal });
  session.start();
  const stream = {
    getAudioTracks: () => [{ kind: "audio", readyState: "live", muted: false }],
  } as unknown as MediaStream;
  t.emit({ audioStream: stream, receivingAudio: true, capturing: true });
  t.emit({ speech: { text: "not raw media", final: true } });
  expect(c.getRemoteStream()).toBe(stream);
  expect(c.getSnapshot().receivingAudio).toBe(true);
  expect(onFinal).not.toHaveBeenCalled();
  expect(onState).toHaveBeenLastCalledWith(
    expect.objectContaining({
      status: "unsupported",
      message: "Phone audio received. Speech processing is not connected.",
    }),
  );
  c.disconnect();
  expect(c.getRemoteStream()).toBeNull();
  session.dispose();
});
it("reports a raw sender capture acknowledgement without requiring the transcript transport", async () => {
  const t = transport();
  t.port.mode = "raw-audio";
  const c = new PhoneVoiceController(t.port);
  await c.join("fixture");
  t.emit({ status: "connected" });
  c.setActive(true);
  c.reportCapture({ capturing: true, permission: "granted" });
  expect(c.getSnapshot().capturing).toBe(true);
  expect(t.port.reportCapture).toHaveBeenLastCalledWith({
    capturing: true,
    permission: "granted",
  });
  c.disconnect();
});
it("caches genuine pre-handshake media receipt without exposing it until Connected", async () => {
  const t = transport();
  t.port.mode = "raw-audio";
  const c = new PhoneVoiceController(t.port);
  await c.join("fixture");
  const stream = {
    getAudioTracks: () => [{ kind: "audio", readyState: "live", muted: false }],
  } as unknown as MediaStream;
  t.emit({ audioStream: stream, receivingAudio: true });
  expect(c.getSnapshot().receivingAudio).toBe(false);
  t.emit({ status: "connected" });
  expect(c.getSnapshot().receivingAudio).toBe(true);
  expect(c.getRemoteStream()).toBe(stream);
  c.disconnect();
});
