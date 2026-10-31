// @vitest-environment jsdom
import { afterEach, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { Dashboard, ProjectSetup } from "./Projects";
import { emptyWorkspace, newProject } from "../domain/types";
afterEach(cleanup);
it("shows all projects and preserves create/open actions", () => {
  const project = newProject([]),
    open = vi.fn(),
    create = vi.fn();
  render(
    <Dashboard
      workspace={{ ...emptyWorkspace(), projects: [project] }}
      onChange={() => {}}
      onOpen={open}
      onNew={create}
    />,
  );
  expect(screen.getByRole("heading", { name: "All projects" })).toBeTruthy();
  expect(screen.queryByRole("tree")).toBeNull();
  expect(screen.queryByRole("searchbox")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: `Open ${project.title}` }),
  );
  expect(open).toHaveBeenCalledWith(project.id);
  fireEvent.click(screen.getByRole("button", { name: "New project" }));
  expect(create).toHaveBeenCalledOnce();
});
it("retains project details when creation fails and allows retry", async () => {
  const create = vi
    .fn()
    .mockRejectedValueOnce(new Error("storage unavailable"))
    .mockResolvedValue(undefined);
  render(
    <ProjectSetup
      workspace={emptyWorkspace()}
      onCreate={create}
      onCancel={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "My project" },
  });
  fireEvent.change(screen.getByLabelText(/Description/), {
    target: { value: "Keep this description" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create project" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "Your details and sources are still here",
    ),
  );
  expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe(
    "My project",
  );
  fireEvent.click(screen.getByRole("button", { name: "Create project" }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  expect(create.mock.calls[1][0]).toMatchObject({
    title: "My project",
    description: "Keep this description",
  });
});
