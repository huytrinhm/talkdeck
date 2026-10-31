import WebSocket from "ws";
import { setTimeout as delay } from "node:timers/promises";
import type OpenAI from "openai";
import type { Log } from "./types.js";
import { silentLog } from "./types.js";
/** Canonical transcript ordered by item linkage, independent of completion order. */
export class TranscriptAccumulator {
  private items = new Map<
    string,
    { text: string; previous: string | null; ordered: boolean; done: boolean }
  >();
  private last = "";
  revision = 0;
  constructor(private update: (text: string, revision: number) => void) {}
  event(event: Record<string, any>) {
    const id = event.item_id ?? event.item?.id;
    if (!id) return;
    const item = this.items.get(id) ?? {
      text: "",
      previous: null,
      ordered: false,
      done: false,
    };
    this.items.set(id, item);
    if (
      event.type === "input_audio_buffer.committed" ||
      event.type === "conversation.item.created" ||
      event.type === "conversation.item.added"
    ) {
      item.previous = event.previous_item_id ?? null;
      item.ordered = true;
    }
    if (
      event.type === "conversation.item.input_audio_transcription.delta" &&
      !item.done
    )
      item.text += event.delta ?? "";
    if (
      event.type === "conversation.item.input_audio_transcription.completed"
    ) {
      item.text = event.transcript ?? "";
      item.done = true;
    }
    // Some streaming models deliver deltas before committed. There is one live turn;
    // known predecessor links order committed turns; uncommitted items follow them.
    const ordered: string[] = [];
    const seen = new Set<string>();
    const visit = (previous: string | null) => {
      for (const [key, value] of this.items)
        if (value.ordered && value.previous === previous && !seen.has(key)) {
          seen.add(key);
          ordered.push(key);
          visit(key);
        }
    };
    visit(null);
    for (const [key, value] of this.items)
      if (!seen.has(key) && !value.ordered) {
        ordered.push(key);
      }
    const text = ordered
      .map((key) => this.items.get(key)!.text.trim())
      .filter(Boolean)
      .join(" ");
    if (text !== this.last) {
      this.last = text;
      this.update(text, ++this.revision);
    }
  }
  get text() {
    return this.last;
  }
}
export function readWav(buffer: Buffer) {
  if (
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  )
    throw new Error("Expected RIFF WAV");
  let format:
    | { format: number; channels: number; rate: number; bits: number }
    | undefined;
  let pcm: Buffer | undefined;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const tag = buffer.toString("ascii", offset, offset + 4),
      size = buffer.readUInt32LE(offset + 4),
      start = offset + 8;
    if (tag === "fmt ")
      format = {
        format: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        rate: buffer.readUInt32LE(start + 4),
        bits: buffer.readUInt16LE(start + 14),
      };
    if (tag === "data") {
      pcm = buffer.subarray(start, Math.min(start + size, buffer.length));
      break;
    }
    offset = start + size + (size % 2);
  }
  if (
    !pcm ||
    !format ||
    format.format !== 1 ||
    format.channels !== 1 ||
    format.rate !== 24000 ||
    format.bits !== 16
  )
    throw new Error("Expected 24 kHz mono PCM16 WAV");
  return { pcm, durationMs: pcm.length / 48 };
}
export class LiveTranscription {
  private ws?: WebSocket;
  private readyResolve?: () => void;
  private readyReject?: (e: Error) => void;
  private completed = new Set<string>();
  private committed = new Set<string>();
  private failure?: Error;
  private closed = false;
  readonly accumulator: TranscriptAccumulator;
  constructor(
    private client: OpenAI,
    private model: string,
    onTranscript: (text: string, revision: number) => void,
    private log: Log = silentLog,
    private options: {
      url?: string;
      connectTimeoutMs?: number;
      maxConnectionAttempts?: number;
    } = {},
  ) {
    this.accumulator = new TranscriptAccumulator(onTranscript);
  }
  async connect() {
    for (
      let attempt = 0;
      attempt < (this.options.maxConnectionAttempts ?? 2);
      attempt++
    ) {
      try {
        await this.open();
        return;
      } catch (error) {
        this.ws?.removeAllListeners();
        // terminate() can emit an error while the HTTP upgrade is still pending.
        this.ws?.on("error", () => {});
        this.ws?.terminate();
        if (
          this.closed ||
          attempt === (this.options.maxConnectionAttempts ?? 2) - 1
        )
          throw error;
        this.failure = undefined;
        await delay(500);
      }
    }
  }
  private async open() {
    const ws = (this.ws = new WebSocket(
      this.options.url ??
        "wss://api.openai.com/v1/realtime?intent=transcription",
      { headers: { Authorization: `Bearer ${this.client.apiKey}` } },
    ));
    const ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    const timer = setTimeout(
      () => this.fail(new Error("Transcription connection timed out")),
      this.options.connectTimeoutMs ?? 60000,
    );
    ws.on("open", () =>
      this.send({
        type: "session.update",
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              transcription: {
                model: this.model,
                ...(this.model === "gpt-live-transcribe"
                  ? { languages: ["en", "vi"], delay: "low" }
                  : { prompt: "Speech is in English and Vietnamese, sometimes mixed. Transcribe in the original language." }),
              },
              turn_detection: null,
            },
          },
        },
      }),
    );
    ws.on("message", (raw) => {
      try {
        const e = JSON.parse(raw.toString());
        this.log.write("transcription_event", { event: e });
        if (
          e.type === "session.updated" ||
          e.type === "transcription_session.updated"
        )
          this.readyResolve?.();
        if (
          e.type === "error" ||
          e.type === "conversation.item.input_audio_transcription.failed"
        ) {
          this.fail(new Error(e.error?.message ?? "Transcription failed"));
          return;
        }
        if (e.type === "input_audio_buffer.committed")
          this.committed.add(e.item_id);
        if (e.type === "conversation.item.input_audio_transcription.completed")
          this.completed.add(e.item_id);
        this.accumulator.event(e);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    ws.on("error", (e) => this.fail(e));
    ws.on("close", () => {
      if (!this.closed)
        this.fail(new Error("Transcription connection closed unexpectedly"));
    });
    try {
      await ready;
    } finally {
      clearTimeout(timer);
    }
  }
  private fail(e: Error) {
    this.failure = e;
    this.readyReject?.(e);
  }
  private send(event: unknown) {
    if (this.failure) throw this.failure;
    if (this.ws?.readyState !== WebSocket.OPEN)
      throw new Error("Transcription not connected");
    this.ws.send(JSON.stringify(event));
  }
  append(pcm: Buffer) {
    this.send({
      type: "input_audio_buffer.append",
      audio: pcm.toString("base64"),
    });
  }
  async commit(timeoutMs = 60000) {
    const prior = this.committed.size;
    this.send({ type: "input_audio_buffer.commit" });
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      if (this.failure) throw this.failure;
      if (
        this.committed.size > prior &&
        [...this.committed].every((id) => this.completed.has(id))
      )
        return;
      await delay(25);
    }
    throw new Error("Final transcription did not arrive before deadline");
  }
  async replay(wav: Buffer, speed = 1) {
    const { pcm } = readWav(wav);
    const chunkBytes = 4800;
    const start = performance.now();
    for (let offset = 0; offset < pcm.length; offset += chunkBytes) {
      if (this.failure) throw this.failure;
      const scheduled = start + offset / 48 / speed;
      await delay(Math.max(0, scheduled - performance.now()));
      this.append(pcm.subarray(offset, offset + chunkBytes));
    }
    await this.commit();
  }
  close() {
    this.closed = true;
    this.failure ??= new Error("Transcription closed");
    this.readyReject?.(this.failure);
    this.ws?.close();
  }
}
