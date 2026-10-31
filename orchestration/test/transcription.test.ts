import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import OpenAI from "openai";
import { WebSocketServer } from "ws";
import { LiveTranscription } from "../src/transcription.js";
test("live transcription transport configures a silent session, streams PCM, and reconciles final text", async () => {
  const server = new WebSocketServer({ port: 0 });
  await once(server, "listening");
  let appended = 0;
  let config: any;
  server.on("connection", (socket) =>
    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "session.update") {
        config = event.session;
        socket.send(JSON.stringify({ type: "session.updated" }));
      }
      if (event.type === "input_audio_buffer.append")
        appended += Buffer.from(event.audio, "base64").length;
      if (event.type === "input_audio_buffer.commit") {
        for (const e of [
          {
            type: "input_audio_buffer.committed",
            item_id: "a",
            previous_item_id: null,
          },
          {
            type: "conversation.item.input_audio_transcription.delta",
            item_id: "a",
            delta: "sixty students",
          },
          {
            type: "conversation.item.input_audio_transcription.completed",
            item_id: "a",
            transcript: "forty-eight students",
          },
        ])
          socket.send(JSON.stringify(e));
      }
    }),
  );
  const updates: string[] = [];
  const t = new LiveTranscription(
    new OpenAI({ apiKey: "test-only" }),
    "gpt-live-transcribe",
    (text) => updates.push(text),
    undefined,
    {
      url: `ws://127.0.0.1:${(server.address() as { port: number }).port}`,
      connectTimeoutMs: 1000,
      maxConnectionAttempts: 1,
    },
  );
  try {
    await t.connect();
    t.append(Buffer.alloc(4800));
    await t.commit(1000);
    assert.equal(appended, 4800);
    assert.equal(config.type, "transcription");
    assert.equal(config.audio.input.turn_detection, null);
    assert.deepEqual(updates, ["sixty students", "forty-eight students"]);
  } finally {
    t.close();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("failed transcription connection releases resources and reports failure", async () => {
  const server = new WebSocketServer({ port: 0 });
  await once(server, "listening");
  const t = new LiveTranscription(
    new OpenAI({ apiKey: "test-only" }),
    "gpt-live-transcribe",
    () => {},
    undefined,
    {
      url: `ws://127.0.0.1:${(server.address() as { port: number }).port}`,
      connectTimeoutMs: 20,
      maxConnectionAttempts: 1,
    },
  );
  try {
    await assert.rejects(t.connect(), /timed out/);
  } finally {
    t.close();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("timeout during WebSocket HTTP upgrade does not leave an unhandled socket error", async () => {
  const { createServer } = await import("node:net");
  const sockets = new Set<import("node:net").Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const t = new LiveTranscription(
    new OpenAI({ apiKey: "test-only" }),
    "gpt-live-transcribe",
    () => {},
    undefined,
    {
      url: `ws://127.0.0.1:${(server.address() as { port: number }).port}`,
      connectTimeoutMs: 20,
      maxConnectionAttempts: 1,
    },
  );
  try {
    await assert.rejects(t.connect(), /timed out/);
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    t.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
