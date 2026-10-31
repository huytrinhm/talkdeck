import { afterEach, expect, it, vi } from "vitest";
import { BrowserSpeechAdapter, type RecognitionLike } from "./speech";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function meterFixture() {
  let amplitude = 0,
    now = 0,
    nextFrame: (() => void) | undefined;
  const stop = vi.fn(),
    close = vi.fn(async () => {}),
    resume = vi.fn(async () => {});
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: vi.fn(async () => stream) },
  });
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "suspended";
      resume = resume;
      close = close;
      createMediaStreamSource = () => ({ connect: vi.fn() });
      createAnalyser = () => ({
        fftSize: 256,
        getFloatTimeDomainData: (data: Float32Array) => data.fill(amplitude),
      });
    },
  );
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => {
    nextFrame = fn;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const recognition = {
    start: vi.fn(),
    abort: vi.fn(),
  } as unknown as RecognitionLike;
  const levels: number[] = [];
  const adapter = new BrowserSpeechAdapter({
    recognitionFactory: () => recognition,
    onLevel: (level) => levels.push(level),
  });
  const frames = (count: number) => {
    for (let i = 0; i < count; i++) {
      now += 16;
      nextFrame?.();
    }
  };
  return {
    adapter,
    recognition,
    levels,
    stop,
    close,
    resume,
    stream,
    frames,
    setAmplitude: (value: number) => {
      amplitude = value;
    },
    lastTick: () => nextFrame!,
  };
}
it("resumes a suspended analyser, distinguishes quiet/loud speech, and settles to silence", async () => {
  const f = meterFixture();
  f.adapter.start();
  f.recognition.onstart!();
  await Promise.resolve();
  await Promise.resolve();
  expect(f.resume).toHaveBeenCalledOnce();
  f.frames(20);
  expect(f.levels.at(-1)).toBe(0);
  f.setAmplitude(0.01);
  f.frames(20);
  const quiet = f.levels.at(-1)!;
  expect(quiet).toBeGreaterThan(0.3);
  expect(quiet).toBeLessThan(0.5);
  f.setAmplitude(0.1);
  f.frames(20);
  expect(f.levels.at(-1)).toBeGreaterThan(quiet + 0.3);
  expect(f.levels.every((n) => n >= 0 && n <= 1)).toBe(true);
  f.setAmplitude(0);
  f.frames(80);
  expect(f.levels.at(-1)).toBe(0);
  f.adapter.dispose();
});
it.each(["pause", "stop", "mute"] as const)(
  "zeros and releases the meter on %s, ignoring already queued frames",
  async (action) => {
    const f = meterFixture();
    f.adapter.start();
    f.recognition.onstart!();
    await Promise.resolve();
    await Promise.resolve();
    f.setAmplitude(0.1);
    f.frames(20);
    expect(f.levels.at(-1)).toBeGreaterThan(0.5);
    const late = f.lastTick();
    if (action === "mute") f.adapter.setMuted(true);
    else f.adapter[action]();
    expect(f.levels.at(-1)).toBe(0);
    expect(f.stop).toHaveBeenCalledOnce();
    expect(f.close).toHaveBeenCalledOnce();
    const count = f.levels.length;
    late();
    expect(f.levels).toHaveLength(count);
    f.adapter.dispose();
  },
);
it("stops a stream that arrives after capture was cancelled", async () => {
  const f = meterFixture();
  let resolve!: (stream: MediaStream) => void;
  vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  f.adapter.start();
  f.recognition.onstart!();
  f.adapter.pause();
  resolve(f.stream);
  await Promise.resolve();
  await Promise.resolve();
  expect(f.stop).toHaveBeenCalledOnce();
  expect(f.resume).not.toHaveBeenCalled();
  expect(f.levels.at(-1)).toBe(0);
  f.adapter.dispose();
});

it("a cancelled context's late resume failure cannot stop a newer meter", async () => {
  const f = meterFixture();
  let reject!: (reason: Error) => void;
  f.resume.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
  );
  f.adapter.start();
  f.recognition.onstart!();
  await Promise.resolve();
  f.adapter.pause();
  f.adapter.start();
  f.recognition.onstart!();
  await Promise.resolve();
  await Promise.resolve();
  f.setAmplitude(0.1);
  f.frames(20);
  expect(f.levels.at(-1)).toBeGreaterThan(0.5);
  reject(new Error("Old context closed during resume"));
  await Promise.resolve();
  await Promise.resolve();
  expect(f.close).toHaveBeenCalledTimes(1);
  expect(f.levels.at(-1)).toBeGreaterThan(0.5);
  f.adapter.dispose();
});
