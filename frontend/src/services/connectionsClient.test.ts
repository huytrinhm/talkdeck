import { expect, it, vi } from "vitest";
import { ConnectionsClient } from "./connectionsClient";
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function fixture() {
  const calls: { url: string; options: RequestInit }[] = [];
  const fetcher = vi.fn(
    async (url: RequestInfo | URL, options?: RequestInit) => {
      calls.push({ url: String(url), options: options ?? {} });
      if (String(url).endsWith("/session"))
        return response({
          csrfToken: "csrf-fixture",
          expiresAt: Date.now() + 3600000,
        });
      if (options?.method === "POST")
        return response({
          configured: true,
          expiresAt: Date.now() + 3600000,
          validation: "not-checked",
        });
      if (options?.method === "DELETE") return response({ configured: false });
      return response({ configured: false });
    },
  );
  const client = new ConnectionsClient({
    fetch: fetcher,
    origin: "https://talkdeck.test",
  });
  return { client, calls, fetcher };
}
it("uses an anonymous session/CSRF and same-origin cookies without exposing a secret in a URL or status", async () => {
  const { client, calls } = fixture();
  const port = client.keyPort(true);
  await port.getStatus();
  const saved = await port.save("fixture-value-not-a-real-credential");
  expect(saved).toMatchObject({ configured: true, validation: "not-checked" });
  expect(calls.filter((c) => c.url.endsWith("/session"))).toHaveLength(1);
  const request = calls.find(
    (c) => c.options.method === "POST" && c.url.endsWith("/key"),
  )!;
  expect(request.url).not.toContain("fixture-value");
  expect(request.options).toMatchObject({
    credentials: "same-origin",
    cache: "no-store",
  });
  expect(new Headers(request.options.headers).get("X-CSRF-Token")).toBe(
    "csrf-fixture",
  );
  expect(JSON.parse(String(request.options.body))).toEqual({
    key: "fixture-value-not-a-real-credential",
  });
  expect(JSON.stringify(saved)).not.toContain("fixture-value");
});
it("does not call saved key storage provider verification and requires actual removal acknowledgement", async () => {
  const { client, calls, fetcher } = fixture();
  expect(client.keyPort(true).verifiesKey).toBe(false);
  await client.keyPort(true).remove();
  expect(
    calls.every((c) =>
      c.url.startsWith("https://talkdeck.test/api/connections"),
    ),
  ).toBe(true);
  fetcher.mockImplementation(async () => response({ configured: true }));
  await expect(client.keyPort(true).remove()).rejects.toThrow();
});
it("uses safe error codes and never echoes server/provider payloads or retries a secret mutation", async () => {
  const { client, fetcher, calls } = fixture();
  await client.keyPort(true).getStatus();
  fetcher.mockImplementation(async () =>
    response(
      { error: { code: "invalid_key_format", message: "secret-payload" } },
      400,
    ),
  );
  fetcher.mockClear();
  await expect(client.keyPort(true).save("fixture")).rejects.toMatchObject({
    code: "invalid-key",
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("keeps capabilities unavailable on missing/malformed services and refuses external ICE servers", async () => {
  const { client, fetcher } = fixture();
  fetcher.mockImplementation(async () =>
    response({
      version: 1,
      session: { ready: false },
      phone: {
        available: true,
        transport: "webrtc",
        media: "raw-audio",
        network: "same-network",
        iceServers: [{ urls: "stun:external.test" }],
      },
      key: { available: true, configured: false },
    }),
  );
  expect((await client.capabilities()).phone.available).toBe(false);
  fetcher.mockImplementation(
    async () => new Response("<html>local fallback</html>"),
  );
  expect((await client.capabilities()).key.available).toBe(false);
});
it("bounds fetch and body stalls and reports a timed-out mutation as outcome unknown", async () => {
  vi.useFakeTimers();
  try {
    for (const phase of ["fetch", "body"]) {
      let aborted = false;
      const fetcher = vi.fn(
        async (url: RequestInfo | URL, init?: RequestInit) => {
          if (String(url).endsWith("/session"))
            return response({
              csrfToken: "fixture-csrf",
              expiresAt: Date.now() + 3600000,
            });
          if (phase === "fetch")
            return new Promise<Response>((_, reject) =>
              init!.signal!.addEventListener(
                "abort",
                () => {
                  aborted = true;
                  reject(new DOMException("timeout", "AbortError"));
                },
                { once: true },
              ),
            );
          return new Response(
            new ReadableStream({
              start(controller) {
                init!.signal!.addEventListener(
                  "abort",
                  () => {
                    aborted = true;
                    controller.error(new DOMException("timeout", "AbortError"));
                  },
                  { once: true },
                );
              },
            }),
          );
        },
      );
      const client = new ConnectionsClient({
        fetch: fetcher,
        origin: "https://talkdeck.test",
        timeoutMs: 20,
      });
      const pending = client
        .keyPort(true)
        .save("fixture")
        .catch((error) => error);
      await vi.advanceTimersByTimeAsync(21);
      expect(aborted).toBe(true);
      expect(await pending).toMatchObject({ code: "unknown" });
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  } finally {
    vi.useRealTimers();
  }
});
