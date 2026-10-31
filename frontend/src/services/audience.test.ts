import { it, expect } from "vitest";
import { publicSlide, sanitizeAudiencePayload } from "./audience";
import { blankSlide } from "../domain/types";
const slide = () => ({
  ...blankSlide(),
  notes: "private notes",
  materialRef: {
    materialId: "private-source",
    tableName: "Customers",
    page: 1,
  },
  tableData: {
    name: "Customers",
    columns: ["name"],
    rows: Array.from({ length: 20 }, (_, i) => [i]),
    aliases: ["private alias"],
  },
});
const payload = (s: unknown) => ({
  projectId: "p",
  slide: s,
  black: false,
  ended: false,
  timestamp: 10,
});
it("publishes only the visible table page and omits private source metadata", () => {
  const s = slide(),
    out = publicSlide(s)!;
  expect(out.tableData?.rows).toEqual(
    Array.from({ length: 8 }, (_, i) => [i + 8]),
  );
  expect(out.tableData?.name).toContain("Page 2 of 3");
  expect(JSON.stringify(out)).not.toContain("private");
  expect(out).not.toHaveProperty("materialRef");
  expect(out).not.toHaveProperty("notes");
  expect(s.tableData.rows).toHaveLength(20);
});
it("rejects malformed table data before reaching the renderer", () => {
  for (const tableData of [
    { columns: "bad", rows: [] },
    { name: "t", columns: ["a"], rows: "bad" },
    { name: "t", columns: ["a"], rows: [{}] },
    { name: "t", columns: ["a"], rows: [[{}]] },
    { name: "t", columns: [1], rows: [] },
  ])
    expect(
      sanitizeAudiencePayload(payload({ ...blankSlide(), tableData }), "p"),
    ).toBeNull();
});
it("rebuilds received payload fields, dropping presenter-private extras", () => {
  const out = sanitizeAudiencePayload(
    { ...payload(slide()), transcript: ["private"] },
    "p",
  )!;
  expect(out).not.toHaveProperty("transcript");
  expect(out.slide).not.toHaveProperty("notes");
  expect(out.slide).not.toHaveProperty("materialRef");
  expect(out.slide?.tableData).not.toHaveProperty("aliases");
});
it("rejects wrong projects, stale timestamps and missing slide shape", () => {
  expect(sanitizeAudiencePayload(payload(blankSlide()), "other")).toBeNull();
  expect(sanitizeAudiencePayload(payload(blankSlide()), "p", 11)).toBeNull();
  expect(sanitizeAudiencePayload(payload({}), "p")).toBeNull();
  expect(sanitizeAudiencePayload(payload(null), "p")?.slide).toBeNull();
});
