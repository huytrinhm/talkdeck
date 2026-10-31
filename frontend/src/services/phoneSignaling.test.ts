import { expect, it, vi, afterEach } from "vitest";
import { ConnectionsClient } from "./connectionsClient";
import { createPhoneSignaling, parsePairingCode } from "./phoneSignaling";
afterEach(() => vi.useRealTimers());
const id = "A".repeat(22),
  code = id + "." + "B".repeat(43),
  origin = "https://talkdeck.test";
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function fixture() {
  const seen: { path: string; init: RequestInit }[] = [];
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    seen.push({ path, init: init ?? {} });
    const expiresAt = Date.now() + 600000,
      sessionExpiresAt = Date.now() + 3600000;
    if (path.endsWith("/session"))
      return json({ csrfToken: "fixture-csrf", expiresAt: sessionExpiresAt });
    if (path.endsWith("/claim"))
      return json({
        offer: { type: "offer", sdp: "raw-offer" },
        expiresAt,
        sessionExpiresAt,
      });
    if (path.endsWith("/answer")) return json({ state: "answered", expiresAt });
    if (init?.method === "DELETE") return json({ revoked: true });
    if (path.endsWith("/pairings"))
      return json({
        pairingId: id,
        code,
        qrUrl: origin + "/client/#phone?pair=" + code,
        expiresAt,
        sessionExpiresAt,
      });
    return json({
      state: "answered",
      answer: { type: "answer", sdp: "raw-answer" },
      expiresAt,
      sessionExpiresAt,
    });
  });
  const client = new ConnectionsClient({ origin, fetch: fetcher });
  return { seen, fetcher, port: createPhoneSignaling(client, true, origin) };
}
it("binds strict code identity, same-origin service QR and actual raw SDP through the host endpoints", async () => {
  const f = fixture();
  const offer = await f.port.createOffer({ type: "offer", sdp: "raw-offer" });
  expect(offer.sessionId).toBe(id);
  expect(offer.qrUrl).toBe(origin + "/client/#phone?pair=" + code);
  const claim = await f.port.claim(code);
  expect(claim.offer.sdp).toBe("raw-offer");
  expect(f.seen.find((x) => x.path.endsWith("/claim"))?.path).toBe(
    "/api/connections/pairings/" + id + "/claim",
  );
  expect(f.seen.every((x) => !x.path.includes("B".repeat(43)))).toBe(true);
  await f.port.answer(id, { type: "answer", sdp: "raw-answer" });
  expect(await f.port.waitForAnswer(id, new AbortController().signal)).toEqual({
    type: "answer",
    sdp: "raw-answer",
  });
  await f.port.revoke(id);
});
it("rejects malformed codes without making a request and refuses QR redirects to another origin", async () => {
  const f = fixture();
  expect(() => parsePairingCode("bad.code.extra")).toThrow();
  await expect(f.port.claim("bad")).rejects.toThrow();
  expect(f.seen).toHaveLength(0);
  await f.port.createOffer({ type: "offer", sdp: "raw-offer" });
  f.fetcher.mockImplementation(async () =>
    json({
      pairingId: id,
      code,
      qrUrl: "https://outside.test/#phone?pair=" + code,
      expiresAt: Date.now() + 60000,
      sessionExpiresAt: Date.now() + 60000,
    }),
  );
  await expect(
    f.port.createOffer({ type: "offer", sdp: "raw-offer" }),
  ).rejects.toThrow();
});
it("aborts answer polling without another request and keeps server failures controlled", async () => {
  const f = fixture();
  const abort = new AbortController();
  abort.abort();
  await expect(f.port.waitForAnswer(id, abort.signal)).rejects.toThrow();
  expect(f.seen).toHaveLength(0);
  f.fetcher.mockImplementation(async () =>
    json({ error: { code: "pairing_expired", message: "must-not-echo" } }, 410),
  );
  await expect(f.port.claim(code)).rejects.toThrow(
    "Pairing expired. Create a new connection.",
  );
});
