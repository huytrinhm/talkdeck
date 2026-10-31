import { expect, it } from "vitest";
import { readWorkspace, validWorkspace } from "./validation";
import { blankSlide, newProject } from "./types";
it("upgrades previous saved records to a flat workspace without losing project content", () => {
  const p = newProject([]);
  p.slides = [blankSlide()];
  p.slides[0].notes = "Saved speaker notes";
  p.transcript = [
    {
      id: "spoken",
      slideId: p.slides[0].id,
      text: "Saved narration",
      start: 0,
      end: 2,
    },
  ];
  const previous = {
    version: 2,
    obsoleteOrganization: [{ id: "old" }],
    projects: [{ ...p, obsoleteParent: "old" }],
  };
  const upgraded = readWorkspace(previous);
  expect(upgraded).toEqual({ version: 3, projects: [p] });
  expect(validWorkspace(upgraded)).toBe(true);
  expect(previous.projects[0].obsoleteParent).toBe("old");
});
it("rejects damaged or unknown saved formats before any save", () => {
  expect(() =>
    readWorkspace({ version: 2, projects: [{ id: "broken" }] }),
  ).toThrow(/damaged/);
  expect(() => readWorkspace({ version: 99, projects: [] })).toThrow(/damaged/);
  expect(() => readWorkspace({ version: "3", projects: [] })).toThrow(
    /damaged/,
  );
});
