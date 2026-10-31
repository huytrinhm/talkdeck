import { describe, it, expect } from "vitest";
import { parseMaterialText } from "./materials";
describe("source parsing", () => {
  it("preserves quoted CSV delimiters, newlines, quotes and strings", () => {
    expect(
      parseMaterialText(
        "customers.csv",
        "text/csv",
        'id,name,note\r\n001,"Linh, An","line one\nline ""two"""',
      ).tables?.[0],
    ).toEqual({
      name: "customers",
      columns: ["id", "name", "note"],
      rows: [["001", "Linh, An", 'line one\nline "two"']],
    });
  });
  it("keeps ragged CSV and duplicate headers as references", () => {
    expect(parseMaterialText("x.csv", "", "a,b\n1,2,3").status).toBe(
      "reference",
    );
    expect(parseMaterialText("x.csv", "", "a,A\n1,2").status).toBe("reference");
  });
  it("accepts flat records and named multi-table collections", () => {
    expect(
      parseMaterialText(
        "data.json",
        "",
        '[{"a":1,"b":null},{"b":true,"a":"two"}]',
      ).tables?.[0].rows,
    ).toEqual([
      [1, null],
      ["two", true],
    ]);
    expect(
      parseMaterialText(
        "data.json",
        "",
        '{"context":"Notes","tables":[{"name":"Revenue","columns":["Month"],"rows":[["June"]],"aliases":["Sales"]}]}',
      ).tables?.[0].name,
    ).toBe("Revenue");
  });
  it("does not misrepresent nested, inconsistent, unsafe or invalid JSON as exact tables", () => {
    for (const text of [
      '[{"a":{"x":1}}]',
      '[{"a":1},{"b":2}]',
      '[{"a":9007199254740993}]',
      '{"columns":["a"],"rows":[[1,2]]}',
      "{broken",
    ])
      expect(parseMaterialText("x.json", "", text).status).toBe("reference");
  });
  it("stores complete text without applying preview bounds", () => {
    const text = "a".repeat(40000);
    expect(parseMaterialText("notes.md", "", text).text).toBe(text);
  });
});
