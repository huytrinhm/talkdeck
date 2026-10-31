import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
/** Shared product/headless prompt configuration. Historical frozen prompts remain immutable. */
export async function loadGenerationInstructions() {
  const [prompt, specification] = await Promise.all([
    readFile(new URL("../../docs/AGENT_PROMPT.md", import.meta.url), "utf8"),
    readFile(new URL("../../SPEC.md", import.meta.url), "utf8"),
  ]);
  const instructions = `${prompt}\n\n${specification}`;
  return {
    version: 1 as const,
    instructions,
    sha256: createHash("sha256").update(instructions).digest("hex"),
  };
}
