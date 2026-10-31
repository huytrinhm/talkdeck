import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Log, Observation } from "./types.js";
export class FileLog implements Log {
  private seen = new Set<string>();
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true });
  }
  write(type: string, data: Record<string, unknown>) {
    appendFileSync(
      join(this.directory, "events.jsonl"),
      JSON.stringify({ at: Date.now(), type, ...data }) + "\n",
    );
  }
  observation(o: Observation) {
    if (this.seen.has(o.id)) return;
    this.seen.add(o.id);
    writeFileSync(join(this.directory, `${o.id}.html`), o.source);
    writeFileSync(join(this.directory, `${o.id}.png`), o.screenshot);
    this.write("observation", {
      id: o.id,
      slideId: o.slideId,
      geometry: o.geometry,
      diagnostics: o.diagnostics,
      fastWatermark: o.fastWatermark,
    });
  }
}
