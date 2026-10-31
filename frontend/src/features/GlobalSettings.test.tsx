// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GlobalSettings } from "./GlobalSettings";
import { Workspace } from "./Workspace";
import { newProject } from "../domain/types";
import { frontendAdapters } from "../services/adapters";
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
it("does not start capture when a route mounts under already-open app settings", () => {
  const start = vi.fn(),
    pause = vi.fn(),
    dispose = vi.fn();
  vi.spyOn(frontendAdapters, "createSpeech").mockReturnValue({
    start,
    pause,
    stop: vi.fn(),
    resume: vi.fn(),
    retry: vi.fn(),
    setMuted: vi.fn(),
    dispose,
  });
  render(
    <Workspace
      project={newProject([])}
      mode="create"
      speechSuspended
      onChange={() => {}}
      onMode={() => {}}
      onBack={() => {}}
    />,
  );
  expect(start).not.toHaveBeenCalled();
  expect(dispose).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Resume (P)" })).toBeTruthy();
});
it("keeps the sidebar visible and omits settings and sidebar controls", () => {
  render(
    <Workspace
      project={newProject([])}
      mode="edit"
      onChange={() => {}}
      onMode={() => {}}
      onBack={() => {}}
    />,
  );
  expect(
    screen.getByRole("complementary", { name: "Project sidebar" }),
  ).toBeTruthy();
  for (const name of ["App settings", "Project settings", "Toggle sidebar"]) {
    expect(screen.queryByRole("button", { name })).toBeNull();
  }
});
it("first freeze exposes useful preferences but no connections, keys, phone or companion controls", () => {
  render(<GlobalSettings open onOpenChange={() => {}} />);
  expect(screen.queryByText("Connections")).toBeNull();
  expect(screen.queryByText("Practice coach")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Voice devices" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Your API key" })).toBeNull();
  expect(screen.queryByLabelText("Show practice companion")).toBeNull();
  expect(screen.queryByLabelText("Reduce motion")).toBeNull();
});

it("keeps the existing system prompt editable in Context", () => {
  const project = newProject([]);
  project.systemPrompt = "Keep the existing instruction";
  const change = vi.fn();
  render(
    <Workspace
      project={project}
      mode="context"
      onChange={change}
      onMode={() => {}}
      onBack={() => {}}
    />,
  );
  const field = screen.getByLabelText("System prompt") as HTMLTextAreaElement;
  expect(field.value).toBe(project.systemPrompt);
  fireEvent.change(field, { target: { value: "Use concise slide titles" } });
  expect(change.mock.calls.at(-1)?.[0].systemPrompt).toBe(
    "Use concise slide titles",
  );
});
