import { beforeEach, it, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("idb", () => ({ openDB: mock.open }));
import { WorkspaceRepository } from "./repository";
import { emptyWorkspace } from "../domain/types";
beforeEach(() => mock.open.mockReset());
it("returns a blank workspace only for absent data and propagates failed reads", async () => {
  mock.open.mockResolvedValue({ get: vi.fn().mockResolvedValue(undefined) });
  expect(await new WorkspaceRepository().load()).toEqual(emptyWorkspace());
  mock.open.mockResolvedValue({
    get: vi.fn().mockRejectedValue(new Error("storage denied")),
  });
  await expect(new WorkspaceRepository().load()).rejects.toThrow(
    "storage denied",
  );
});
it("awaits transaction completion so a failed commit cannot report success", async () => {
  const done = Promise.reject(new Error("quota exceeded"));
  done.catch(() => {});
  mock.open.mockResolvedValue({
    transaction: () => ({
      store: { put: vi.fn().mockResolvedValue("current") },
      done,
    }),
  });
  await expect(
    new WorkspaceRepository().save(emptyWorkspace()),
  ).rejects.toThrow("quota exceeded");
});
it("retries opening storage after a failed open", async () => {
  mock.open
    .mockRejectedValueOnce(new Error("temporarily blocked"))
    .mockResolvedValueOnce({ get: vi.fn().mockResolvedValue(undefined) });
  const repository = new WorkspaceRepository();
  await expect(repository.load()).rejects.toThrow();
  expect(await repository.load()).toEqual(emptyWorkspace());
});
it("rejects malformed project data instead of rendering or overwriting it", async () => {
  mock.open.mockResolvedValue({
    get: vi
      .fn()
      .mockResolvedValue({
        version: 2,
        folders: [],
        projects: [{ id: "broken" }],
      }),
  });
  await expect(new WorkspaceRepository().load()).rejects.toThrow(/damaged/);
});
