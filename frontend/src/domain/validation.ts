/** Runtime guards for persisted browser data; invalid data is retained for recovery, never overwritten. */
import type { Slide } from "./types";
type RecordValue = Record<string, unknown>;
const object = (x: unknown): x is RecordValue =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const strings = (x: unknown): x is string[] =>
  Array.isArray(x) && x.every((s) => typeof s === "string");
const finite = (x: unknown) => typeof x === "number" && Number.isFinite(x);
const list = (x: unknown, guard: (x: unknown) => boolean) =>
  Array.isArray(x) && x.every(guard);
const unique = (x: unknown) =>
  Array.isArray(x) &&
  new Set(x.map((v) => (object(v) ? v.id : undefined))).size === x.length;
const table = (x: unknown) =>
  object(x) &&
  typeof x.name === "string" &&
  strings(x.columns) &&
  list(
    x.rows,
    (row) =>
      Array.isArray(row) &&
      row.length === (x.columns as unknown[]).length &&
      row.every(
        (cell) =>
          cell === null ||
          typeof cell === "string" ||
          typeof cell === "boolean" ||
          finite(cell),
      ),
  );
const slide = (x: unknown): boolean =>
  object(x) &&
  typeof x.id === "string" &&
  typeof x.title === "string" &&
  strings(x.body) &&
  typeof x.notes === "string" &&
  [
    "title",
    "bullets",
    "process",
    "comparison",
    "quote",
    "table",
    "code",
  ].includes(String(x.layout)) &&
  ["paper", "midnight", "lavender"].includes(String(x.theme)) &&
  (x.tableData === undefined || table(x.tableData));
const transcript = (x: unknown): boolean =>
  object(x) &&
  typeof x.id === "string" &&
  typeof x.slideId === "string" &&
  typeof x.text === "string" &&
  finite(x.start) &&
  finite(x.end) &&
  (x.inputSource === undefined ||
    ["device", "phone"].includes(String(x.inputSource))) &&
  (x.captureSessionId === undefined ||
    typeof x.captureSessionId === "string") &&
  (x.capturedAt === undefined || finite(x.capturedAt));
const material = (x: unknown): boolean =>
  object(x) &&
  ["id", "name", "type", "blobKey"].every(
    (key) => typeof x[key] === "string",
  ) &&
  finite(x.size) &&
  ["ready", "reference", "error"].includes(String(x.status)) &&
  (x.tables === undefined || list(x.tables, table));
const proposal = (x: unknown): boolean =>
  object(x) &&
  ["id", "slideId", "title", "reason"].every(
    (key) => typeof x[key] === "string",
  ) &&
  slide(x.before) &&
  slide(x.after) &&
  strings(x.fields) &&
  ["pending", "accepted", "rejected"].includes(String(x.status)) &&
  ["fields", "split", "reorder"].includes(String(x.type)) &&
  (x.extraSlides === undefined || list(x.extraSlides, slide));
const rehearsal = (x: unknown): boolean =>
  object(x) &&
  typeof x.id === "string" &&
  list(x.snapshot, slide) &&
  list(x.transcript, transcript) &&
  finite(x.elapsed) &&
  list(x.proposals, proposal);
const project = (x: unknown): boolean =>
  object(x) &&
  ["id", "title", "description", "systemPrompt"].every(
    (key) => typeof x[key] === "string",
  ) &&
  (x.folderId === null || typeof x.folderId === "string") &&
  list(x.slides, slide) &&
  unique(x.slides) &&
  list(x.materials, material) &&
  list(x.transcript, transcript) &&
  list(x.rehearsals, rehearsal) &&
  finite(x.createdAt) &&
  finite(x.updatedAt) &&
  ["draft", "ready"].includes(String(x.status)) &&
  ["paper", "midnight", "lavender"].includes(String(x.theme));
export function validWorkspace(x: unknown): boolean {
  return (
    object(x) &&
    x.version === 2 &&
    list(x.projects, project) &&
    unique(x.projects) &&
    list(
      x.folders,
      (f) =>
        object(f) &&
        typeof f.id === "string" &&
        typeof f.name === "string" &&
        (f.parentId === null || typeof f.parentId === "string"),
    ) &&
    unique(x.folders)
  );
}
/** Renderable current frontend model; adapters must map their own service schema explicitly. */
export const validSlide = (value: unknown): value is Slide => slide(value);
