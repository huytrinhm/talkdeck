import { OpenAI } from "../../slide-generation/src/practice/runtime.js";
import { appendFile } from "node:fs/promises";
import { ProviderBudget } from "../../slide-generation/src/headless/models.js";

export function safeError(error: unknown) {
  let text = error instanceof Error ? error.message : String(error);
  for (const value of [process.env.OPENAI_API_KEY, process.env.OPENAI_KEY])
    if (value) text = text.split(value).join("[redacted]");
  return text.replace(/\bsk-[A-Za-z0-9_*.-]{6,}/g, "[redacted]");
}
/** Shared accounting for actor, review and ASR calls. No provider fallback or retry. */
export class ProductProviders {
  readonly budget = new ProviderBudget({
    maxCalls: Number(process.env.TALKDECK_MAX_CALLS ?? 200),
    maxInputTokens: Number(process.env.TALKDECK_MAX_INPUT_TOKENS ?? 4000000),
    maxOutputTokens: Number(process.env.TALKDECK_MAX_OUTPUT_TOKENS ?? 250000),
    maxOutputTokensPerCall: 24000,
  });
  failures = 0;
  readonly client: OpenAI;
  private writes = Promise.resolve();
  private accountingFailure = false;
  constructor(
    private path: string,
    private changed: () => void,
  ) {
    const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY;
    if (!apiKey)
      throw new Error(
        "Set OPENAI_API_KEY or OPENAI_KEY before starting the backend",
      );
    this.client = new OpenAI({
      apiKey,
      maxRetries: 0,
      timeout: 180000,
      fetch: async (url, init) => {
        if (this.accountingFailure) throw new Error("Provider accounting failed; further paid requests are blocked");
        const endpoint = new URL(String(url)).pathname;
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        if (endpoint.endsWith("/responses") && body?.service_tier !== "fast")
          throw new Error("Responses requests must use Fast tier");
        if (endpoint.endsWith("/decisions") && body?.service_tier)
          throw new Error("Decisions does not support service_tier");
        const reservation = this.budget.reserve(
          typeof init?.body === "string"
            ? Buffer.byteLength(init.body) + 1024
            : 32768,
          body?.max_output_tokens ?? 24000,
        );
        const startedAt = new Date().toISOString();
        let usage: { input: number; output: number } | undefined;
        let record: Record<string, unknown> = {
          endpoint,
          startedAt,
          model: body?.model,
          requestedTier: endpoint.endsWith("/responses")
            ? "fast"
            : "endpoint-default",
          request: body,
        };
        try {
          const response = await fetch(url, init);
          const value = (await response
            .clone()
            .json()
            .catch(() => undefined)) as any;
          if (
            Number.isSafeInteger(value?.usage?.input_tokens) &&
            Number.isSafeInteger(value?.usage?.output_tokens)
          )
            usage = {
              input: value.usage.input_tokens,
              output: value.usage.output_tokens,
            };
          record = {
            ...record,
            status: response.status,
            returnedTier: value?.service_tier,
            usage: value?.usage,
            response: [401, 403].includes(response.status)
              ? {
                  error: "authentication_response_redacted",
                  status: response.status,
                }
              : value,
            requestId: response.headers.get("x-request-id"),
          };
          if (!response.ok) this.failures++;
          return response;
        } catch (error) {
          this.failures++;
          record.error = safeError(error);
          throw error;
        } finally {
          this.budget.settle(reservation, usage);
          this.record({
            ...record,
            endedAt: new Date().toISOString(),
            usageMissing: !usage,
          });
          this.changed();
        }
      },
    });
  }
  record(record: unknown) {
    this.writes = this.writes.then(() =>
      appendFile(this.path, safeError(JSON.stringify(record)) + "\n", {
        mode: 0o600,
      }),
    );
    this.writes.catch(() => {
      this.failures++;
      this.accountingFailure = true;
      this.changed();
    });
  }
  reserveTranscription() {
    if (this.accountingFailure) throw new Error("Provider accounting failed; further paid requests are blocked");
    return this.budget.reserve(32768, 4096);
  }
  finishTranscription(
    reservation: { input: number; output: number },
    error?: unknown,
  ) {
    this.budget.settle(reservation);
    if (error) this.failures++;
    this.record({
      endpoint: "realtime/transcription",
      requestedTier: "endpoint-default",
      usageMissing: true,
      error: error ? safeError(error) : undefined,
      endedAt: new Date().toISOString(),
    });
    this.changed();
  }
  snapshot() {
    const s = this.budget.snapshot();
    return {
      calls: s.calls,
      inputTokens: s.observedInputTokens,
      outputTokens: s.observedOutputTokens,
      failures: this.failures,
      maxCalls: s.limits.maxCalls,
      maxTokens: s.limits.maxInputTokens + s.limits.maxOutputTokens,
      unknownUsage: s.unknownUsageCalls,
    };
  }
  async close() {
    await this.writes;
  }
}
