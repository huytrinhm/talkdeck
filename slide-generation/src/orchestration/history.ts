import { createHash } from "node:crypto";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { Observation } from "./types.js";
import { actorContext, taskContext, messageContext } from "./model-context.js";
export type Entry =
  | { kind: "item"; item: ResponseInputItem }
  | { kind: "boundary"; value: Record<string, unknown> }
  | { kind: "image"; key: string; item: ResponseInputItem }
  | { kind: "observation"; value: Observation };

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const parse = (value: string): Record<string, unknown> => {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};
// Preserve decisions, diagnostics, identifiers and transaction outcomes, not old
// source bodies. Original tool traffic remains in entries and the durable log.
function archiveBodies(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(archiveBodies);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [
      key,
      ["lines", "source", "text", "screenshot", "jsx"].includes(key)
        ? "[Archived body; reread exact source for edit anchors]"
        : archiveBodies(v),
    ]),
  );
}
export class History {
  entries: Entry[] = [];
  constructor(private readonly canonical = false) {}
  add(item: ResponseInputItem) {
    this.entries.push({ kind: "item", item });
  }
  boundary(value: Record<string, unknown>) {
    this.entries.push({ kind: "boundary", value: structuredClone(value) });
  }
  modelItem(item: ResponseInputItem) {
    if (
      !("content" in item) ||
      !Array.isArray(item.content) ||
      !item.content.some((part) => part.type === "input_image")
    ) {
      this.add(item);
      return;
    }
    // A screenshot call may return several slides in one message. Keep each
    // metadata/image pair independently addressable and bounded.
    let metadata: Extract<
      (typeof item.content)[number],
      { type: "input_text" }
    >[] = [];
    for (const part of item.content) {
      if (part.type === "input_text") metadata.push(part);
      else if (part.type === "input_image") {
        const fields = metadata.length
          ? parse(metadata[metadata.length - 1].text)
          : {};
        const frame = { role: "user" as const, content: [...metadata, part] };
        const key = fields.sourceDigest
          ? `${fields.slideId}:${fields.sourceDigest}`
          : digest(JSON.stringify(frame));
        this.entries.push({ kind: "image", key, item: frame });
        metadata = [];
      } else if (part.type === "input_file")
        this.add({ role: "user", content: [part] });
    }
    if (metadata.length) this.add({ role: "user", content: metadata });
  }
  observe(value: Observation) {
    this.entries.push({ kind: "observation", value });
  }
  project(): ResponseInputItem[] {
    const latest = new Map<string, number>();
    const images = new Map<string, number>();
    const sourceResults = new Map<string, number>();
    const toolNames = new Map<string, string>();
    let latestBoundary = -1;
    for (const e of this.entries) {
      if (e.kind === "item" && e.item.type === "function_call")
        toolNames.set(e.item.call_id, e.item.name);
    }
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e.kind === "boundary" && latestBoundary < 0) latestBoundary = i;
      if (
        e.kind === "observation" &&
        latest.size < 2 &&
        !latest.has(e.value.id)
      )
        latest.set(e.value.id, i);
      const imageKey =
        e.kind === "image"
          ? e.key
          : e.kind === "observation" && e.value.screenshot.length
            ? `${e.value.slideId}:${e.value.visualSourceRevision ?? e.value.sourceRevision ?? e.value.id}`
            : undefined;
      if (imageKey && images.size < 2 && !images.has(imageKey))
        images.set(imageKey, i);
      if (
        this.canonical &&
        e.kind === "item" &&
        e.item.type === "function_call_output" &&
        ["read_source", "edit_source"].includes(
          toolNames.get(e.item.call_id ?? "") ?? "",
        ) &&
        typeof e.item.output === "string"
      ) {
        const output = parse(e.item.output);
        const key = String(
          output.revision ?? output.snapshotId ?? e.item.call_id,
        );
        if (sourceResults.size < 2 && !sourceResults.has(key))
          sourceResults.set(key, i);
      }
    }
    const retainedResults = new Set<number>();
    this.entries.forEach((e, i) => {
      if (
        e.kind !== "item" ||
        e.item.type !== "function_call_output" ||
        typeof e.item.output !== "string"
      )
        return;
      const output = parse(e.item.output);
      const key = String(
        output.revision ?? output.snapshotId ?? e.item.call_id,
      );
      // Every issued node scope at either retained revision stays available for
      // multi-slide transactions; retaining just one result loses valid anchors.
      if (sourceResults.has(key)) retainedResults.add(i);
    });
    const archivedCalls = new Set<string>();
    const currentBoundary = this.entries[latestBoundary];
    const currentSource = [...latest.values()].map(index => this.entries[index])
      .find(entry => entry.kind === "observation" && currentBoundary?.kind === "boundary" &&
        entry.value.slideId === currentBoundary.value.workingSlideId);
    const specialist = currentBoundary?.kind === "boundary" &&
      (currentBoundary.value.recipient as { role?: string } | undefined)?.role === "specialist";
    if (this.canonical)
      this.entries.forEach((e, i) => {
        if (
          e.kind === "item" &&
          e.item.type === "function_call_output" &&
          ["read_source", "edit_source"].includes(
            toolNames.get(e.item.call_id ?? "") ?? "",
          ) &&
          !retainedResults.has(i)
        )
          archivedCalls.add(e.item.call_id ?? "");
      });
    return this.entries.map((e, i): ResponseInputItem => {
      if (e.kind === "boundary") {
        if (i === latestBoundary)
          return { role: "user", content: JSON.stringify(actorContext(e.value,
            currentSource?.kind === "observation" ? currentSource.value : undefined)) };
        const { tasks, messages, workingSlideId } =
          e.value;
        return {
          role: "user",
          content: JSON.stringify({
            kind: "historical_boundary",
            workingSlideId,
            ...(Array.isArray(tasks) && tasks.length ? { tasks: taskContext(tasks) } : {}),
            ...(Array.isArray(messages) && messages.length ? { messages: messageContext(messages) } : {}),
          }),
        };
      }
      if (e.kind === "item") {
        const item = structuredClone(e.item);
        if (
          this.canonical &&
          item.type === "function_call_output" &&
          archivedCalls.has(item.call_id ?? "") &&
          typeof item.output === "string"
        )
          item.output = JSON.stringify({
            ...(archiveBodies(parse(item.output)) as object),
            historyBodyArchived: true,
          });
        if (
          this.canonical &&
          item.type === "function_call" &&
          item.name === "edit_source" &&
          archivedCalls.has(item.call_id ?? "")
        )
          item.arguments = JSON.stringify(archiveBodies(parse(item.arguments)));
        return item;
      }
      if (e.kind === "image")
        return images.get(e.key) === i
          ? structuredClone(e.item)
          : {
              role: "user",
              content: "Historical image (archived).",
            };
      const o = e.value;
      if (latest.get(o.id) !== i)
        return {
          role: "user",
          content: `Historical slide observation (archived): ${o.slideId ?? "unknown"}.`,
        };
      return {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify(this.canonical ? {
              kind: "source_observation",
              slideId: o.slideId,
              ...(!specialist ? { source: o.source } : {}),
              ...(o.geometry.length ? { geometry: o.geometry } : {}),
              ...(o.diagnostics.length ? { diagnostics: o.diagnostics } : {}),
              ...(!o.screenshot.length ? { image_unavailable: o.availability?.screenshot ?? "No image supplied" }
                : o.availability?.screenshot && !/^(available[;:]|current render$)/i.test(o.availability.screenshot)
                  ? { image_limitation: o.availability.screenshot } : {}),
            } : {
              observation: o.id,
              slideId: o.slideId,
              ...(!specialist ? { source: o.source } : { purpose: "Visual reference for the private task, not an editable source snapshot" }),
              sourceRevision: o.sourceRevision,
              visualSourceRevision: o.visualSourceRevision,
              availability: o.availability,
              geometry: o.geometry,
              diagnostics: o.diagnostics,
            }),
          },
          ...(o.screenshot.length &&
          (!this.canonical ||
            images.get(
              `${o.slideId}:${o.visualSourceRevision ?? o.sourceRevision ?? o.id}`,
            ) === i)
            ? [
                {
                  type: "input_image" as const,
                  image_url: `data:${o.screenshotMimeType ?? "image/png"};base64,${o.screenshot.toString("base64")}`,
                  detail: "auto" as const,
                },
              ]
            : []),
        ],
      };
    });
  }
}
