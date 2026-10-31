import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { Observation } from "./types.js";
export type Entry =
  | { kind: "item"; item: ResponseInputItem }
  | { kind: "observation"; value: Observation };
export class History {
  entries: Entry[] = [];
  add(item: ResponseInputItem) {
    this.entries.push({ kind: "item", item });
  }
  observe(value: Observation) {
    this.entries.push({ kind: "observation", value });
  }
  project(): ResponseInputItem[] {
    const latest = new Map<string, number>();
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e.kind === "observation" && !latest.has(e.value.id))
        latest.set(e.value.id, i);
      if (latest.size === 2) break;
    }
    return this.entries.map((e, i) => {
      if (e.kind === "item") return structuredClone(e.item);
      const o = e.value;
      if (latest.get(o.id) !== i)
        return {
          role: "user",
          content: `Archived slide observation ${o.id}. Its full source and screenshot remain in logs.`,
        };
      return {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              observation: o.id,
              slideId: o.slideId,
              source: o.source,
              geometry: o.geometry,
              diagnostics: o.diagnostics,
            }),
          },
          {
            type: "input_image",
            image_url: `data:image/png;base64,${o.screenshot.toString("base64")}`,
            detail: "auto",
          },
        ],
      };
    });
  }
}
