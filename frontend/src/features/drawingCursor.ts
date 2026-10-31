export type CanvasTool = "pen" | "highlighter" | "eraser" | null;
// Small outlined tool silhouettes remain visible on both light and dark slides.
// The hotspot sits at the pen/marker tip or eraser contact edge.
const shapes = {
  pen: {
    path: "M5 27l2-7L23 4l5 5-16 16-7 2z M20 7l5 5 M7 20l5 5",
    x: 5,
    y: 27,
  },
  highlighter: {
    path: "M6 25v-7L21 3l8 8-15 15H6z M17 7l8 8 M4 29h12",
    x: 6,
    y: 26,
  },
  eraser: {
    path: "M4 20L19 5a3 3 0 014 0l6 6a3 3 0 010 4L15 29H9l-5-5a3 3 0 010-4z M11 13l11 11 M9 29h17",
    x: 6,
    y: 25,
  },
};
export function canvasCursor(tool: CanvasTool): string {
  if (!tool) return "default";
  const { path, x, y } = shapes[tool];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="${path}" fill="none" stroke="#111827" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="${path}" fill="none" stroke="#f8fafc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, crosshair`;
}
