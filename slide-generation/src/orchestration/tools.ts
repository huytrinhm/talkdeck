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
    "End this activation, not the session, when useful work is complete. This does not certify deck readiness or publish anything. Pending speech/tasks and required specialist results still take precedence. Specialists must deliver findings through save_artifact or send_message before finishing; assistant prose is not forwarded. Specialist completion queues a parent notice and resumes a parent waiting for it, but does not wake an idle parent. Never use a no-op edit to finish.",
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
    "Start a focused private specialist task; returns {recipient: specialistId} immediately and makes its completion required for this activation. Supply a self-contained task and facts, including exact wording, units, constraints and desired deliverable: the specialist does not inherit your conversation or reasoning. slideId null uses your working slide. Specialists cannot edit or validate the shared deck; only Slow integrates useful results. At most two active specialists. Use wait_for when required work remains outstanding.",
  send_message:
    "Queue text to an existing agent ID; returns {queued:true}, not a read receipt, and does not wake an idle recipient. Specialists may send only to their parent Slow session. Use this to deliver findings or limitations without an artifact; it does not end your activation. Use followup_task when asking an idle recipient to do new work.",
  followup_task:
    "Request work from an existing agent ID with a task and supporting facts. Returns {requested:true}, not completion; wakes an idle recipient or queues work for its active session. Existing session history is retained. Specialists may request work only from their parent, never themselves or siblings. A specialist followup becomes required work for an active parent.",
  wait_for:
    "Wait for your own specialist IDs to finish; parent remains active but not inferring. Returns each child's state, possible error and artifact references. A completed wait can include failed children: inspect state/error and queued result messages before integrating. Completion messages are otherwise queue-only and do not wake an idle parent. Waiting does not publish or integrate results.",
  save_artifact:
    "Store an immutable private artifact. Returns {ref,mediaType,queuedToParent} to you and queues its ref, mediaType, full content and target slide to your parent Slow session. Queueing is not a read receipt. This does not end your task, publish a slide, validate the content or register a canonical asset. Call finish after delivering all needed results. HTML/CSS/SVG remain private artifact content, not native-ready Talkdeck elements or assets.",
  image_generate:
    "Generate a private PNG using OpenAI gpt-image-2.5-flare (Flare 2.5). Supply a self-contained visual prompt: the image provider receives no deck, task history or facts beyond this prompt. Null quality defaults to medium; null size defaults to 1536x1024. Returns {ref,mediaType,queuedToParent}; the next model boundary includes its preview, and the parent's artifact delivery includes the preview. Queueing is not a read receipt; inspect the supplied pixels before claiming visual review. Does not end the task, publish, or register a canonical Image asset; Slow must resolve integration separately.",
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

const deckRequestSchema = z
  .object({
    scope: z.enum(["cross_slide", "theme", "library"]),
    utteranceId: z.string().min(1).max(4096),
  })
  .strict();

/** Canonical-only parse; legacy tool rights remain unchanged. */
export function parseLifecycleTool(
  role: Role,
  name: string,
  args: string,
): Record<string, unknown> {
  if (name !== "request_deck_edit") return parseTool(role, name, args);
  if (role !== "fast")
    throw new Error("Only canonical Fast may request a deck edit");
  return deckRequestSchema.parse(JSON.parse(args));
}

/** Scheduler lifecycle tools remain local when generation tools come from a backend. */
export function lifecycleDefinitions(role: Role): FunctionTool[] {
  const legacy = new Set([
    "view_slide",
    "edit",
    "list_slides",
    "edit_slides",
    "split_slide",
    "merge_slides",
  ]);
  const tools = definitions(role).filter((tool) => !legacy.has(tool.name));
  if (role === "fast")
    tools.push({
      type: "function",
      name: "request_deck_edit",
      strict: true,
      description:
        "Forward an explicit user request requiring cross-slide, theme, or library work to Slow immediately. Copy its exact Prompt utteranceId from notes.transcript in your current context (or read_speaker_notes). The runtime forwards the complete stored input, including qualifiers; supply no quote, paraphrase, or task text. The ID must belong to your working slide and current speech snapshot. Do not broaden the request; do not use this for autonomous refinement. No Fast publication is required. Repeated identical requests from this speech revision queue only once. Fast's source-edit scope remains unchanged.",
      parameters: z.toJSONSchema(deckRequestSchema),
    });
  return tools;
}
