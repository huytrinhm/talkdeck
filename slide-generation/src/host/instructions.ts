import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
/** Shared product/headless prompt configuration. Historical frozen prompts remain immutable. */
export async function loadGenerationInstructions() {
  // SPEC.md describes implementation responsibilities, not the model's role.
  // JsxBackend supplies role/tool contracts and the preloaded authoring skills.
  const instructions = await readFile(new URL("../../docs/AGENT_PROMPT.md", import.meta.url), "utf8");
  return {
    version: 2 as const,
    instructions,
    sha256: createHash("sha256").update(instructions).digest("hex"),
  };
}
