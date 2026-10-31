import OpenAI from "openai";
/** Credentials are supplied by the process; this module never opens an environment file. */
export function clientFromEnv(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY;
  if (!apiKey) throw new Error("Set OPENAI_API_KEY or OPENAI_KEY in the process environment");
  return new OpenAI({ apiKey, maxRetries: 0, timeout: 120_000 });
}
export const models = () => ({
  decision: process.env.DECISION_MODEL ?? "gpt-6-luna",
  fast: process.env.FAST_MODEL ?? "gpt-6-luna",
  slow: process.env.SLOW_MODEL ?? "gpt-6-sol",
  specialist: process.env.SPECIALIST_MODEL ?? "gpt-6-sol",
  transcription: process.env.TRANSCRIPTION_MODEL ?? "gpt-live-transcribe",
});
