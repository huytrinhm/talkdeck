import Papa from "papaparse";
import type { Material, TableData } from "./types";
import { uid } from "./types";

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const cell = (v: unknown): v is string | number | boolean | null =>
  v === null ||
  typeof v === "string" ||
  typeof v === "boolean" ||
  (typeof v === "number" &&
    Number.isFinite(v) &&
    (!Number.isInteger(v) || Number.isSafeInteger(v)));
const headers = (v: unknown): v is string[] =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.every((x) => typeof x === "string" && x.trim().length > 0) &&
  new Set(v.map((x) => x.trim().toLowerCase())).size === v.length;
function table(value: unknown, name: string): TableData | undefined {
  if (Array.isArray(value) && value.length && value.every(record)) {
    const columns = Object.keys(value[0]);
    if (
      !headers(columns) ||
      !value.every(
        (r) =>
          Object.keys(r).length === columns.length &&
          columns.every((c) => Object.hasOwn(r, c) && cell(r[c])),
      )
    )
      return;
    return {
      name,
      columns,
      rows: value.map((r) =>
        columns.map((c) => r[c] as string | number | boolean | null),
      ),
    };
  }
  if (record(value) && headers(value.columns) && Array.isArray(value.rows)) {
    const columns = value.columns;
    if (
      !value.rows.every(
        (r) => Array.isArray(r) && r.length === columns.length && r.every(cell),
      )
    )
      return;
    return {
      name:
        typeof value.name === "string" && value.name.trim() ? value.name : name,
      columns: value.columns,
      rows: value.rows as TableData["rows"],
      ...(Array.isArray(value.aliases) &&
      value.aliases.every((x) => typeof x === "string")
        ? { aliases: value.aliases }
        : {}),
    };
  }
}
export function parseMaterialText(
  name: string,
  type: string,
  text: string,
): Pick<Material, "text" | "tables" | "status"> {
  const stem = name.replace(/\.[^.]+$/, "");
  if (/\.csv$/i.test(name) || type === "text/csv") {
    const result = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
    const [columns, ...rows] = result.data;
    if (
      !result.errors.length &&
      headers(columns) &&
      rows.every((r) => r.length === columns.length)
    )
      return { tables: [{ name: stem, columns, rows }], status: "ready" };
    return { status: "reference" };
  }
  if (/\.json$/i.test(name) || type === "application/json") {
    try {
      const value: unknown = JSON.parse(text);
      if (record(value) && Array.isArray(value.tables)) {
        const tables = value.tables.map((v, i) => table(v, `${stem} ${i + 1}`));
        if (tables.length && tables.every((v): v is TableData => !!v))
          return {
            tables,
            text: typeof value.context === "string" ? value.context : undefined,
            status: "ready",
          };
      }
      const parsed = table(value, stem);
      if (parsed) return { tables: [parsed], status: "ready" };
      if (record(value) && typeof value.context === "string")
        return { text: value.context, status: "ready" };
    } catch {
      /* Unsupported or invalid structured sources remain intact attachments. */
    }
    return { status: "reference" };
  }
  if (
    type.startsWith("text/") ||
    /\.(txt|md|markdown|sql|js|ts|tsx|jsx|py|css|html|xml|yaml|yml|log)$/i.test(
      name,
    )
  )
    return { text, status: "ready" };
  return { status: "reference" };
}
export async function analyzeMaterial(file: File): Promise<Material> {
  const id = uid();
  const structured =
    /\.(csv|json)$/i.test(file.name) ||
    ["text/csv", "application/json"].includes(file.type);
  const textual =
    structured ||
    file.type.startsWith("text/") ||
    /\.(txt|md|markdown|sql|js|ts|tsx|jsx|py|css|html|xml|yaml|yml|log)$/i.test(
      file.name,
    );
  const parsed = textual
    ? parseMaterialText(file.name, file.type, await file.text())
    : { status: "reference" as const };
  return {
    id,
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    blobKey: `source-${id}`,
    ...parsed,
  };
}
export const formatBytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / (1024 * 1024)).toFixed(1)} MB`;
