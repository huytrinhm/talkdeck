// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { Workspace } from "./Workspace";
import { blankSlide, newProject } from "../domain/types";
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
it("has no manual slide content editor and ignores exposed mutation shortcuts", () => {
  const project = newProject([]);
  project.slides = [blankSlide(), blankSlide()];
  const change = vi.fn();
  render(
    <Workspace
      project={project}
      mode="edit"
      onChange={change}
      onMode={() => {}}
      onBack={() => {}}
    />,
  );
  fireEvent.doubleClick(screen.getByLabelText("Slide canvas", { exact: true }));
  expect(screen.queryByRole("dialog", { name: "Edit slide" })).toBeNull();
  expect(screen.getByRole("button", { name: "Add slide" })).toBeTruthy();
  const thumb = screen.getByRole("button", { name: /Slide 1:/ });
  thumb.focus();
  for (const event of [
    { key: "Delete" },
    { key: "Backspace" },
    { key: "ArrowRight", altKey: true },
    { key: "v", ctrlKey: true },
    { key: "x", metaKey: true },
  ])
    fireEvent.keyDown(thumb, event);
  window.dispatchEvent(
    new CustomEvent("talkdeck-slide-operation", { detail: "cut" }),
  );
  expect(change).not.toHaveBeenCalled();
});

it("Add creates and selects a distinct slide, focuses it, and Undo restores the deck", () => {
  const project = newProject([]);
  project.slides = [blankSlide()];
  let current = project;
  const change = vi.fn((p) => {
    current = p;
  });
  const props = {
    mode: "edit" as const,
    onChange: change,
    onMode: () => {},
    onBack: () => {},
  };
  const view = render(<Workspace project={current} {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Add slide" }));
  expect(current.slides).toHaveLength(2);
  expect(current.slides[1].id).not.toBe(project.slides[0].id);
  view.rerender(<Workspace project={current} {...props} />);
  const added = screen.getByRole("button", { name: /Slide 2:/ });
  expect(added.getAttribute("aria-current")).toBe("true");
  expect(document.activeElement).toBe(added);
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(current.slides).toHaveLength(1);
  view.rerender(<Workspace project={current} {...props} />);
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: /Slide 1:/ }),
  );
});
