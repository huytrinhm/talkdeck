// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Workspace } from "./Workspace";
import { newProject, blankSlide } from "../domain/types";
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setup() {
  const project = newProject([]);
  project.theme = "midnight";
  project.slides = [blankSlide("midnight")];
  render(
    <Workspace
      project={project}
      mode="edit"
      onChange={() => {}}
      onMode={() => {}}
      onBack={() => {}}
    />,
  );
  return screen.getByLabelText("Slide annotations");
}
it("has no manual slide theme controls while retaining the stored slide appearance", () => {
  setup();
  expect(screen.queryByRole("group", { name: "Slide theme" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: /^(Paper|Midnight|Lavender) theme$/ }),
  ).toBeNull();
  expect(document.querySelector(".stage .slide-theme-midnight")).toBeTruthy();
});
it("uses distinct tool cursors and restores pointer on held release, Escape and blur", () => {
  const canvas = setup();
  expect(canvas.getAttribute("data-canvas-tool")).toBe("pointer");
  expect(canvas.style.cursor).toBe("default");
  const cursors = new Set<string>();
  for (const [name, tool] of [
    ["Pen (hold D)", "pen"],
    ["Highlighter (hold H)", "highlighter"],
    ["Erase whole stroke (hold E)", "eraser"],
  ]) {
    fireEvent.click(screen.getByRole("button", { name }));
    expect(canvas.getAttribute("data-canvas-tool")).toBe(tool);
    expect(canvas.style.cursor).toContain("data:image/svg+xml");
    cursors.add(canvas.style.cursor);
  }
  expect(cursors.size).toBe(3);
  fireEvent.click(screen.getByRole("button", { name: "Pen (hold D)" }));
  fireEvent.keyDown(window, { key: "h" });
  expect(canvas.getAttribute("data-canvas-tool")).toBe("highlighter");
  fireEvent.keyUp(window, { key: "h" });
  expect(canvas.getAttribute("data-canvas-tool")).toBe("pointer");
  fireEvent.keyDown(window, { key: "e" });
  fireEvent.blur(window);
  expect(canvas.getAttribute("data-canvas-tool")).toBe("pointer");
  fireEvent.click(screen.getByRole("button", { name: "Pen (hold D)" }));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(canvas.style.cursor).toBe("default");
});
it('has horizontal visual color and size choices rather than a thickness select',()=>{
 setup();fireEvent.click(screen.getByRole('button',{name:'pen color and thickness'}));expect(screen.queryByRole('combobox')).toBeNull();expect(screen.getByRole('button',{name:'5 px thickness'})).toBeTruthy();
});
