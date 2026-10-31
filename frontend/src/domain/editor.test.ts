import { describe, it, expect } from "vitest";
import { editSlide, editorContent } from "./editor";
import type { Slide } from "./types";
const slide: Slide = {
  id: "s",
  title: "Source",
  body: [],
  notes: "private",
  layout: "table",
  theme: "paper",
  materialRef: { materialId: "m", tableName: "Customers" },
  tableData: {
    name: "Customers",
    columns: ["id", "name"],
    rows: [[1, "Linh"]],
  },
};
describe("table editing", () => {
  it("preserves source identity and numeric cells for unchanged table", () => {
    const result = editSlide(slide, "Renamed", editorContent(slide), "table");
    expect(result.materialRef).toEqual(slide.materialRef);
    expect(result.tableData?.rows[0][0]).toBe(1);
  });
  it("shows edited cells and clears source provenance", () => {
    const result = editSlide(slide, "Source", "id | name\n1 | Minh", "table");
    expect(result.tableData?.rows[0][1]).toBe("Minh");
    expect(result.materialRef).toBeUndefined();
    expect(slide.tableData?.rows[0][1]).toBe("Linh");
  });
  it("rejects ragged rows instead of losing cell values", () => {
    expect(() =>
      editSlide(slide, "Source", "id | name\n1 | Minh | extra", "table"),
    ).toThrow(/same number/);
  });
});
