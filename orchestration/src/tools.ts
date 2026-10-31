import { z } from "zod";
import type { FunctionTool } from "openai/resources/responses/responses";
import type { Role } from "./types.js";
const schemas = {
  view_slide: z.object({}),
  edit: z.object({ old: z.string().min(1), new: z.string() }),
  delegate: z.object({ task: z.string().min(1), facts: z.string() }),
  send_message: z.object({ recipient: z.string(), text: z.string() }),
  followup_task: z.object({
    recipient: z.string(),
    task: z.string().min(1),
    facts: z.string(),
  }),
  wait_for: z.object({ recipients: z.array(z.string()).min(1) }),
  save_artifact: z.object({
    mediaType: z.enum(["image/svg+xml", "text/html", "text/css", "text/plain"]),
    content: z.string().min(1),
  }),
  image_generate: z.object({ prompt: z.string().min(1) }),
};
export type ToolName = keyof typeof schemas;
const descriptions: Record<ToolName, string> = {
  view_slide:
    "Return actual current source, screenshot, geometry and diagnostics.",
  edit: "Exact-match replace in the source this inference observed; publish through validation. Empty new deletes. Failure leaves displayed state unchanged.",
  delegate:
    "Start a focused private specialist task. Returns a specialist ID immediately. Only Slow integrates results. At most two active specialists.",
  send_message:
    "Queue information to an existing agent; does not wake an idle recipient.",
  followup_task:
    "Request work from an existing agent; wakes idle recipient without duplicating an active turn.",
  wait_for:
    "Wait for these required specialists to finish. Parent remains active but not inferring. Completion is otherwise queue-only.",
  save_artifact:
    "Finalize an immutable private artifact and return its reference/content to Slow. Does not publish a slide.",
  image_generate:
    "Generate a private raster image with OpenAI. Returns immutable asset reference. Does not publish.",
};
export function allowedTools(role: Role): ToolName[] {
  return role === "fast"
    ? ["view_slide", "edit"]
    : role === "slow"
      ? [
          "view_slide",
          "edit",
          "delegate",
          "send_message",
          "followup_task",
          "wait_for",
        ]
      : ["save_artifact", "image_generate", "send_message", "followup_task"];
}
export function definitions(role: Role): FunctionTool[] {
  return allowedTools(role).map((name) => ({
    type: "function",
    name,
    description: descriptions[name],
    parameters: z.toJSONSchema(schemas[name]),
    strict: true,
  }));
}
export function parseTool(
  role: Role,
  name: string,
  args: string,
): Record<string, unknown> {
  if (!allowedTools(role).includes(name as ToolName))
    throw new Error(`Tool ${name} is not available to ${role}`);
  return schemas[name as ToolName].parse(JSON.parse(args));
}
