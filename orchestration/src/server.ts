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
import { OpenAIDecider, OpenAISlowDecider, OpenAIModel } from "./openai.js";
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
  audioPending: boolean;
  audioSlideId?: string;
  mutations: Promise<void>;
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
async function finishAudioSegment(session: Session) {
  if (!session.transcriber) return;
  await session.connecting;
  if (session.audioPending) {
    await session.transcriber.commit();
    session.audioPending = false;
  }
  session.transcriber.close();
  session.transcriber = undefined;
  session.connecting = undefined;
  session.audioSlideId = undefined;
}
const server = createServer(async (req, res) => {
  let release: (() => void) | undefined;
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
        slowDecider: new OpenAISlowDecider(client, selected.decision, log),
        model: new OpenAIModel(client, selected, log),
      });
      sessions.set(id, {
        runtime,
        assets,
        log,
        audioSequence: 0,
        audioPending: false,
        mutations: Promise.resolve(),
        streams: new Set(),
      });
      json(
        res,
        {
          id,
          events: `/sessions/${id}/events`,
          slide: `/sessions/${id}/slide`,
          screenshot: `/sessions/${id}/screenshot`,
          selectedSlideId: runtime.publisher.selectedId,
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
    if (
      (req.method === "POST" && !["pause", "resume"].includes(resource)) ||
      req.method === "DELETE"
    ) {
      const prior = session.mutations;
      session.mutations = new Promise<void>((resolve) => {
        release = resolve;
      });
      await prior;
      if (!sessions.has(id)) throw new Error("Session closed");
    }
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
        paused: runtime.paused,
        history: runtime.publisher.historyStatus(),
        deck: runtime.deckContext(),
      });
      return;
    }
    if (req.method === "GET" && resource === "slides") {
      json(res, runtime.deckContext());
      return;
    }
    if (
      req.method === "POST" &&
      (resource === "pause" || resource === "resume")
    ) {
      if (resource === "pause") runtime.pause();
      else runtime.resume();
      json(res, { paused: runtime.paused, statuses: runtime.statuses() });
      return;
    }
    if (
      req.method === "POST" &&
      (resource === "next" || resource === "select")
    ) {
      const input =
        resource === "select"
          ? z
              .object({ slideId: z.string().min(1) })
              .parse(JSON.parse((await body(req)).toString()))
          : null;
      if (input) runtime.publisher.get(input.slideId); // Validate before finalizing audio.
      await finishAudioSegment(session);
      const slide = input
        ? await runtime.selectSlide(input.slideId)
        : await runtime.nextSlide();
      json(res, { selectedSlideId: slide.id, deck: runtime.deckContext() });
      return;
    }
    if (req.method === "GET" && resource === "history") {
      json(res, runtime.publisher.historyStatus());
      return;
    }
    if (req.method === "POST" && resource === "push-to-edit") {
      const input = z
        .object({
          prompt: z.string().trim().min(1),
          slideId: z.string().min(1).optional(),
        })
        .parse(JSON.parse((await body(req)).toString()));
      json(res, runtime.pushToEdit(input.prompt, input.slideId), 202);
      return;
    }
    if (req.method === "POST" && (resource === "undo" || resource === "redo")) {
      // Finalize the old audio binding before restoration can remove its slide.
      const status = runtime.publisher.historyStatus();
      if (resource === "undo" ? status.canUndo : status.canRedo)
        await finishAudioSegment(session);
      const result =
        resource === "undo" ? await runtime.undo() : await runtime.redo();
      json(res, { ...result, deck: runtime.deckContext() });
      return;
    }
    if (req.method === "POST" && resource === "work") {
      const input = z
        .object({
          agent: z.enum(["fast", "slow"]).default("slow"),
          task: z.string().min(1),
          facts: z.string().default(""),
          slideId: z.string().optional(),
        })
        .parse(JSON.parse((await body(req)).toString()));
      const slideId = input.slideId ?? runtime.publisher.selectedId;
      runtime.publisher.get(slideId);
      runtime.followupTask(input.agent, {
        task: input.task,
        facts: input.facts,
        slideId,
      });
      json(res, { requested: true }, 202);
      return;
    }
    if (
      req.method === "POST" &&
      (resource === "split" || resource === "merge")
    ) {
      const part = z.object({
        title: z.string().min(1),
        source: z.string().min(1),
      });
      const input =
        resource === "split"
          ? z
              .object({
                slideId: z.string(),
                parts: z.array(part).min(2),
                observationId: z.string(),
              })
              .parse(JSON.parse((await body(req)).toString()))
          : z
              .object({
                slideIds: z.array(z.string()).min(2),
                merged: part,
                observationIds: z.array(z.string()).min(2),
              })
              .parse(JSON.parse((await body(req)).toString()));
      const ids = "slideId" in input ? [input.slideId] : input.slideIds;
      const expected =
        "observationId" in input ? [input.observationId] : input.observationIds;
      if (ids.length !== expected.length)
        throw new Error("One observed snapshot ID per slide is required");
      const branches = ids.map((slideId, i) => {
        const o = runtime.publisher.get(slideId).observation;
        if (o.id !== expected[i])
          throw new Error(
            "Slide changed since user observed it; refresh before restructuring",
          );
        return runtime.publisher.branch("user", "slow", o);
      });
      await finishAudioSegment(session);
      const result =
        "parts" in input
          ? await runtime.publisher.split(branches[0], input.parts, true)
          : await runtime.publisher.mergeSlides(branches, input.merged, true);
      json(
        res,
        { ...result, deck: runtime.deckContext() },
        result.outcome === "rejected" ? 409 : 200,
      );
      return;
    }
    if (req.method === "POST" && resource === "transcript") {
      if (session.mode === "audio")
        throw new Error(
          "Cannot mix direct transcript and audio input in one session",
        );
      const input = z
        .object({
          text: z.string(),
          revision: z.number().int().positive(),
          slideId: z.string().optional(),
        })
        .parse(JSON.parse((await body(req)).toString()));
      if (!input.slideId && runtime.publisher.list().length > 1)
        throw new Error(
          "slideId is required for multi-slide transcript routing",
        );
      runtime.receiveTranscript(input.text, input.revision, input.slideId);
      session.mode = "text";
      json(res, { accepted: true }, 202);
      return;
    }
    if (req.method === "POST" && resource === "audio") {
      if (session.mode === "text")
        throw new Error(
          "Cannot mix direct transcript and audio input in one session",
        );
      const routedSlide = req.headers["x-slide-id"];
      if (runtime.publisher.list().length > 1 && !routedSlide)
        throw new Error("X-Slide-ID is required for multi-slide audio routing");
      if (routedSlide && routedSlide !== runtime.publisher.selectedId)
        throw new Error(
          "Audio chunk belongs to a different selection; refresh before sending",
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
        const slideId = runtime.publisher.selectedId;
        const existing = runtime.gates.get(slideId)?.latest;
        const prefix = existing?.text ?? "",
          baseline = existing?.revision ?? 0;
        session.audioSlideId = slideId;
        session.transcriber = new LiveTranscription(
          client,
          selected.transcription,
          (text, revision) =>
            runtime.receiveTranscript(
              [prefix, text].filter(Boolean).join(" "),
              baseline + revision,
              slideId,
            ),
          session.log,
        );
        session.connecting = session.transcriber.connect();
      }
      await session.connecting;
      session.transcriber.append(pcm);
      session.audioPending = true;
      json(res, { accepted: true, sequence }, 202);
      return;
    }
    if (req.method === "POST" && resource === "audio/commit") {
      if (!session.transcriber) throw new Error("No audio session");
      await session.connecting;
      if (session.audioPending) {
        await session.transcriber.commit();
        session.audioPending = false;
      }
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
    const slideResource = resource.match(
      /^slides\/([^/]+)(?:\/(screenshot|slide))?$/,
    );
    const observation = slideResource
      ? runtime.publisher.get(slideResource[1]).observation
      : runtime.publisher.current;
    if (req.method === "GET" && slideResource && !slideResource[2]) {
      json(res, {
        id: observation.slideId,
        observationId: observation.id,
        source: observation.source,
        geometry: observation.geometry,
        diagnostics: observation.diagnostics,
      });
      return;
    }
    if (
      req.method === "GET" &&
      (resource === "screenshot" || slideResource?.[2] === "screenshot")
    ) {
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      });
      res.end(observation.screenshot);
      return;
    }
    if (
      req.method === "GET" &&
      (resource === "slide" || slideResource?.[2] === "slide")
    ) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "sandbox allow-scripts; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src 'self' data:; connect-src 'none'",
      });
      res.end(
        observation.source.replaceAll(assetOrigin, `/sessions/${id}/assets`),
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
  } finally {
    release?.();
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
