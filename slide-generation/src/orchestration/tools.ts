import { z } from "zod";
import type { FunctionTool } from "openai/resources/responses/responses";
import type { Role } from "./types.js";
const schemas = {
  finish: z.object({}),
  view_slide: z.object({ slideId: z.string().nullable().optional() }),
  edit: z.object({
    slideId: z.string().nullable().optional(),
    old: z.string().min(1),
    new: z.string(),
  }),
  list_slides: z.object({}),
  edit_slides: z.object({
    edits: z
      .array(
        z.object({
          slideId: z.string(),
          old: z.string().min(1),
          new: z.string(),
        }),
      )
      .min(1),
  }),
  split_slide: z.object({
    slideId: z.string(),
    parts: z
      .array(z.object({ title: z.string().min(1), source: z.string().min(1) }))
      .min(2),
  }),
  merge_slides: z.object({
    slideIds: z.array(z.string()).min(2),
    title: z.string().min(1),
    source: z.string().min(1),
  }),
  delegate: z.object({
    task: z.string().min(1),
    facts: z.string(),
    slideId: z.string().nullable().optional(),
  }),
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
  image_generate: z.object({
    prompt: z.string().min(1),
    quality: z.enum(["low", "medium", "high"]).nullable().optional(),
    size: z.enum(["1024x1024", "1536x1024", "1024x1536"]).nullable().optional(),
  }),
};
export type ToolName = keyof typeof schemas;
const descriptions: Record<ToolName, string> = {
  finish:
    "Finish this activation when no useful work remains. Preserve the session for future narration/tasks. Never use a no-op edit to finish. Pending speech/tasks and required specialist results still take precedence.",
  view_slide:
    "Inspect a stable slide ID, or your working slide when null. Returns source, actual screenshot, geometry and diagnostics. Does not navigate the user.",
  list_slides:
    "Inspect deck order, stable IDs and narration, including past slides. Does not navigate.",
  edit_slides:
    "Atomically edit several previously observed slides; all-or-nothing. View the slides first. Only Slow may use broader edits.",
  split_slide:
    "Split an observed slide into complete self-contained HTML documents. Original ID remains for first part. Does not select a new slide.",
  merge_slides:
    "Atomically merge adjacent observed slides in deck order into one self-contained HTML document. First ID survives; removed IDs reject stale edits.",
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
    "Generate a private raster image with OpenAI gpt-image-2.5-flare (Flare 2.5); choose quality and aspect ratio. Returns immutable asset reference. Does not publish.",
};
export function allowedTools(role: Role): ToolName[] {
  return role === "fast"
    ? ["view_slide", "edit", "finish"]
    : role === "slow"
      ? [
          "view_slide",
          "list_slides",
          "edit",
          "edit_slides",
          "split_slide",
          "merge_slides",
          "delegate",
          "send_message",
          "followup_task",
          "wait_for",
          "finish",
        ]
      : [
          "save_artifact",
          "image_generate",
          "send_message",
          "followup_task",
          "finish",
        ];
}
export function definitions(role: Role): FunctionTool[] {
  return allowedTools(role).map((name) => ({
    type: "function",
    name,
    description: descriptions[name],
    parameters: (() => {
      const schema = z.toJSONSchema(schemas[name]);
      schema.required = Object.keys(schema.properties ?? {});
      return schema;
    })(),
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
