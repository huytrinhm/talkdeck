import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { z } from "zod";
import { clientFromEnv, models } from "./config.js";
import { OpenAIDecider, OpenAIModel } from "./openai.js";
import { SlideRuntime } from "./runtime.js";
import { AssetStore, assetOrigin } from "./assets.js";
import { ChromiumRenderer } from "./renderer.js";
import { FileLog } from "./log.js";
import { LiveTranscription } from "./transcription.js";
const root = fileURLToPath(new URL("../", import.meta.url));
const client = clientFromEnv(),
  selected = models();
interface Session {
  runtime: SlideRuntime;
  assets: AssetStore;
  log: FileLog;
  transcriber?: LiveTranscription;
  connecting?: Promise<void>;
  audioSequence: number;
  mode?: "text" | "audio";
  streams: Set<ServerResponse>;
}
const sessions = new Map<string, Session>();
async function body(req: IncomingMessage, limit = 2_000_000) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && path === "/health") {
      json(res, { ok: true, sessions: sessions.size });
      return;
    }
    if (req.method === "POST" && path === "/sessions") {
      const input = z
        .object({
          context: z.string().default(""),
          initialSource: z.string().optional(),
        })
        .parse(JSON.parse((await body(req)).toString() || "{}"));
      const id = randomUUID(),
        assets = new AssetStore(join(root, "runs", "server", id, "assets")),
        log = new FileLog(join(root, "runs", "server", id));
      const runtime = await SlideRuntime.create({
        assets,
        log,
        client,
        context: input.context,
        initialSource: input.initialSource,
        renderer: new ChromiumRenderer(assets),
        decider: new OpenAIDecider(client, selected.decision, log),
        model: new OpenAIModel(client, selected, log),
      });
      sessions.set(id, {
        runtime,
        assets,
        log,
        audioSequence: 0,
        streams: new Set(),
      });
      json(
        res,
        {
          id,
          events: `/sessions/${id}/events`,
          slide: `/sessions/${id}/slide`,
          screenshot: `/sessions/${id}/screenshot`,
        },
        201,
      );
      return;
    }
    const match = path.match(/^\/sessions\/([^/]+)(?:\/(.*))?$/),
      session = match && sessions.get(match[1]);
    if (!match || !session) {
      json(res, { error: "Not found" }, 404);
      return;
    }
    const id = match[1],
      resource = match[2] ?? "",
      runtime = session.runtime;
    if (req.method === "DELETE" && !resource) {
      session.transcriber?.close();
      for (const stream of session.streams) stream.end();
      await runtime.close();
      sessions.delete(id);
      json(res, { closed: true });
      return;
    }
    if (req.method === "GET" && !resource) {
      json(res, {
        id,
        statuses: runtime.statuses(),
        observation: runtime.publisher.current.id,
      });
      return;
    }
    if (req.method === "POST" && resource === "transcript") {
      if (session.mode === "audio")
        throw new Error(
          "Cannot mix direct transcript and audio input in one session",
        );
      const input = z
        .object({ text: z.string(), revision: z.number().int().positive() })
        .parse(JSON.parse((await body(req)).toString()));
      session.mode = "text";
      runtime.receiveTranscript(input.text, input.revision);
      json(res, { accepted: true }, 202);
      return;
    }
    if (req.method === "POST" && resource === "audio") {
      if (session.mode === "text")
        throw new Error(
          "Cannot mix direct transcript and audio input in one session",
        );
      const sequence = Number(req.headers["x-audio-sequence"]);
      const pcm = await body(req, 480000);
      if (sequence !== session.audioSequence + 1)
        throw new Error(
          `Expected X-Audio-Sequence ${session.audioSequence + 1}`,
        );
      if (!pcm.length || pcm.length % 2)
        throw new Error("Expected nonempty mono PCM16 at 24000 Hz");
      // Reserve the sequence before awaiting connection; clients must send chunks serially.
      session.audioSequence = sequence;
      session.mode = "audio";
      if (!session.transcriber) {
        session.transcriber = new LiveTranscription(
          client,
          selected.transcription,
          (text, revision) => runtime.receiveTranscript(text, revision),
          session.log,
        );
        session.connecting = session.transcriber.connect();
      }
      await session.connecting;
      session.transcriber.append(pcm);
      json(res, { accepted: true, sequence }, 202);
      return;
    }
    if (req.method === "POST" && resource === "audio/commit") {
      if (!session.transcriber) throw new Error("No audio session");
      await session.connecting;
      await session.transcriber.commit();
      json(res, { text: session.transcriber.accumulator.text });
      return;
    }
    if (req.method === "GET" && resource === "events") {
      const after = Number(req.headers["last-event-id"] ?? 0);
      if (!Number.isSafeInteger(after) || after < 0)
        throw new Error("Invalid Last-Event-ID");
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.flushHeaders();
      session.streams.add(res);
      const send = (e: (typeof runtime.events)[number]) =>
        res.write(
          `id: ${e.sequence}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`,
        );
      for (const event of runtime.events)
        if (event.sequence > after) send(event);
      const unsubscribe = runtime.subscribe(send),
        heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15000);
      req.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
        session.streams.delete(res);
      });
      return;
    }
    if (req.method === "GET" && resource === "screenshot") {
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      });
      res.end(runtime.publisher.current.screenshot);
      return;
    }
    if (req.method === "GET" && resource === "slide") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "sandbox allow-scripts; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src 'self' data:; connect-src 'none'",
      });
      res.end(
        runtime.publisher.current.source.replaceAll(
          assetOrigin,
          `/sessions/${id}/assets`,
        ),
      );
      return;
    }
    if (req.method === "GET" && resource.startsWith("assets/")) {
      const asset = session.assets.get(`${assetOrigin}/${resource.slice(7)}`);
      if (!asset) {
        json(res, { error: "Unknown asset" }, 404);
        return;
      }
      res.writeHead(200, {
        "Content-Type": asset.mediaType,
        "Cache-Control": "public, max-age=31536000, immutable",
      });
      res.end(asset.data);
      return;
    }
    json(res, { error: "Not found" }, 404);
  } catch (e) {
    if (!res.headersSent)
      json(res, { error: e instanceof Error ? e.message : String(e) }, 400);
    else res.end();
  }
});
const port = Number(process.env.PORT ?? 8787);
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Orchestration API listening on http://127.0.0.1:${(server.address() as { port: number }).port}`,
  ),
);
async function close() {
  server.close();
  for (const session of sessions.values()) {
    session.transcriber?.close();
    for (const stream of session.streams) stream.end();
    await session.runtime.close();
  }
}
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
