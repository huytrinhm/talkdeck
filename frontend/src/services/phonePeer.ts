import type {
  CaptureAcknowledgement,
  PairingOffer,
  PhoneTransportEvent,
  PhoneTransportPort,
} from "./phoneVoice";
export class PhoneSignalingFailure extends Error {}
/** Internal signaling boundary. HTTP/session/CSRF mapping belongs to the host adapter.
 * Only SDP and expiring pairing metadata cross it; raw audio stays on WebRTC. */
export interface PhoneSignalingPort {
  available: boolean;
  createOffer(
    offer: RTCSessionDescriptionInit,
  ): Promise<PairingOffer & { sessionId: string; sessionExpiresAt?: number }>;
  claim(code: string): Promise<{
    sessionId: string;
    peerName: string;
    offer: RTCSessionDescriptionInit;
    sessionExpiresAt?: number;
  }>;
  answer(sessionId: string, answer: RTCSessionDescriptionInit): Promise<void>;
  waitForAnswer(
    sessionId: string,
    signal: AbortSignal,
  ): Promise<RTCSessionDescriptionInit>;
  revoke(sessionId: string): Promise<void>;
}
interface PeerOptions {
  role: "receiver" | "sender";
  signaling: PhoneSignalingPort;
  iceServers: RTCIceServer[];
  peerFactory?: (configuration: RTCConfiguration) => RTCPeerConnection;
}
const permissions = new Set([
  "not-requested",
  "pending",
  "granted",
  "denied",
  "unavailable",
]);
export class WebRtcPhoneTransport implements PhoneTransportPort {
  readonly mode = "raw-audio" as const;
  readonly available: boolean;
  private listeners = new Set<(event: PhoneTransportEvent) => void>();
  private peer?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private sender?: RTCRtpSender;
  private sessionId?: string;
  private stream?: MediaStream;
  private remote?: MediaStream;
  private abort?: AbortController;
  private epoch = 0;
  private peerName = "Phone";
  private announced = false;
  private helloSent = false;
  private helloReceived = false;
  private sentSequence = 0;
  private receivedSequence = 0;
  private lastSeen = 0;
  private heartbeat?: ReturnType<typeof setInterval>;
  private expiry?: ReturnType<typeof setTimeout>;
  private connectionTimeout?: ReturnType<typeof setTimeout>;
  constructor(private options: PeerOptions) {
    this.available =
      options.signaling.available &&
      Boolean(options.peerFactory || typeof RTCPeerConnection !== "undefined");
  }
  subscribe = (fn: (event: PhoneTransportEvent) => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private emit(event: PhoneTransportEvent) {
    this.listeners.forEach((fn) => fn(event));
  }
  private valid(epoch: number) {
    return epoch === this.epoch && Boolean(this.peer);
  }
  private ready() {
    return (
      this.peer?.connectionState === "connected" &&
      this.channel?.readyState === "open"
    );
  }
  private updateReady(epoch: number) {
    if (!this.valid(epoch) || !this.ready()) return;
    if (!this.helloSent) {
      this.helloSent = true;
      this.send("hello", { role: this.options.role });
    }
    if (!this.valid(epoch) || !this.ready()) return;
    if (this.announced || !this.helloReceived) return;
    this.announced = true;
    clearTimeout(this.connectionTimeout);
    this.lastSeen = Date.now();
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastSeen > 20000) {
        this.lost();
        return;
      }
      this.send("heartbeat", {});
    }, 5000);
    this.emit({
      status: "connected",
      capturing: false,
      deviceName: this.peerName,
    });
  }
  private bindChannel(channel: RTCDataChannel, epoch: number) {
    if (!this.valid(epoch)) {
      channel.close();
      return;
    }
    this.channel = channel;
    channel.onopen = () => this.updateReady(epoch);
    channel.onclose = () => {
      if (this.valid(epoch)) this.lost();
    };
    channel.onerror = () => {
      if (this.valid(epoch)) this.lost();
    };
    channel.onmessage = (event) => {
      if (
        !this.valid(epoch) ||
        channel.readyState !== "open" ||
        typeof event.data !== "string" ||
        event.data.length > 2048
      )
        return;
      let value: any;
      try {
        value = JSON.parse(event.data);
      } catch {
        return;
      }
      if (
        !value ||
        value.v !== 1 ||
        value.sessionId !== this.sessionId ||
        !Number.isSafeInteger(value.sequence) ||
        value.sequence <= this.receivedSequence ||
        !value.payload ||
        typeof value.payload !== "object"
      )
        return;
      const p = value.payload,
        type = value.type;
      if (type === "hello") {
        if (
          p.role === (this.options.role === "sender" ? "receiver" : "sender")
        ) {
          this.receivedSequence = value.sequence;
          this.lastSeen = Date.now();
          this.helloReceived = true;
          this.updateReady(epoch);
        }
        return;
      }
      if (!this.helloReceived) return;
      const valid =
        type === "heartbeat" ||
        type === "disconnect" ||
        (type === "active" && typeof p.active === "boolean") ||
        (type === "mute" && typeof p.muted === "boolean") ||
        (type === "capture" &&
          this.options.role === "receiver" &&
          typeof p.capturing === "boolean" &&
          permissions.has(p.permission));
      if (!valid) return;
      this.receivedSequence = value.sequence;
      this.lastSeen = Date.now();
      if (type === "active") this.emit({ active: p.active });
      if (type === "mute") this.emit({ muted: p.muted });
      if (type === "capture")
        this.emit({
          capturing: p.capturing && p.permission === "granted",
          permission: p.permission,
        });
      if (type === "disconnect") this.lost();
    };
  }
  private expireAt(deadline?: number) {
    if (!deadline) return;
    this.expiry = setTimeout(
      () => {
        this.closeLocal();
        this.emit({
          status: "error",
          capturing: false,
          receivingAudio: false,
          audioStream: null,
          message: "Session expired. Pair again.",
        });
      },
      Math.max(0, deadline - Date.now()),
    );
  }
  private createPeer(epoch: number) {
    const configuration = { iceServers: this.options.iceServers };
    const peer =
      this.options.peerFactory?.(configuration) ??
      new RTCPeerConnection(configuration);
    this.peer = peer;
    this.abort = new AbortController();
    this.announced = false;
    this.helloSent = this.helloReceived = false;
    this.sentSequence = this.receivedSequence = 0;
    peer.onconnectionstatechange = () => {
      if (!this.valid(epoch)) return;
      if (["disconnected", "failed", "closed"].includes(peer.connectionState)) {
        this.lost();
        return;
      }
      this.updateReady(epoch);
    };
    peer.ondatachannel = (event) => this.bindChannel(event.channel, epoch);
    peer.ontrack = (event) => {
      if (
        !this.valid(epoch) ||
        this.options.role !== "receiver" ||
        event.track.kind !== "audio"
      )
        return;
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      this.remote = stream;
      const receipt = () => {
        if (this.valid(epoch))
          this.emit({
            audioStream: stream,
            receivingAudio:
              event.track.readyState === "live" && !event.track.muted,
          });
      };
      event.track.addEventListener("unmute", receipt);
      event.track.addEventListener("mute", receipt);
      event.track.addEventListener("ended", receipt);
      receipt();
    };
    return peer;
  }
  private armConnectionTimeout(epoch: number) {
    if (!this.valid(epoch) || this.announced) return;
    this.connectionTimeout = setTimeout(() => {
      if (this.valid(epoch)) {
        this.reset();
        this.emit({
          status: "error",
          message:
            "Phone could not connect. Use the same network, then pair again.",
        });
      }
    }, 30000);
  }
  private async gathered(peer: RTCPeerConnection, signal: AbortSignal) {
    if (signal.aborted) throw new DOMException("Pairing stopped", "AbortError");
    if (peer.iceGatheringState !== "complete")
      await new Promise<void>((resolve, reject) => {
        const clean = () => {
          peer.removeEventListener("icegatheringstatechange", change);
          signal.removeEventListener("abort", cancel);
          clearTimeout(timer);
        };
        const change = () => {
          if (peer.iceGatheringState === "complete") {
            clean();
            resolve();
          }
        };
        const cancel = () => {
          clean();
          reject(new DOMException("Pairing stopped", "AbortError"));
        };
        const timer = setTimeout(() => {
          clean();
          reject(new Error("Pairing could not establish a network path."));
        }, 10000);
        peer.addEventListener("icegatheringstatechange", change);
        signal.addEventListener("abort", cancel, { once: true });
        if (signal.aborted) cancel();
      });
    const description = peer.localDescription;
    if (!description?.sdp)
      throw new Error("Pairing could not create an audio offer.");
    return {
      type: description.type,
      sdp: description.sdp,
    } as RTCSessionDescriptionInit;
  }
  async createPairing(): Promise<PairingOffer> {
    this.reset();
    if (!this.available || this.options.role !== "receiver")
      throw new Error("Phone pairing is unavailable.");
    const epoch = this.epoch;
    try {
      const peer = this.createPeer(epoch);
      const signal = this.abort!.signal;
      peer.addTransceiver("audio", { direction: "recvonly" });
      this.bindChannel(
        peer.createDataChannel("talkdeck-control", { ordered: true }),
        epoch,
      );
      await peer.setLocalDescription(await peer.createOffer());
      const description = await this.gathered(peer, signal);
      if (!this.valid(epoch)) throw new Error("Pairing stopped.");
      const offer = await this.options.signaling.createOffer(description);
      if (!this.valid(epoch)) {
        void this.options.signaling.revoke(offer.sessionId).catch(() => {});
        throw new Error("Pairing stopped.");
      }
      this.sessionId = offer.sessionId;
      this.expireAt(offer.sessionExpiresAt);
      void this.options.signaling
        .waitForAnswer(offer.sessionId, this.abort!.signal)
        .then(async (answer) => {
          if (this.valid(epoch)) {
            this.armConnectionTimeout(epoch);
            await peer.setRemoteDescription(answer);
          }
        })
        .catch(() => {
          if (this.valid(epoch)) {
            this.closeLocal();
            this.emit({
              status: "error",
              message: "Phone pairing could not connect. Pair again.",
            });
          }
        });
      return {
        code: offer.code,
        qrUrl: offer.qrUrl,
        expiresAt: offer.expiresAt,
      };
    } catch (error) {
      if (epoch === this.epoch) this.reset();
      throw error instanceof PhoneSignalingFailure
        ? error
        : new Error("Phone could not connect. Retry.");
    }
  }
  async join(code: string) {
    this.reset();
    if (!this.available || this.options.role !== "sender")
      throw new Error("Phone pairing is unavailable.");
    const epoch = this.epoch;
    try {
      const offer = await this.options.signaling.claim(code);
      if (epoch !== this.epoch) {
        void this.options.signaling.revoke(offer.sessionId).catch(() => {});
        return;
      }
      this.sessionId = offer.sessionId;
      this.peerName = offer.peerName;
      this.expireAt(offer.sessionExpiresAt);
      const peer = this.createPeer(epoch),
        signal = this.abort!.signal;
      await peer.setRemoteDescription(offer.offer);
      if (!this.valid(epoch)) return;
      const transceiver = peer
        .getTransceivers()
        .find((t) => t.receiver.track.kind === "audio");
      if (!transceiver)
        throw new Error("No microphone audio path was offered.");
      transceiver.direction = "sendonly";
      this.sender = transceiver.sender;
      await peer.setLocalDescription(await peer.createAnswer());
      const answer = await this.gathered(peer, signal);
      if (this.valid(epoch))
        await this.options.signaling.answer(offer.sessionId, answer);
      this.armConnectionTimeout(epoch);
    } catch (error) {
      if (epoch === this.epoch) this.reset();
      throw error instanceof PhoneSignalingFailure
        ? error
        : new Error("Phone could not connect. Retry.");
    }
  }
  private send(type: string, payload: Record<string, unknown>) {
    if (this.channel?.readyState === "open" && this.sessionId) {
      try {
        this.channel.send(
          JSON.stringify({
            v: 1,
            sessionId: this.sessionId,
            sequence: ++this.sentSequence,
            type,
            payload,
          }),
        );
      } catch {
        this.lost();
      }
    }
  }
  setActive(active: boolean) {
    this.send("active", { active });
  }
  setMuted(muted: boolean) {
    this.send("mute", { muted });
  }
  reportCapture(ack: CaptureAcknowledgement) {
    if (this.options.role === "sender") this.send("capture", { ...ack });
  }
  /** Raw-media transport never accepts recognized text as microphone input. */
  sendSpeech() {}
  async attachStream(stream: MediaStream) {
    if (
      this.options.role !== "sender" ||
      !this.ready() ||
      !this.announced ||
      !this.sender
    )
      throw new Error("Phone is not connected.");
    const track = stream.getAudioTracks()[0];
    if (!track || track.readyState !== "live")
      throw new Error("No microphone audio track.");
    const epoch = this.epoch,
      sender = this.sender;
    this.stream = stream;
    await sender.replaceTrack(track);
    if (!this.valid(epoch) || !this.ready()) {
      if (sender.track === track) await sender.replaceTrack(null);
      throw new Error("Phone disconnected.");
    }
  }
  detachStream() {
    this.stream = undefined;
    void this.sender?.replaceTrack(null).catch(() => {});
  }
  private closeLocal() {
    ++this.epoch;
    clearInterval(this.heartbeat);
    clearTimeout(this.expiry);
    clearTimeout(this.connectionTimeout);
    this.heartbeat = undefined;
    this.expiry = undefined;
    this.abort?.abort();
    this.abort = undefined;
    const channel = this.channel;
    this.channel = undefined;
    if (channel) {
      channel.onopen =
        channel.onclose =
        channel.onerror =
        channel.onmessage =
          null;
      channel.close();
    }
    const peer = this.peer;
    this.peer = undefined;
    if (peer) {
      peer.ontrack = peer.onconnectionstatechange = peer.ondatachannel = null;
      peer.close();
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.remote?.getTracks().forEach((track) => track.stop());
    this.stream = this.remote = undefined;
    this.sender = undefined;
    this.announced = false;
  }
  private lost() {
    this.closeLocal();
    this.emit({
      status: "disconnected",
      capturing: false,
      receivingAudio: false,
      audioStream: null,
      message: "Phone disconnected. Reconnect to continue.",
    });
  }
  private reset() {
    const id = this.sessionId;
    this.send("disconnect", {});
    this.sessionId = undefined;
    this.closeLocal();
    if (id) void this.options.signaling.revoke(id).catch(() => {});
  }
  disconnect() {
    this.reset();
    this.emit({
      status: "disconnected",
      capturing: false,
      receivingAudio: false,
      audioStream: null,
    });
  }
}
