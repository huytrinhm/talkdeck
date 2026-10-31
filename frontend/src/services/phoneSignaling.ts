import { ConnectionsClient, ConnectionsFailure } from "./connectionsClient";
import { PhoneSignalingFailure, type PhoneSignalingPort } from "./phonePeer";
const record = (v: unknown): v is Record<string, any> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);
const idPattern = /^[A-Za-z0-9_-]{22}$/;
export function parsePairingCode(code: string) {
  const parts = code.trim().split(".");
  if (
    parts.length !== 2 ||
    !idPattern.test(parts[0]) ||
    !/^[A-Za-z0-9_-]{43}$/.test(parts[1])
  )
    throw new Error("Check the pairing code and try again.");
  return { pairingId: parts[0], code: parts.join(".") };
}
const description = (
  value: unknown,
  type: "offer" | "answer",
): RTCSessionDescriptionInit => {
  if (
    !record(value) ||
    value.type !== type ||
    typeof value.sdp !== "string" ||
    !value.sdp ||
    value.sdp.length > 65536
  )
    throw new ConnectionsFailure("service_error");
  return { type, sdp: value.sdp };
};
const deadline = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= Date.now())
    throw new ConnectionsFailure("pairing_expired");
  return v;
};
const messages: Record<string, string> = {
  pairing_expired: "Pairing expired. Create a new connection.",
  pairing_revoked: "Pairing was disconnected. Pair again.",
  pairing_claimed: "This connection is already in use. Pair again.",
  rate_limited: "Too many attempts. Wait, then retry.",
  session_required: "Session expired. Pair again.",
  service_unavailable: "Phone connections are unavailable.",
  service_error: "Phone could not connect. Retry.",
};
export function createPhoneSignaling(
  client: ConnectionsClient,
  available: boolean,
  origin = location.origin,
): PhoneSignalingPort {
  const safe = async <T>(operation: () => Promise<T>) => {
    try {
      return await operation();
    } catch (error) {
      throw new PhoneSignalingFailure(
        error instanceof ConnectionsFailure
          ? (messages[error.code] ?? "Phone could not connect. Retry.")
          : "Check the pairing code and try again.",
      );
    }
  };
  return {
    available,
    createOffer: (offer) =>
      safe(async () => {
        const value = await client.request("/pairings", {
          method: "POST",
          body: JSON.stringify({ offer }),
        });
        if (
          !record(value) ||
          typeof value.pairingId !== "string" ||
          !idPattern.test(value.pairingId) ||
          typeof value.code !== "string" ||
          parsePairingCode(value.code).pairingId !== value.pairingId ||
          typeof value.qrUrl !== "string"
        )
          throw new ConnectionsFailure("service_error");
        const url = new URL(value.qrUrl, origin);
        if (
          url.origin !== origin ||
          url.username ||
          url.password ||
          url.search ||
          new URLSearchParams(url.hash.split("?")[1] ?? "").get("pair") !==
            value.code ||
          !url.hash.startsWith("#phone?")
        )
          throw new ConnectionsFailure("service_error");
        return {
          sessionId: value.pairingId,
          code: value.code,
          qrUrl: url.href,
          expiresAt: deadline(value.expiresAt),
          sessionExpiresAt: deadline(value.sessionExpiresAt),
        };
      }),
    claim: (code) =>
      safe(async () => {
        const parsed = parsePairingCode(code);
        const value = await client.request(
          `/pairings/${parsed.pairingId}/claim`,
          { method: "POST", body: JSON.stringify({ code: parsed.code }) },
        );
        if (!record(value)) throw new ConnectionsFailure("service_error");
        deadline(value.expiresAt);
        return {
          sessionId: parsed.pairingId,
          peerName: `Desktop · ${parsed.pairingId.slice(-4)}`,
          offer: description(value.offer, "offer"),
          sessionExpiresAt: deadline(value.sessionExpiresAt),
        };
      }),
    answer: (id, answer) =>
      safe(async () => {
        if (!idPattern.test(id))
          throw new ConnectionsFailure("invalid_request");
        const value = await client.request(`/pairings/${id}/answer`, {
          method: "POST",
          body: JSON.stringify({ answer }),
        });
        if (!record(value) || value.state !== "answered")
          throw new ConnectionsFailure("service_error");
      }),
    waitForAnswer: (id, signal) =>
      safe(async () => {
        if (!idPattern.test(id))
          throw new ConnectionsFailure("invalid_request");
        for (;;) {
          if (signal.aborted) throw new DOMException("Stopped", "AbortError");
          const value = await client.request(`/pairings/${id}`, { signal });
          if (!record(value)) throw new ConnectionsFailure("service_error");
          deadline(value.expiresAt);
          deadline(value.sessionExpiresAt);
          if (value.state === "answered")
            return description(value.answer, "answer");
          if (!["offered", "claimed"].includes(value.state))
            throw new ConnectionsFailure("service_error");
          await new Promise<void>((resolve, reject) => {
            const done = () => {
              signal.removeEventListener("abort", stop);
              resolve();
            };
            const timer = setTimeout(done, 1000);
            const stop = () => {
              clearTimeout(timer);
              signal.removeEventListener("abort", stop);
              reject(new DOMException("Stopped", "AbortError"));
            };
            signal.addEventListener("abort", stop, { once: true });
            if (signal.aborted) stop();
          });
        }
      }),
    revoke: (id) =>
      safe(async () => {
        if (!idPattern.test(id))
          throw new ConnectionsFailure("invalid_request");
        const value = await client.request(`/pairings/${id}`, {
          method: "DELETE",
        });
        if (!record(value) || value.revoked !== true)
          throw new ConnectionsFailure("service_error");
      }),
  };
}
