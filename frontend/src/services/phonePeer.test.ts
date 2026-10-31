import { expect, it, vi } from "vitest";
import { WebRtcPhoneTransport, type PhoneSignalingPort } from "./phonePeer";
function fixture(role: "receiver" | "sender" = "receiver") {
  const channel: any = {
    readyState: "connecting",
    send: vi.fn(),
    close: vi.fn(),
  };
  const sender = {
    track: null as any,
    replaceTrack: vi.fn(async (track: any) => {
      sender.track = track;
    }),
  };
  const transceiver = {
    sender,
    direction: "recvonly",
    receiver: { track: { kind: "audio" } },
  };
  const peer: any = {
    connectionState: "new",
    iceGatheringState: "complete",
    localDescription: null,
    createDataChannel: vi.fn(() => channel),
    addTransceiver: vi.fn(() => transceiver),
    getTransceivers: () => [transceiver],
    createOffer: async () => ({ type: "offer", sdp: "desktop-offer" }),
    createAnswer: async () => ({ type: "answer", sdp: "phone-answer" }),
    setLocalDescription: async (s: any) => {
      peer.localDescription = s;
    },
    setRemoteDescription: vi.fn(async () => {}),
    close: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  let answer!: (s: RTCSessionDescriptionInit) => void;
  const signaling: PhoneSignalingPort = {
    available: true,
    createOffer: vi.fn(async () => ({
      sessionId: "session",
      code: "TEST",
      qrUrl: "https://example.test/#phone?pair=TEST",
      expiresAt: Date.now() + 60000,
    })),
    claim: vi.fn(async () => ({
      sessionId: "session",
      peerName: "Desktop",
      offer: { type: "offer" as const, sdp: "desktop-offer" },
    })),
    answer: vi.fn(async () => {}),
    waitForAnswer: () => new Promise((r) => (answer = r)),
    revoke: vi.fn(async () => {}),
  };
  const events: any[] = [];
  const transport = new WebRtcPhoneTransport({
    role,
    signaling,
    peerFactory: () => peer,
    iceServers: [],
  });
  transport.subscribe((e) => events.push(e));
  function connect() {
    peer.connectionState = "connected";
    if (role === "sender") peer.ondatachannel({ channel });
    peer.onconnectionstatechange();
    channel.readyState = "open";
    channel.onopen();
    channel.onmessage({
      data: JSON.stringify({
        v: 1,
        sessionId: "session",
        sequence: 1,
        type: "hello",
        payload: { role: role === "sender" ? "receiver" : "sender" },
      }),
    });
  }
  return {
    transport,
    peer,
    channel,
    sender,
    signaling,
    events,
    connect,
    answer: (a: RTCSessionDescriptionInit) => answer(a),
  };
}
it("negotiates a receive-only offer and claims Connected only after peer and data channel are actually open", async () => {
  const f = fixture();
  const offer = await f.transport.createPairing();
  expect(offer.code).toBe("TEST");
  expect(f.peer.addTransceiver).toHaveBeenCalledWith("audio", {
    direction: "recvonly",
  });
  expect(f.events.some((e) => e.status === "connected")).toBe(false);
  f.answer({ type: "answer", sdp: "phone-answer" });
  await Promise.resolve();
  f.peer.connectionState = "connected";
  f.peer.onconnectionstatechange();
  expect(f.events.some((e) => e.status === "connected")).toBe(false);
  f.connect();
  expect(f.events.some((e) => e.status === "connected")).toBe(true);
  f.transport.disconnect();
});
it("accepts raw remote media separately from transcript events and never plays it to speakers", async () => {
  const f = fixture();
  await f.transport.createPairing();
  f.connect();
  const track: any = {
    kind: "audio",
    readyState: "live",
    muted: false,
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  f.peer.ontrack({ track, streams: [stream] });
  expect(
    f.events.some((e) => e.audioStream === stream && e.receivingAudio === true),
  ).toBe(true);
  expect(f.events.some((e) => e.speech)).toBe(false);
  f.transport.disconnect();
  expect(track.stop).toHaveBeenCalled();
});
it("attaches a phone audio track only after a real peer connection and sends independent capture/control acknowledgements", async () => {
  const f = fixture("sender");
  await f.transport.join("TEST");
  expect(f.signaling.answer).toHaveBeenCalledWith("session", {
    type: "answer",
    sdp: "phone-answer",
  });
  const track: any = { kind: "audio", readyState: "live", stop: vi.fn() };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  await expect(f.transport.attachStream(stream)).rejects.toThrow();
  f.connect();
  await f.transport.attachStream(stream);
  expect(f.sender.replaceTrack).toHaveBeenCalledWith(track);
  f.transport.reportCapture({ capturing: true, permission: "granted" });
  expect(JSON.parse(f.channel.send.mock.calls.at(-1)[0])).toMatchObject({
    v: 1,
    sessionId: "session",
    type: "capture",
    payload: { capturing: true, permission: "granted" },
  });
  f.channel.onmessage({
    data: JSON.stringify({
      v: 1,
      sessionId: "session",
      sequence: 2,
      type: "active",
      payload: { active: false },
    }),
  });
  expect(f.events.at(-1)).toMatchObject({ active: false });
  f.transport.disconnect();
  expect(track.stop).toHaveBeenCalled();
});
it("drops late claim and peer events after disconnect; no reconnect starts capture", async () => {
  const f = fixture("sender");
  let resolve!: (v: any) => void;
  f.signaling.claim = () => new Promise((r) => (resolve = r));
  const pending = f.transport.join("TEST");
  f.transport.disconnect();
  resolve({
    sessionId: "late",
    peerName: "Desktop",
    offer: { type: "offer", sdp: "late" },
  });
  await pending;
  expect(f.peer.setRemoteDescription).not.toHaveBeenCalled();
  expect(f.events.some((e) => e.status === "connected")).toBe(false);
});
it("does not accept malformed control messages or speech text as raw microphone success", async () => {
  const f = fixture("sender");
  await f.transport.join("TEST");
  f.connect();
  const n = f.events.length;
  for (const data of [
    "not-json",
    JSON.stringify({ type: "active", active: "true" }),
    JSON.stringify({ speech: { text: "not media", final: true } }),
  ])
    f.channel.onmessage({ data });
  expect(f.events).toHaveLength(n);
  f.transport.disconnect();
});
it("keeps controller negotiation intent while resetting a previous peer", async () => {
  const { PhoneVoiceController } = await import("./phoneVoice");
  const f = fixture("sender"),
    c = new PhoneVoiceController(f.transport);
  await c.join("TEST");
  f.connect();
  expect(c.getSnapshot().status).toBe("connected");
  c.disconnect();
});
it("closes peer resources when negotiation fails instead of leaving a half-created connection", async () => {
  const f = fixture("sender");
  f.peer.getTransceivers = () => [];
  await expect(f.transport.join("TEST")).rejects.toThrow();
  expect(f.peer.close).toHaveBeenCalled();
  expect(f.signaling.revoke).toHaveBeenCalledWith("session");
});
it("turns a control-channel send failure into a disconnected state without throwing through the UI", async () => {
  const f = fixture("sender");
  await f.transport.join("TEST");
  f.connect();
  f.channel.send.mockImplementation(() => {
    throw new Error("fixture send failure");
  });
  expect(() => f.transport.setActive(true)).not.toThrow();
  expect(f.events.at(-1)).toMatchObject({ status: "disconnected" });
  expect(f.peer.close).toHaveBeenCalled();
});
it("keeps a service-issued QR valid while waiting for a scan and starts deadline only after the answer", async () => {
  vi.useFakeTimers();
  try {
    const f = fixture();
    await f.transport.createPairing();
    await vi.advanceTimersByTimeAsync(31000);
    expect(f.events.some((e) => e.status === "error")).toBe(false);
    expect(f.signaling.revoke).not.toHaveBeenCalled();
    f.answer({ type: "answer", sdp: "phone-answer" });
    await vi.advanceTimersByTimeAsync(30001);
    expect(f.events.some((e) => e.status === "error")).toBe(true);
    f.transport.disconnect();
  } finally {
    vi.useRealTimers();
  }
});
