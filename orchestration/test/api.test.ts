import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
test("HTTP lifecycle, screenshot, validation and SSE reconnect do not create duplicate sessions", async () => {
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: new URL("../", import.meta.url),
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
    const { id } = (await create.json()) as { id: string };
    const base = address + "/sessions/" + id;
    const png = await fetch(base + "/screenshot");
    assert.equal(png.headers.get("content-type"), "image/png");
    assert((await png.arrayBuffer()).byteLength > 1000);
    const bad = await fetch(base + "/transcript", {
      method: "POST",
      body: JSON.stringify({ text: "", revision: 0 }),
    });
    assert.equal(bad.status, 400);
    const empty = await fetch(base + "/transcript", {
      method: "POST",
      body: JSON.stringify({ text: "", revision: 1 }),
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
