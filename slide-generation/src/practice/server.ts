import { serve } from "@hono/node-server";
import OpenAI from "openai";
import { createPracticeRuntime } from "./runtime.js";
const key = process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY;
if (!key)
  throw new Error("Set OPENAI_API_KEY or OPENAI_KEY in the environment");
const port = Number(process.env.PRACTICE_PORT ?? 8876);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid PRACTICE_PORT");
const runtime = await createPracticeRuntime({
  directory: process.env.PRACTICE_DIRECTORY ?? ".artifacts/practice/default",
  client: new OpenAI({ apiKey: key, maxRetries: 0 }),
});
const server = serve({ fetch: runtime.app.fetch, hostname: "127.0.0.1", port });
console.log(`Practice review API: http://127.0.0.1:${port}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    server.close();
    void runtime.close().finally(() => process.exit());
  });
