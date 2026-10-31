import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectStore, ProductError, type RuntimeFactory } from "./host.js";
import { safeError } from "./providers.js";

const id = z.string().min(1).max(256),
  epoch = z.number().int().nonnegative();
const commandSchema = z
  .object({
    id,
    epoch,
    type: z.enum([
      "mode",
      "select",
      "next",
      "previous",
      "add",
      "delete",
      "pause",
      "resume",
      "blackout",
      "build",
      "context",
      "push-to-edit",
    ]),
    mode: z.enum(["view", "talk", "present", "practice", "review"]).optional(),
    slideId: id.optional(),
    value: z.union([z.boolean(), z.number()]).optional(),
    context: z.string().max(100000).optional(),
    prompt: z.string().max(100000).optional(),
    input: z.enum(["audio", "transcript"]).optional(),
  })
  .strict();
const inputSchema = z
  .object({
    id,
    epoch,
    slideId: id,
    text: z.string().min(1).max(100000),
    startMs: z.number().nonnegative(),
    endMs: z.number().nonnegative(),
    correctionOf: id.optional(),
  })
  .strict();
export function createProductApp(
  options: { directory?: string; runtimeFactory?: RuntimeFactory } = {},
) {
  const store = new ProjectStore(
    options.directory ??
      resolve(fileURLToPath(new URL("../.data/projects", import.meta.url))),
    options.runtimeFactory,
  );
  const app = new Hono();
  app.use("*", bodyLimit({ maxSize: 16 * 1024 * 1024 }));
  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && new URL(origin).host !== c.req.header("host"))
      return c.json(
        { code: "origin", message: "Same-origin requests required" },
        403,
      );
    c.header("Cache-Control", "no-store");
    return next();
  });
  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      protocol: 1,
      credentials: !!(process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY),
    }),
  );
  app.get("/api/projects", async (c) => c.json(await store.list()));
  app.post("/api/projects", async (c) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(200),
        context: z.string().max(100000).default(""),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(await store.create(body.name, body.context), 201);
  });
  app.post("/api/projects/:project/sessions", async (c) => {
    const owner = await store.open(c.req.param("project"));
    const body = z
      .object({ role: z.enum(["editor", "audience"]).default("editor") })
      .strict()
      .parse(await c.req.json());
    return c.json(await owner.attach(body.role), 201);
  });
  const ownerAndSession = async (c: any, editor = false) => {
    const owner = await store.open(c.req.param("project"));
    const session = owner.authorize(
      c.req.header("X-Session-Id") ?? c.req.query("session"),
      c.req.header("X-Session-Token") ?? c.req.query("token"),
      editor,
    );
    return { owner, session };
  };
  app.get("/api/projects/:project/state", async (c) => {
    const { owner } = await ownerAndSession(c, true);
    return c.json(owner.snapshot());
  });
  app.delete("/api/projects/:project/sessions/:session", async (c) => {
    const { owner, session } = await ownerAndSession(c);
    if (session.dto.id !== c.req.param("session"))
      throw new ProductError("session", "Cannot close another attachment", 403);
    await owner.detach(session);
    return c.json({ closed: true });
  });
  app.get("/api/projects/:project/viewer", async (c) => {
    const { owner, session } = await ownerAndSession(c);
    return c.json(owner.bootstrap(session));
  });
  app.get("/api/projects/:project/navigation", async (c) => {
    const { owner } = await ownerAndSession(c, true);
    return c.json(await owner.navigationDeck());
  });
  app.post("/api/projects/:project/viewer/ack", async (c) => {
    const { session } = await ownerAndSession(c);
    const body = await c.req.json();
    await session.publication.acknowledge(body.acknowledgment, body.clock);
    return c.json({ recorded: true });
  });
  app.get("/api/projects/:project/events", async (c) => {
    const { owner, session } = await ownerAndSession(c);
    const last = c.req.header("last-event-id") ?? c.req.query("lastEventId");
    return streamSSE(c, async (stream) => {
      let end!: () => void;
      const done = new Promise<void>((r) => {
        end = r;
      });
      const unsubscribe = owner.subscribe(
        session,
        last ? Number(last) : undefined,
        (event) => {
          void stream
            .writeSSE({
              id: String(event.id),
              event: event.type,
              data: JSON.stringify(event.data),
            })
            .catch(end);
        },
      );
      const heartbeat = setInterval(() => {
        if (!owner.sessions.has(session.dto.id)) {
          end();
          return;
        }
        void stream
          .writeSSE({
            event: "heartbeat",
            data: JSON.stringify({ serverTimeMs: Date.now() }),
          })
          .catch(end);
      }, 10000);
      stream.onAbort(end);
      await done;
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
  app.post("/api/projects/:project/commands", async (c) => {
    const { owner, session } = await ownerAndSession(c, true);
    const result = await owner.command(commandSchema.parse(await c.req.json()));
    return c.json({ ...result, viewer: owner.bootstrap(session).message });
  });
  app.post("/api/projects/:project/input", async (c) => {
    const { owner, session } = await ownerAndSession(c, true);
    owner.authorizeCapture(session);
    return c.json(
      await owner.input(inputSchema.parse(await c.req.json()), session),
      202,
    );
  });
  app.post("/api/projects/:project/audio", async (c) => {
    const { owner, session } = await ownerAndSession(c, true);
    const input = z
      .object({
        id,
        epoch,
        slideId: id,
        startMs: z.number().nonnegative(),
        endMs: z.number().nonnegative(),
        sequence: z.number().int().nonnegative(),
      })
      .parse({
        id: c.req.header("X-Input-Id"),
        epoch: Number(c.req.header("X-Epoch")),
        slideId: c.req.header("X-Slide-Id"),
        startMs: Number(c.req.header("X-Start-Ms")),
        endMs: Number(c.req.header("X-End-Ms")),
        sequence: Number(c.req.header("X-Audio-Sequence")),
      });
    return c.json(
      await owner.audio(session, input, Buffer.from(await c.req.arrayBuffer())),
      202,
    );
  });
  app.get("/api/projects/:project/slides/:slide/image", async (c) => {
    const { owner } = await ownerAndSession(c, true);
    return new Response(
      new Uint8Array(
        await owner.image(c.req.param("slide"), c.req.query("revision")),
      ),
      {
        headers: {
          "content-type": "image/jpeg",
          "cache-control": "private,max-age=31536000,immutable",
        },
      },
    );
  });
  app.post("/api/projects/:project/materials", async (c) => {
    const { owner } = await ownerAndSession(c, true);
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      throw new ProductError("material", "Expected a file");
    return c.json(await owner.material(file), 201);
  });
  app.all("/api/projects/:project/practice/*", async (c) => {
    const { owner } = await ownerAndSession(c, true);
    const path = c.req.path.slice(c.req.path.indexOf("/practice"));
    if (!/^\/practice\/[^/]+(?:\/.*)?$/.test(path)) return c.notFound();
    const result = await owner.practiceCall(
      path,
      c.req.method,
      ["GET", "HEAD"].includes(c.req.method)
        ? undefined
        : await c.req.json().catch(() => undefined),
    );
    return c.json(result.data, result.status as any);
  });
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json(
        { code: "request", message: "Invalid request", issues: error.issues },
        400,
      );
    if (error instanceof ProductError)
      return c.json(
        { code: error.code, message: error.message },
        error.status as any,
      );
    return c.json({ code: "operation_failed", message: safeError(error) }, 500);
  });
  return { app, store, close: () => store.close() };
}
