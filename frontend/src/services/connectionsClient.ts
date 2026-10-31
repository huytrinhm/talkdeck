import { ApiKeyFailure, type PersonalApiKeyPort } from "./personalApiKey";
export interface ConnectionsCapabilities {
  version: 1;
  session: { ready: boolean; expiresAt?: number };
  phone: {
    available: boolean;
    transport: "webrtc";
    media: "raw-audio";
    network: "same-network";
    iceServers: [];
  };
  key: { available: boolean; configured: boolean; expiresAt?: number };
}
const codes = new Set([
  "service_unavailable",
  "origin_rejected",
  "session_required",
  "csrf_rejected",
  "invalid_request",
  "invalid_key_format",
  "not_found",
  "pairing_expired",
  "pairing_revoked",
  "pairing_claimed",
  "state_conflict",
  "rate_limited",
  "service_error",
  "key_required",
  "key_rejected",
  "key_forbidden",
  "provider_rate_limited",
  "provider_unavailable",
]);
const unavailable = (): ConnectionsCapabilities => ({
  version: 1,
  session: { ready: false },
  phone: {
    available: false,
    transport: "webrtc",
    media: "raw-audio",
    network: "same-network",
    iceServers: [],
  },
  key: { available: false, configured: false },
});
const object = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export class ConnectionsFailure extends Error {
  constructor(readonly code: string) {
    super("Connection service operation failed.");
  }
}
/** Actual same-origin v1 host contract. No provider key is retained in this client. */
export class ConnectionsClient {
  private fetcher: typeof fetch;
  private origin: string;
  private timeoutMs: number;
  private session?: { csrfToken: string; expiresAt: number };
  private opening?: Promise<void>;
  constructor(
    options: { fetch?: typeof fetch; origin?: string; timeoutMs?: number } = {},
  ) {
    this.fetcher = options.fetch ?? fetch.bind(globalThis);
    this.origin = options.origin ?? location.origin;
    this.timeoutMs = options.timeoutMs ?? 20000;
  }
  async capabilities(): Promise<ConnectionsCapabilities> {
    try {
      const value = await this.request("", { method: "GET" }, false);
      if (
        !object(value) ||
        value.version !== 1 ||
        !object(value.session) ||
        !object(value.phone) ||
        !object(value.key) ||
        typeof value.session.ready !== "boolean" ||
        typeof value.phone.available !== "boolean" ||
        typeof value.key.available !== "boolean" ||
        typeof value.key.configured !== "boolean" ||
        value.phone.media !== "raw-audio" ||
        value.phone.transport !== "webrtc" ||
        value.phone.network !== "same-network" ||
        !Array.isArray(value.phone.iceServers) ||
        value.phone.iceServers.length !== 0
      )
        return unavailable();
      return {
        version: 1,
        session: {
          ready: value.session.ready,
          expiresAt: value.session.expiresAt,
        },
        phone: { ...unavailable().phone, available: value.phone.available },
        key: {
          available: value.key.available,
          configured: value.key.configured,
          expiresAt: value.key.expiresAt,
        },
      };
    } catch {
      return unavailable();
    }
  }
  private async ensureSession() {
    if (this.session && this.session.expiresAt > Date.now() + 1000) return;
    if (this.opening) return this.opening;
    const pending = this.request(
      "/session",
      { method: "POST", body: JSON.stringify({}) },
      false,
    )
      .then((value) => {
        if (
          !object(value) ||
          typeof value.csrfToken !== "string" ||
          !value.csrfToken ||
          !Number.isFinite(value.expiresAt) ||
          value.expiresAt <= Date.now()
        )
          throw new ConnectionsFailure("service_error");
        this.session = {
          csrfToken: value.csrfToken,
          expiresAt: value.expiresAt,
        };
      })
      .finally(() => {
        if (this.opening === pending) this.opening = undefined;
      });
    this.opening = pending;
    return pending;
  }
  async request(
    path: string,
    options: RequestInit = {},
    session = true,
  ): Promise<unknown> {
    if (
      !/^\/(?:session|key(?:\/verify)?|pairings(?:\/[A-Za-z0-9_-]+(?:\/(?:claim|answer))?)?)$/.test(
        path,
      ) &&
      path !== ""
    )
      throw new ConnectionsFailure("invalid_request");
    if (session) await this.ensureSession();
    const method = options.method ?? "GET",
      headers = new Headers({ Accept: "application/json" });
    if (method !== "GET") {
      headers.set("Content-Type", "application/json");
      if (session && this.session)
        headers.set("X-CSRF-Token", this.session.csrfToken);
    }
    const abort = new AbortController();
    let timedOut = false;
    const cancel = () => abort.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
    const timer = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, this.timeoutMs);
    try {
      const response = await this.fetcher(
        new URL("/api/connections" + path, this.origin),
        {
          ...options,
          method,
          headers,
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
          signal: abort.signal,
        },
      );
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        throw new ConnectionsFailure("invalid_response");
      }
      if (!response.ok) {
        const code =
          object(value) &&
          object(value.error) &&
          typeof value.error.code === "string" &&
          codes.has(value.error.code)
            ? value.error.code
            : "service_error";
        if (code === "session_required") {
          this.session = undefined;
        }
        throw new ConnectionsFailure(code);
      }
      return value;
    } catch (error) {
      if (timedOut) throw new ConnectionsFailure("request_timeout");
      if (options.signal?.aborted)
        throw new ConnectionsFailure("request_aborted");
      throw error instanceof ConnectionsFailure
        ? error
        : new ConnectionsFailure("service_error");
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
    }
  }
  keyPort(available: boolean): PersonalApiKeyPort {
    const safe = async <T>(operation: () => Promise<T>): Promise<T> => {
      try {
        return await operation();
      } catch (error) {
        const code = error instanceof ConnectionsFailure ? error.code : "";
        throw new ApiKeyFailure(
          code === "invalid_key_format" || code === "key_rejected"
            ? "invalid-key"
            : code === "key_forbidden"
              ? "permission"
              : code === "provider_rate_limited" || code === "rate_limited"
                ? "rate-limited"
                : code === "key_required"
                  ? "key-required"
                  : code === "session_required" || code === "csrf_rejected"
                    ? "unauthenticated"
                    : code === "service_error" ||
                        code === "service_unavailable" ||
                        code === "provider_unavailable"
                      ? "network"
                      : "unknown",
        );
      }
    };
    return {
      available,
      verifiesKey: false,
      getStatus: () =>
        safe(async () => {
          const result = await this.request("/key");
          if (!object(result) || typeof result.configured !== "boolean")
            throw new ConnectionsFailure("service_error");
          return {
            configured: result.configured,
            expiresAt: result.expiresAt,
            validation:
              result.validation === "verified" ? "verified" : "not-checked",
          };
        }),
      save: (key) =>
        safe(async () => {
          const result = await this.request("/key", {
            method: "POST",
            body: JSON.stringify({ key }),
          });
          if (
            !object(result) ||
            result.configured !== true ||
            result.validation !== "not-checked"
          )
            throw new ConnectionsFailure("service_error");
          return {
            configured: true as const,
            expiresAt: result.expiresAt,
            validation: "not-checked" as const,
          };
        }),
      remove: () =>
        safe(async () => {
          const result = await this.request("/key", { method: "DELETE" });
          if (!object(result) || result.configured !== false)
            throw new ConnectionsFailure("service_error");
          return { configured: false as const };
        }),
      verify: () =>
        safe(async () => {
          const result = await this.request("/key/verify", {
            method: "POST",
            body: JSON.stringify({}),
          });
          if (
            !object(result) ||
            result.configured !== true ||
            result.validation !== "verified"
          )
            throw new ConnectionsFailure("service_error");
          return {
            configured: true as const,
            validation: "verified" as const,
            expiresAt: result.expiresAt,
          };
        }),
    };
  }
}
