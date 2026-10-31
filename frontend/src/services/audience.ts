import type { Slide, TableData } from "../domain/types";
export interface AudiencePayload {
  projectId: string;
  slide: Omit<Slide, "notes" | "materialRef"> | null;
  black: boolean;
  ended: boolean;
  timestamp: number;
}
const key = "talkdeck-audience-output";
export function publicSlide(slide: Slide): AudiencePayload["slide"] {
  const output: NonNullable<AudiencePayload["slide"]> = {
    id: slide.id,
    title: slide.title,
    body: [...slide.body],
    layout: slide.layout,
    theme: slide.theme,
  };
  if (slide.tableData) {
    const table = slide.tableData,
      total = Math.max(1, Math.ceil(table.rows.length / 8));
    const requested = slide.materialRef?.page ?? 0;
    const page = Number.isFinite(requested)
      ? Math.min(total - 1, Math.max(0, Math.floor(requested)))
      : 0;
    output.tableData = {
      name: table.name + (total > 1 ? ` · Page ${page + 1} of ${total}` : ""),
      columns: [...table.columns],
      rows: table.rows.slice(page * 8, page * 8 + 8).map((row) => [...row]),
    };
  }
  return output;
}
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
function safeTable(v: unknown): TableData | null {
  if (
    !record(v) ||
    typeof v.name !== "string" ||
    !Array.isArray(v.columns) ||
    !v.columns.every((c) => typeof c === "string") ||
    !Array.isArray(v.rows)
  )
    return null;
  const cell = (v: unknown) =>
    v === null ||
    typeof v === "string" ||
    typeof v === "boolean" ||
    (typeof v === "number" && Number.isFinite(v));
  if (!v.rows.every((row) => Array.isArray(row) && row.every(cell)))
    return null;
  return {
    name: v.name,
    columns: [...v.columns] as string[],
    rows: v.rows.map((row) => [...row]),
  };
}
/** Treat cached and broadcast values as untrusted; private source and speaker fields never cross this boundary. */
export function sanitizeAudiencePayload(
  value: unknown,
  projectId: string,
  latest = 0,
): AudiencePayload | null {
  if (
    !record(value) ||
    value.projectId !== projectId ||
    typeof value.timestamp !== "number" ||
    !Number.isFinite(value.timestamp) ||
    value.timestamp < latest ||
    typeof value.black !== "boolean" ||
    typeof value.ended !== "boolean"
  )
    return null;
  let slide: AudiencePayload["slide"] = null;
  if (value.slide !== null) {
    const s = value.slide;
    if (
      !record(s) ||
      typeof s.id !== "string" ||
      typeof s.title !== "string" ||
      !Array.isArray(s.body) ||
      !s.body.every((x) => typeof x === "string") ||
      typeof s.layout !== "string" ||
      ![
        "title",
        "bullets",
        "process",
        "comparison",
        "quote",
        "table",
        "code",
      ].includes(s.layout) ||
      typeof s.theme !== "string" ||
      !["paper", "midnight", "lavender"].includes(s.theme)
    )
      return null;
    slide = {
      id: s.id,
      title: s.title,
      body: [...s.body] as string[],
      layout: s.layout as Slide["layout"],
      theme: s.theme as Slide["theme"],
    };
    if (s.tableData !== undefined) {
      const table = safeTable(s.tableData);
      if (!table) return null;
      slide.tableData = table;
    }
  }
  return {
    projectId,
    slide,
    black: value.black,
    ended: value.ended,
    timestamp: value.timestamp,
  };
}
export function publishAudience(payload: AudiencePayload) {
  try {
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    /* Storage may be full; the live channel can still work. */
  }
  try {
    const c = new BroadcastChannel(key);
    c.postMessage(payload);
    c.close();
  } catch {
    /* Audience transport is optional. */
  }
}
export function subscribeAudience(
  projectId: string,
  callback: (p: AudiencePayload) => void,
) {
  let latest = 0;
  const receive = (value: unknown) => {
    const p = sanitizeAudiencePayload(value, projectId, latest);
    if (!p) return;
    latest = p.timestamp;
    callback(p);
  };
  try {
    receive(JSON.parse(localStorage.getItem(key) || "null"));
  } catch {}
  let c: BroadcastChannel | null = null;
  try {
    c = new BroadcastChannel(key);
    c.onmessage = (e) => receive(e.data);
  } catch {
    /* Storage events remain available. */
  }
  const storage = (e: StorageEvent) => {
    if (e.key === key && e.newValue) {
      try {
        receive(JSON.parse(e.newValue));
      } catch {}
    }
  };
  window.addEventListener("storage", storage);
  return () => {
    c?.close();
    window.removeEventListener("storage", storage);
  };
}
