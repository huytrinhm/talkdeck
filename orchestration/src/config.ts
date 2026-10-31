import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
export function clientFromEnv(): OpenAI {
  const values: Record<string, string> = {};
  try {
    for (const line of readFileSync(
      fileURLToPath(new URL("../../.env", import.meta.url)),
      "utf8",
    ).split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([\w]+)\s*=\s*(.*?)\s*$/);
      if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch {
    /* Environment-only configuration is supported. */
  }
  const apiKey =
    process.env.OPENAI_API_KEY ??
    process.env.OPENAI_KEY ??
    values.OPENAI_API_KEY ??
    values.OPENAI_KEY;
  if (!apiKey)
    throw new Error(
      "Set OPENAI_API_KEY or OPENAI_KEY in the environment or root .env",
    );
  return new OpenAI({ apiKey, maxRetries: 0, timeout: 120_000 });
}
export const models = () => ({
  decision: process.env.DECISION_MODEL ?? "gpt-6-luna",
  fast: process.env.FAST_MODEL ?? "gpt-6-luna",
  slow: process.env.SLOW_MODEL ?? "gpt-6-sol",
  specialist: process.env.SPECIALIST_MODEL ?? "gpt-6-sol",
  transcription: process.env.TRANSCRIPTION_MODEL ?? "gpt-live-transcribe",
});
