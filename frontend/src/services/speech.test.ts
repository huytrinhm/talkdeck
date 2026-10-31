import { it, expect, vi } from "vitest";
import { BrowserSpeechAdapter, type RecognitionLike } from "./speech";
class Fake implements RecognitionLike {
  continuous = false;
  interimResults = false;
  lang = "";
  onstart: null | (() => void) = null;
  onend: null | (() => void) = null;
  onerror: null | ((e: { error: string }) => void) = null;
  onresult: null | ((e: any) => void) = null;
  start = vi.fn();
  abort = vi.fn();
}
it("ignores cancelled callbacks and deduplicates final result indexes", () => {
  const r = new Fake(),
    final = vi.fn();
  const a = new BrowserSpeechAdapter({
    recognitionFactory: () => r,
    onFinal: final,
  });
  a.start();
  r.onstart!();
  const event = {
    resultIndex: 0,
    results: [Object.assign([{ transcript: "hello" }], { isFinal: true })],
  };
  r.onresult!(event);
  r.onresult!(event);
  expect(final).toHaveBeenCalledTimes(1);
  const late = r.onresult!;
  a.pause();
  late(event);
  expect(final).toHaveBeenCalledTimes(1);
  expect(r.abort).toHaveBeenCalled();
});
it("does not reconnect after end or resume an explicitly paused session on unmute", () => {
  const r = new Fake(),
    factory = vi.fn(() => r),
    state = vi.fn();
  const a = new BrowserSpeechAdapter({
    recognitionFactory: factory,
    onState: state,
  });
  a.start();
  r.onend!();
  expect(state.mock.calls.at(-1)?.[0].status).toBe("idle");
  a.pause();
  a.setMuted(true);
  a.setMuted(false);
  expect(factory).toHaveBeenCalledTimes(1);
});
