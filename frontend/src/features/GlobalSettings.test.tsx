// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GlobalSettings } from "./GlobalSettings";
import { Workspace } from "./Workspace";
import { blankSlide, newProject } from "../domain/types";
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
it("keeps project settings metadata-only and pauses speech before opening global settings", () => {
  const pause = vi.fn(),
    resume = vi.fn(),
    open = vi.fn();
  vi.spyOn(frontendAdapters, "createSpeech").mockImplementation((o) => ({
    start: () => o.onState?.({ status: "listening", muted: false }),
    stop: vi.fn(),
    pause,
    resume,
    retry: vi.fn(),
    setMuted: vi.fn(),
    dispose: vi.fn(),
  }));
  const project = newProject([]);
  project.slides = [blankSlide("paper")];
  const view = render(
    <Workspace
      project={project}
      mode="edit"
      onChange={() => {}}
      onMode={() => {}}
      onBack={() => {}}
      onAppSettings={open}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Project settings" }));
  expect(screen.getByLabelText("Slide instructions")).toBeTruthy();
  expect(screen.queryByText("Voice input")).toBeNull();
  expect(screen.queryByLabelText("OpenAI API key")).toBeNull();
  view.unmount();
  render(
    <Workspace
      project={project}
      mode="create"
      onChange={() => {}}
      onMode={() => {}}
      onBack={() => {}}
      onAppSettings={open}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "App settings" }));
  expect(screen.getByRole("button", { name: "Resume (P)" })).toBeTruthy();
  expect(open).toHaveBeenCalledTimes(1);
  expect(resume).not.toHaveBeenCalled();
});
it('first freeze exposes useful preferences but no connections, keys, phone or companion controls',()=>{
 render(<GlobalSettings open onOpenChange={()=>{}}/>);expect(screen.queryByText('Connections')).toBeNull();expect(screen.queryByText('Practice coach')).toBeNull();expect(screen.queryByRole('heading',{name:'Voice devices'})).toBeNull();expect(screen.queryByRole('heading',{name:'Your API key'})).toBeNull();expect(screen.queryByLabelText('Show practice companion')).toBeNull();expect(screen.getByLabelText('Reduce motion')).toBeTruthy();
});
