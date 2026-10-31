import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
test("HTTP lifecycle, screenshot, validation and SSE reconnect do not create duplicate sessions", async () => {
  const child = spawn(process.execPath, ["--import", "tsx", "src/orchestration/server.ts"], {
    cwd: new URL("../../", import.meta.url),
    env: {
      ...process.env,
      OPENAI_API_KEY: "test-key-no-model-requests",
      PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let timer: ReturnType<typeof setTimeout>;
  const address = await new Promise<string>((resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("Server startup timeout")),
      10000,
    );
    child.stdout.on("data", (chunk) => {
      const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) resolve(match[0]);
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Server exited ${code}`)));
  }).finally(() => clearTimeout(timer));
  try {
    const create = await fetch(address + "/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: "Local API test; no narration" }),
    });
    assert.equal(create.status, 201);
    const { id, selectedSlideId: firstSlide } = (await create.json()) as {
      id: string;
      selectedSlideId: string;
    };
    const base = address + "/sessions/" + id;
    const png = await fetch(base + "/screenshot");
    assert.equal(png.headers.get("content-type"), "image/png");
    assert((await png.arrayBuffer()).byteLength > 1000);
    const post = async (path: string, input: unknown = {}) =>
      fetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    const initialHistory = (await (await fetch(base + "/history")).json()) as {
      canUndo: boolean;
      canRedo: boolean;
    };
    assert.deepEqual(initialHistory, {
      canUndo: false,
      canRedo: false,
      undoDepth: 0,
      redoDepth: 0,
    });
    assert.equal(
      ((await (await post("/undo")).json()) as { outcome: string }).outcome,
      "unchanged",
    );
    assert.equal((await post("/pause")).status, 200);
    const next = (await (await post("/next")).json()) as {
      selectedSlideId: string;
    };
    assert.notEqual(next.selectedSlideId, firstSlide);
    const state = (await (await fetch(base)).json()) as {
      paused: boolean;
      deck: { slides: unknown[] };
    };
    assert.equal(state.paused, true);
    assert.equal(state.deck.slides.length, 2);
    assert.equal((await post("/select", { slideId: firstSlide })).status, 200);
    const source = (await (
      await fetch(base + `/slides/${firstSlide}`)
    ).json()) as { source: string; observationId: string };
    const split = (await (
      await post("/split", {
        slideId: firstSlide,
        observationId: source.observationId,
        parts: [
          {
            title: "Part one",
            source: source.source.replace("Your talk", "Part one"),
          },
          {
            title: "Part two",
            source: source.source.replace("Your talk", "Part two"),
          },
        ],
      })
    ).json()) as { outcome: string; slideIds: string[] };
    assert.equal(split.outcome, "published");
    assert.equal(split.slideIds[0], firstSlide);
    const splitSources = await Promise.all(
      split.slideIds.map(
        async (sid) =>
          (await (await fetch(base + `/slides/${sid}`)).json()) as {
            observationId: string;
          },
      ),
    );
    assert.equal(
      (await fetch(base + `/slides/${split.slideIds[1]}/screenshot`)).status,
      200,
    );
    const merged = (await (
      await post("/merge", {
        slideIds: split.slideIds,
        observationIds: splitSources.map((s) => s.observationId),
        merged: { title: "Merged", source: source.source },
      })
    ).json()) as { outcome: string };
    assert.equal(merged.outcome, "published");
    const undone = (await (await post("/undo")).json()) as {
      outcome: string;
      deck: { slides: unknown[] };
      history: { canRedo: boolean };
    };
    assert.equal(undone.outcome, "restored");
    assert.equal(undone.deck.slides.length, 3);
    assert.equal(undone.history.canRedo, true);
    assert.equal(
      (await fetch(base + `/slides/${split.slideIds[1]}/screenshot`)).status,
      200,
    );
    const redone = (await (await post("/redo")).json()) as {
      deck: { slides: unknown[] };
    };
    assert.equal(redone.deck.slides.length, 2);
    assert.equal((await post("/push-to-edit", { prompt: "  " })).status, 400);
    assert.equal(
      (
        await post("/push-to-edit", {
          prompt: "Change title",
          slideId: "missing",
        })
      ).status,
      400,
    );
    const comment = await post("/push-to-edit", {
      prompt: "Change title",
      slideId: firstSlide,
    });
    assert.equal(comment.status, 202);
    assert.equal(
      ((await comment.json()) as { slideId: string }).slideId,
      firstSlide,
    );
    // Still paused: history cancels the queued comment, so no paid model request occurs.
    await post("/undo");
    await post("/redo");
    const restored = (await (await fetch(base)).json()) as {
      paused: boolean;
      history: { canUndo: boolean };
    };
    assert.equal(restored.paused, true);
    assert.equal(restored.history.canUndo, true);

    assert.equal(
      (await post("/transcript", { text: "", revision: 1 })).status,
      400,
    );
    assert.equal((await post("/resume")).status, 200);
    const bad = await fetch(base + "/transcript", {
      method: "POST",
      body: JSON.stringify({ text: "", revision: 0, slideId: firstSlide }),
    });
    assert.equal(bad.status, 400);
    const empty = await fetch(base + "/transcript", {
      method: "POST",
      body: JSON.stringify({ text: "", revision: 1, slideId: firstSlide }),
    });
    assert.equal(empty.status, 202);
    const controller = new AbortController();
    const events = await fetch(base + "/events", {
      headers: { "Last-Event-ID": "0" },
      signal: controller.signal,
    });
    assert.equal(events.status, 200);
    assert.equal(events.headers.get("content-type"), "text/event-stream");
    const eventChunk = await events.body!.getReader().read();
    assert(new TextDecoder().decode(eventChunk.value).includes("id: 1"));
    controller.abort();
    const reconnect = new AbortController();
    const resumed = await fetch(base + "/events", {
      headers: { "Last-Event-ID": "1" },
      signal: reconnect.signal,
    });
    assert.equal(resumed.status, 200);
    reconnect.abort();
    const health = (await (await fetch(address + "/health")).json()) as {
      sessions: number;
    };
    assert.equal(health.sessions, 1);
    assert.equal((await fetch(base, { method: "DELETE" })).status, 200);
    assert.equal((await fetch(base)).status, 404);
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
});
