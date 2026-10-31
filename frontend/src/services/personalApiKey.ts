export type ApiKeyErrorCode =
  | "invalid-key"
  | "unauthenticated"
  | "network"
  | "unknown"
  | "permission"
  | "rate-limited"
  | "key-required";
export class ApiKeyFailure extends Error {
  constructor(readonly code: ApiKeyErrorCode) {
    super("Personal API key operation failed.");
  }
}
/** Internal frontend boundary only. A real implementation requires approved authenticated
 * per-user server handling. Never call OpenAI directly from browser code or persist keys here. */
export interface PersonalApiKeyPort {
  available: boolean;
  verifiesKey?: boolean;
  verify?(): Promise<{
    configured: true;
    validation: "verified";
    expiresAt?: number;
  }>;
  getStatus(): Promise<{
    configured: boolean;
    validation?: "not-checked" | "verified";
    expiresAt?: number;
  }>;
  save(key: string): Promise<{
    configured: true;
    validation?: "not-checked" | "verified";
    expiresAt?: number;
  }>;
  remove(): Promise<{ configured: false }>;
}
export interface ApiKeySnapshot {
  available: boolean;
  mode: "unavailable" | "service";
  configured: boolean;
  needsReconciliation: boolean;
  canVerify: boolean;
  verifiesOnSave: boolean;
  validation: "not-checked" | "verified";
  expiresAt?: number;
  phase:
    | "unavailable"
    | "loading"
    | "idle"
    | "saving"
    | "removing"
    | "verifying"
    | "error";
  error?: ApiKeyErrorCode;
}
export class PersonalApiKeyController {
  private state: ApiKeySnapshot = {
    available: false,
    mode: "unavailable",
    configured: false,
    needsReconciliation: false,
    canVerify: false,
    verifiesOnSave: false,
    validation: "not-checked",
    phase: "unavailable",
  };
  private port?: PersonalApiKeyPort;
  private expiry?: ReturnType<typeof setTimeout>;
  private status(result: {
    configured: boolean;
    validation?: "not-checked" | "verified";
    expiresAt?: number;
  }) {
    clearTimeout(this.expiry);
    this.expiry = undefined;
    const expiresAt =
      result.configured &&
      typeof result.expiresAt === "number" &&
      Number.isFinite(result.expiresAt)
        ? result.expiresAt
        : undefined;
    this.update({
      configured: result.configured,
      validation:
        result.configured && result.validation === "verified"
          ? "verified"
          : "not-checked",
      expiresAt,
      phase: "idle",
      needsReconciliation: false,
    });
    if (expiresAt)
      this.expiry = setTimeout(
        () => {
          if (this.state.expiresAt !== expiresAt) return;
          const pending =
            ["loading", "saving", "removing", "verifying"].includes(
              this.state.phase,
            ) || this.state.needsReconciliation;
          this.update({
            configured: false,
            validation: "not-checked",
            expiresAt: undefined,
            ...(pending ? {} : { phase: "idle" as const }),
          });
        },
        Math.max(0, expiresAt - Date.now()),
      );
  }
  private epoch = 0;
  private listeners = new Set<() => void>();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<ApiKeySnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  async configure(port: PersonalApiKeyPort) {
    ++this.epoch;
    clearTimeout(this.expiry);
    this.port = port;
    this.update({
      available: port.available,
      mode: port.available ? "service" : "unavailable",
      phase: port.available ? "loading" : "unavailable",
      configured: false,
      canVerify: typeof port.verify === "function",
      verifiesOnSave: port.verifiesKey === true,
      validation: "not-checked",
      expiresAt: undefined,
      error: undefined,
    });
    if (port.available) await this.refresh();
  }
  private failure(error: unknown, mutation = false) {
    const code = error instanceof ApiKeyFailure ? error.code : "unknown";
    const uncertain = mutation && (code === "unknown" || code === "network");
    this.update({
      phase: "error",
      error: uncertain ? "unknown" : code,
      needsReconciliation: this.state.needsReconciliation || uncertain,
    });
  }
  async refresh() {
    if (!this.port?.available) return;
    const epoch = ++this.epoch;
    this.update({ phase: "loading", error: undefined });
    try {
      const result = await this.port.getStatus();
      if (epoch === this.epoch) this.status(result);
    } catch (error) {
      if (epoch === this.epoch) this.failure(error);
    }
  }
  async save(key: string) {
    if (
      !this.port?.available ||
      this.state.needsReconciliation ||
      ["saving", "removing", "loading", "verifying"].includes(this.state.phase)
    )
      return;
    const epoch = ++this.epoch;
    this.update({
      phase: "saving",
      error: undefined,
      validation: "not-checked",
    });
    try {
      const result = await this.port.save(key);
      if (epoch === this.epoch) {
        if (result.configured !== true) throw new ApiKeyFailure("invalid-key");
        this.status(result);
      }
    } catch (error) {
      if (epoch === this.epoch) this.failure(error, true);
    }
  }
  async verify() {
    if (
      !this.port?.verify ||
      this.state.needsReconciliation ||
      !this.state.configured ||
      ["saving", "removing", "loading", "verifying"].includes(this.state.phase)
    )
      return;
    const epoch = ++this.epoch;
    this.update({
      phase: "verifying",
      validation: "not-checked",
      error: undefined,
    });
    try {
      const result = await this.port.verify();
      if (epoch === this.epoch) {
        if (result.configured !== true || result.validation !== "verified")
          throw new ApiKeyFailure("unknown");
        this.status(result);
      }
    } catch (error) {
      if (epoch === this.epoch) this.failure(error, true);
    }
  }
  async remove() {
    if (
      !this.port?.available ||
      this.state.needsReconciliation ||
      ["saving", "removing", "loading", "verifying"].includes(this.state.phase)
    )
      return;
    const epoch = ++this.epoch;
    this.update({ phase: "removing", error: undefined });
    try {
      const result = await this.port.remove();
      if (epoch === this.epoch) {
        if (result.configured !== false) throw new ApiKeyFailure("unknown");
        this.status(result);
      }
    } catch (error) {
      if (epoch === this.epoch) this.failure(error, true);
    }
  }
}
export const personalApiKey = new PersonalApiKeyController();
