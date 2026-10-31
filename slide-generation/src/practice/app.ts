import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { SourceError } from "../contracts.js";
import { PracticeService } from "./service.js";
import type { SlideRuntime } from "../orchestration/runtime.js";
import type { JsxBackend } from "../host/jsx-backend.js";

const brief = z.record(
  z.string(),
  z.union([z.string().max(10_000), z.number().finite()]),
);
export function createPracticeApp(
  service: PracticeService,
  actors: SlideRuntime,
  backend: JsxBackend,
) {
  const app = new Hono();
  app.use("*", bodyLimit({ maxSize: 12 * 1024 * 1024 }));
  app.get("/health", (c) =>
    c.json({
      status: "ok",
      practiceMode: actors.practiceMode,
      paused: actors.paused,
    }),
  );
  app.get("/deck", (c) =>
    c.json({
      source: backend.runtime.engine.readDocument().source,
      selectedId: backend.selectedId,
      history: backend.historyStatus(),
    }),
  );
  app.get("/practice", (c) => c.json(service.list()));
  app.post("/practice", async (c) => {
    const input = z
      .object({
        brief: brief.default({}),
        input: z.enum(["audio", "transcript"]).default("transcript"),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(await service.start(input.brief, input.input), 201);
  });
  app.get("/practice/:id", (c) => c.json(service.get(c.req.param("id"))));
  app.post("/practice/:id/speech", async (c) => {
    const span = z
      .object({
        id: z.string().min(1).max(256),
        startMs: z.number().nonnegative(),
        endMs: z.number().nonnegative(),
        text: z.string().max(100_000),
        correctionOf: z.string().optional(),
        slideId: z.string().optional(),
        timing: z.enum(["aligned", "receipt"]).default("aligned"),
      })
      .strict()
      .parse(await c.req.json());
    await service.addSpeech(c.req.param("id"), span);
    return c.json({ retained: true }, 202);
  });
  app.post("/practice/:id/audio", async (c) => {
    const seq = c.req.header("X-Audio-Sequence"),
      start = c.req.header("X-Start-Ms");
    if (seq === undefined || start === undefined)
      throw new SourceError(
        "request",
        "X-Audio-Sequence and session-relative X-Start-Ms are required",
      );
    return c.json(
      await service.addAudio(
        c.req.param("id"),
        Number(seq),
        Number(start),
        Buffer.from(await c.req.arrayBuffer()),
      ),
      202,
    );
  });
  app.get("/practice/:id/audio/:sequence", async (c) => {
    const bytes = await service.audio(
      c.req.param("id"),
      Number(c.req.param("sequence")),
    );
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": "audio/wav" },
    });
  });
  app.post("/practice/:id/pause", async (c) => {
    await service.recordingPause(c.req.param("id"), true);
    return c.json({ paused: true });
  });
  app.post("/practice/:id/resume", async (c) => {
    await service.recordingPause(c.req.param("id"), false);
    return c.json({ paused: false });
  });
  app.post("/practice/:id/finish", async (c) =>
    c.json(await service.finish(c.req.param("id")), 202),
  );
  app.post("/practice/:id/retry", async (c) =>
    c.json(await service.retry(c.req.param("id")), 202),
  );
  app.post("/practice/:id/cancel", async (c) =>
    c.json(await service.cancel(c.req.param("id"))),
  );
  app.post("/practice/:id/proposals/:proposal/accept", async (c) => {
    const { version } = z
      .object({ version: z.number().int().positive() })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await service.accept(c.req.param("id"), c.req.param("proposal"), version),
    );
  });
  app.post("/practice/:id/proposals/:proposal/reject", async (c) =>
    c.json(await service.reject(c.req.param("id"), c.req.param("proposal"))),
  );
  app.post("/practice/:id/proposals/:proposal/refresh", async (c) =>
    c.json(await service.refresh(c.req.param("id"), c.req.param("proposal"))),
  );
  app.post("/practice/:id/proposals/:proposal/revise", async (c) => {
    const { prompt } = z
      .object({ prompt: z.string().trim().min(1).max(100_000) })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await service.revise(c.req.param("id"), c.req.param("proposal"), prompt),
      202,
    );
  });
  app.post("/controls/select", async (c) => {
    const { slideId } = z
      .object({ slideId: z.string().min(1) })
      .strict()
      .parse(await c.req.json());
    return c.json(await actors.selectSlide(slideId));
  });
  app.post("/controls/next", async (c) => c.json(await actors.nextSlide()));
  app.post("/controls/push-to-edit", async (c) => {
    const input = z
      .object({
        prompt: z.string().trim().min(1),
        slideId: z.string().optional(),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(actors.pushToEdit(input.prompt, input.slideId), 202);
  });
  app.post("/controls/undo", async (c) => c.json(await actors.undo()));
  app.post("/controls/redo", async (c) => c.json(await actors.redo()));
  app.post("/controls/pause", (c) => {
    actors.pause();
    return c.json({ paused: true });
  });
  app.post("/controls/resume", (c) => {
    actors.resume();
    return c.json({ paused: false });
  });
  app.post("/controls/build", async (c) => {
    await service.leavePractice();
    return c.json({ practiceMode: false });
  });
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json({ code: "request", issues: error.issues }, 400);
    if (error instanceof SourceError)
      return c.json(
        { code: error.code, message: error.message },
        error.code.startsWith("missing_") ? 404 : 409,
      );
    return c.json({ code: "operation_failed", message: String(error) }, 500);
  });
  return app;
}
