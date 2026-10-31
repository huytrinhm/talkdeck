import type { Layout, Slide } from "./types";
export function editorContent(slide: Slide): string {
  return slide.tableData
    ? [
        slide.tableData.columns.join(" | "),
        ...slide.tableData.rows.map((row) =>
          row.map((v) => String(v ?? "")).join(" | "),
        ),
      ].join("\n")
    : slide.body.join("\n");
}
export function editSlide(
  original: Slide,
  title: string,
  content: string,
  layout: Layout,
): Slide {
  const next = {
    ...structuredClone(original),
    title: title.trim() || "Untitled slide",
    layout,
  };
  if (layout === "table") {
    if (original.tableData && content === editorContent(original)) return next;
    const rows = content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => line.split("|").map((cell) => cell.trim()));
    const columns = rows.shift();
    if (
      !columns?.length ||
      columns.some((c) => !c) ||
      new Set(columns).size !== columns.length
    )
      throw Error(
        "Table headers must be non-empty and unique. Separate cells with |.",
      );
    if (rows.some((row) => row.length !== columns.length))
      throw Error(
        "Every table row must have the same number of cells as the header.",
      );
    next.tableData = {
      name: original.tableData?.name ?? title.trim() ?? "Table",
      columns,
      rows,
    };
    next.body = [];
    delete next.materialRef;
  } else {
    next.body = content.split("\n").filter(Boolean);
    delete next.tableData;
    if (
      JSON.stringify(next.body) !== JSON.stringify(original.body) ||
      layout !== original.layout
    )
      delete next.materialRef;
  }
  return next;
}
