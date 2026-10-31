import { expect, it, vi } from "vitest";
import { RawMicrophoneCapture } from "./rawMicrophone";
function fixture() {
  const track = {
    kind: "audio",
    enabled: true,
    readyState: "live",
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  const attach = vi.fn(async () => {}),
    detach = vi.fn(),
    report = vi.fn(),
    getUserMedia = vi.fn(async () => stream);
  let connected = true;
  const c = new RawMicrophoneCapture({
    canCapture: () => connected,
    getUserMedia,
    attach,
    detach,
    report,
  });
  return {
    c,
    track,
    stream,
    attach,
    detach,
    report,
    getUserMedia,
    disconnect: () => {
      connected = false;
    },
  };
}
it("never captures on construction or when connection is absent; reports only attached real input", async () => {
  const f = fixture();
  expect(f.getUserMedia).not.toHaveBeenCalled();
  await f.c.start();
  expect(f.attach).toHaveBeenCalledWith(f.stream);
  expect(f.report).toHaveBeenLastCalledWith({
    capturing: true,
    permission: "granted",
  });
  f.c.stop();
  expect(f.track.stop).toHaveBeenCalledOnce();
  expect(f.report).toHaveBeenLastCalledWith({
    capturing: false,
    permission: "granted",
  });
  f.disconnect();
  await f.c.start();
  expect(f.getUserMedia).toHaveBeenCalledOnce();
});
it("drops late permission after stop/disposal without attaching or reporting capture", async () => {
  for (const action of ["stop", "dispose"]) {
    const f = fixture();
    let resolve!: (s: MediaStream) => void;
    f.getUserMedia.mockImplementation(() => new Promise((r) => (resolve = r)));
    const start = f.c.start();
    expect(f.c.getSnapshot().phase).toBe("requesting");
    expect(f.report).toHaveBeenLastCalledWith({
      capturing: false,
      permission: "pending",
    });
    if (action === "stop") f.c.stop();
    else f.c.dispose();
    resolve(f.stream);
    await start;
    expect(f.attach).not.toHaveBeenCalled();
    expect(f.track.stop).toHaveBeenCalledOnce();
    expect(f.report).not.toHaveBeenCalledWith({
      capturing: true,
      permission: "granted",
    });
  }
});
it("releases a late attached stream after disconnect and does not resume automatically", async () => {
  const f = fixture();
  let resolve!: () => void;
  f.attach.mockImplementation(() => new Promise((r) => (resolve = r)));
  const start = f.c.start();
  await Promise.resolve();
  f.disconnect();
  f.c.stop();
  resolve();
  await start;
  expect(f.track.stop).toHaveBeenCalled();
  expect(f.c.getSnapshot().phase).toBe("idle");
  expect(f.report).not.toHaveBeenCalledWith({
    capturing: true,
    permission: "granted",
  });
});
it("mutes only outgoing audio and Stop releases hardware; unmute after Stop never reopens it", async () => {
  const f = fixture();
  await f.c.start();
  f.c.setMuted(true);
  expect(f.track.enabled).toBe(false);
  expect(f.c.getSnapshot().phase).toBe("muted");
  expect(f.report).toHaveBeenLastCalledWith({
    capturing: false,
    permission: "granted",
  });
  f.c.setMuted(false);
  expect(f.track.enabled).toBe(true);
  f.c.stop();
  f.c.setMuted(false);
  expect(f.getUserMedia).toHaveBeenCalledOnce();
  expect(f.c.getSnapshot().phase).toBe("idle");
});
it("shows a safe denied state and never echoes a browser error payload", async () => {
  const f = fixture();
  f.getUserMedia.mockRejectedValue(
    new DOMException("sensitive payload", "NotAllowedError"),
  );
  await f.c.start();
  expect(f.c.getSnapshot()).toMatchObject({
    phase: "error",
    permission: "denied",
    message: "Microphone blocked. Allow access, then Retry.",
  });
  expect(JSON.stringify(f.c.getSnapshot())).not.toContain("sensitive payload");
  expect(f.attach).not.toHaveBeenCalled();
  f.c.dispose();
});
