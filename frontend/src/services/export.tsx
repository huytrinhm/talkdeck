import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { SlideView } from "../components/SlideView";
import type { Project } from "../domain/types";
const safeName = (s: string) =>
  s
    .replace(/[^\p{L}\p{N} ._-]/gu, "")
    .trim()
    .slice(0, 100) || "Presentation";
export async function exportProject(project: Project, format: "pptx" | "pdf") {
  if (format === "pptx") {
    const { default: PptxGenJS } = await import("pptxgenjs");
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.title = project.title;
    pptx.author = "Talkdeck";
    for (const slide of project.slides) {
      const page = pptx.addSlide();
      const dark = slide.theme === "midnight";
      const ink = dark
        ? "F6F7FB"
        : slide.theme === "lavender"
          ? "302E43"
          : "25272C";
      page.background = {
        color: dark
          ? "22334B"
          : slide.theme === "lavender"
            ? "F0EFFA"
            : "FFFFFF",
      };
      page.addText(slide.title, {
        x: 0.9,
        y: 0.8,
        w: 11.5,
        h: 1.4,
        fontSize: slide.layout === "title" ? 38 : 30,
        bold: true,
        color: ink,
        breakLine: false,
        margin: 0,
      });
      if (slide.tableData) {
        page.addTable(
          [
            slide.tableData.columns.map((text) => ({ text })),
            ...slide.tableData.rows.map((row) =>
              row.map((v) => ({ text: String(v ?? "") })),
            ),
          ],
          {
            x: 0.9,
            y: 2.5,
            w: 11.5,
            fontSize: 16,
            color: ink,
            border: { type: "solid", color: dark ? "4D607A" : "E4E6EB", pt: 1 },
            fill: { color: dark ? "2C4261" : "F1F3FC" },
            autoPage: true,
          },
        );
      } else
        page.addText(
          slide.body.map((s) => ({
            text: s,
            options: { breakLine: true, bullet: slide.layout === "bullets" },
          })),
          {
            x: 0.9,
            y: 2.7,
            w: 11,
            h: 3.7,
            fontSize: 22,
            color: ink,
            margin: 0,
            paraSpaceAfter: 14,
          },
        );
      page.addNotes(slide.notes);
    }
    await pptx.writeFile({ fileName: `${safeName(project.title)}.pptx` });
    return;
  }
  const [{ jsPDF }, { toPng }] = await Promise.all([
    import("jspdf"),
    import("html-to-image"),
  ]);
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "px",
    format: [1280, 720],
    hotfixes: ["px_scaling"],
  });
  const host = document.createElement("div");
  host.className = "export-render";
  host.setAttribute("aria-hidden", "true");
  document.body.append(host);
  const root = createRoot(host);
  try {
    for (let i = 0; i < project.slides.length; i++) {
      flushSync(() =>
        root.render(
          <div className="slide-frame">
            <SlideView slide={project.slides[i]} />
          </div>,
        ),
      );
      await document.fonts.ready;
      const data = await toPng(host, {
        pixelRatio: 1,
        width: 1280,
        height: 720,
      });
      if (i) pdf.addPage([1280, 720], "landscape");
      pdf.addImage(data, "PNG", 0, 0, 1280, 720);
    }
    pdf.save(`${safeName(project.title)}.pdf`);
  } finally {
    root.unmount();
    host.remove();
  }
}
