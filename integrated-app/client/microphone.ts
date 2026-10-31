import { RawMicrophoneCapture, type RawMicrophoneSnapshot } from '../../frontend/src/services/rawMicrophone';
import { ApiError, type AudioInput } from './api';

interface Binding { epoch: number; slideId: string; practice: boolean; modeStartedAtMs: number; nextSequence: number; }
/** Uses the existing microphone lifecycle. Unacknowledged PCM remains bounded and retryable by identical ID. */
export class CanonicalMicrophone {
  readonly capture: RawMicrophoneCapture;
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private gain?: GainNode;
  private binding?: Binding;
  private captureStart = 0;
  private sequence = 0;
  private parts: ArrayBuffer[] = [];
  private startMs = 0;
  private silenceMs = 0;
  private voiced = false;
  private durationMs = 0;
  private queue: AudioInput[] = [];
  private sending?: Promise<void>;
  private failure?: Error;
  private flushResolve?: () => void;
  private active = false;
  private epoch = 0;
  constructor(private options: {
    canCapture: () => boolean;
    serverNow: () => number;
    binding: () => Binding;
    send: (chunk: AudioInput) => Promise<unknown>;
    level: (value: number) => void;
    change: (snapshot: RawMicrophoneSnapshot) => void;
    pending: (count: number) => void;
    error: (message: string) => void;
  }) {
    this.capture = new RawMicrophoneCapture({
      canCapture: options.canCapture,
      attach: stream => this.attach(stream),
      detach: () => this.detach(), report: () => {},
    });
    this.capture.subscribe(() => options.change(this.capture.getSnapshot()));
  }
  get pending() { return this.queue.length; }
  async start() { if (this.failure) throw this.failure; await this.capture.start(); }
  private async attach(stream: MediaStream) {
    const epoch = ++this.epoch;
    this.binding = { ...this.options.binding() }; this.sequence = this.binding.nextSequence;
    this.captureStart = this.options.serverNow() - this.binding.modeStartedAtMs;
    const context = new AudioContext(); this.context = context;
    await context.audioWorklet.addModule('/pcm-worklet.js');
    if (epoch !== this.epoch) { await context.close(); return; }
    const node = new AudioWorkletNode(context, 'talkdeck-pcm'); this.node = node;
    node.port.onmessage = event => {
      if (event.data.flushed) { this.flushResolve?.(); this.flushResolve = undefined; return; }
      if (!this.active || epoch !== this.epoch) return;
      this.receive(event.data.pcm, event.data.startSample, event.data.rms);
    };
    this.source = context.createMediaStreamSource(stream);
    this.gain = context.createGain(); this.gain.gain.value = 0;
    this.source.connect(node); node.connect(this.gain); this.gain.connect(context.destination);
    this.captureStart = this.options.serverNow() - this.binding.modeStartedAtMs;
    this.active = true; await context.resume();
  }
  private receive(pcm: ArrayBuffer, startSample: number, rms: number) {
    if (!this.binding) return;
    this.options.level(Math.min(1, rms * 10));
    const duration = pcm.byteLength / 48;
    if (!this.parts.length) { this.startMs = Math.max(0, this.captureStart + startSample / 24); this.binding.slideId = this.options.binding().slideId; }
    this.parts.push(pcm); this.durationMs += duration;
    if (rms > 0.008) { this.voiced = true; this.silenceMs = 0; } else this.silenceMs += duration;
    if (this.binding.practice ? this.durationMs >= 1000 : (this.voiced && this.silenceMs >= 750) || this.durationMs >= 12000) this.finalize();
    if (!this.binding.practice && !this.voiced && this.durationMs >= 1000) { this.parts = this.parts.slice(-1); this.durationMs = duration; this.startMs = Math.max(0, this.captureStart + startSample / 24); }
  }
  private finalize() {
    if (!this.binding || !this.parts.length) return;
    if (this.binding.practice || this.voiced) {
      const pcm = new Uint8Array(this.parts.reduce((sum, part) => sum + part.byteLength, 0)); let offset = 0;
      for (const part of this.parts) { pcm.set(new Uint8Array(part), offset); offset += part.byteLength; }
      const chunk: AudioInput = { id: crypto.randomUUID(), epoch: this.binding.epoch, slideId: this.binding.slideId,
        sequence: this.sequence++, startMs: this.startMs, endMs: this.startMs + this.durationMs, pcm: pcm.buffer };
      this.queue.push(chunk); this.options.pending(this.queue.length);
      if (this.queue.reduce((sum, item) => sum + item.pcm.byteLength, 0) > 8 * 1024 * 1024) {
        this.failure = new Error('Audio upload buffer is full. Capture stopped; queued audio is retained. Reconnect and retry before continuing.');
        this.options.error(this.failure.message); this.capture.stop();
      } else void this.pump();
    }
    this.parts = []; this.durationMs = 0; this.silenceMs = 0; this.voiced = false;
  }
  private pump(): Promise<void> {
    if (this.sending) return this.sending;
    this.sending = (async () => {
      while (this.queue.length) {
        try { await this.options.send(this.queue[0]); this.queue.shift(); this.failure = undefined; this.options.pending(this.queue.length); }
        catch (error) { this.failure = error instanceof Error ? error : new Error(String(error)); this.options.error(`Audio retained but not acknowledged: ${this.failure.message}`); this.capture.stop(); break; }
      }
    })().finally(() => { this.sending = undefined; });
    return this.sending;
  }
  async recoverConnection() {
    if (this.failure instanceof TypeError || this.failure instanceof ApiError && this.failure.status === 401) await this.retry();
  }
  async retry() { this.failure = undefined; await this.pump(); if (this.failure) throw this.failure; }
  async stopAndDrain() {
    if (this.active && this.node) {
      await new Promise<void>(resolve => { this.flushResolve = resolve; this.node!.port.postMessage('flush'); setTimeout(resolve, 1000); });
      this.finalize();
    }
    this.capture.stop(); await this.pump(); if (this.failure) throw this.failure;
  }
  /** Disconnect stops forwarding immediately; already queued chunks keep their IDs. */
  disconnect() { this.finalize(); this.capture.stop(); }
  private detach() {
    this.active = false; ++this.epoch;
    this.node?.disconnect(); this.source?.disconnect(); this.gain?.disconnect();
    if (this.context && this.context.state !== 'closed') void this.context.close();
    this.context = undefined; this.node = undefined; this.source = undefined; this.gain = undefined;
    this.options.level(0);
  }
  dispose() { this.active = false; this.capture.dispose(); }
}
