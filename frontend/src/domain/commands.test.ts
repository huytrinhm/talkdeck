import { describe, it, expect } from "vitest";
import { applyUtterance, slideOperation } from "./commands";
import { newProject, blankSlide } from "./types";
const deck = () => ({
  ...newProject([]),
  slides: [
    { ...blankSlide(), title: "Intro" },
    { ...blankSlide(), title: "Costs" },
  ],
});
describe("local utterance routing", () => {
  it("changes the requested slide immutably", () => {
    const p = deck();
    const r = applyUtterance(
      p,
      p.slides[0].id,
      "On slide 2, change the title to Revenue",
      "agent",
      "create",
    );
    expect(r.project.slides[1].title).toBe("Revenue");
    expect(p.slides[1].title).toBe("Costs");
  });
  it("supports explicit presenter edits without generating slides from narration", () => {
    const p = deck(),
      id = p.slides[0].id;
    expect(
      applyUtterance(
        p,
        id,
        "Change the title to Welcome",
        "audience",
        "present",
      ).project.slides[0].title,
    ).toBe("Welcome");
    expect(
      applyUtterance(
        p,
        id,
        "Welcome everyone to our presentation",
        "audience",
        "present",
      ).project,
    ).toBe(p);
  });
  it("does not edit during practice or navigate incidental mentions", () => {
    const p = deck();
    expect(
      applyUtterance(
        p,
        p.slides[0].id,
        "Change the title to Changed",
        "agent",
        "practice",
      ).project,
    ).toBe(p);
    expect(
      applyUtterance(
        p,
        p.slides[0].id,
        "Costs increased this year",
        "audience",
        "present",
      ).selectedId,
    ).toBe(p.slides[0].id);
  });
  it("attributes explanation following navigation to the destination in practice", () => {
    const p = deck();
    const r = applyUtterance(
      p,
      p.slides[0].id,
      "Next slide, these are the costs",
      "audience",
      "practice",
    );
    expect(r.selectedId).toBe(p.slides[1].id);
    expect(r.project).toBe(p);
  });
  it("bounds navigation and preserves identity on reorder", () => {
    const p = deck();
    const id = p.slides[0].id;
    expect(
      applyUtterance(p, id, "Go to slide 9", "audience", "present").message,
    ).toBeTruthy();
    expect(
      applyUtterance(p, id, "Move slide 2 before slide 1", "agent", "create")
        .selectedId,
    ).toBe(id);
  });
  it("freshens clipboard identity and clears cross-project provenance", () => {
    const p = deck();
    p.slides[0].materialRef = { materialId: "m", tableName: "t" };
    const c = slideOperation(p, p.slides[0].id, "copy").clipboard!;
    const target = deck();
    const r = slideOperation(target, target.slides[0].id, "paste", c);
    expect(r.project.slides[1].id).not.toBe(c.slide.id);
    expect(r.project.slides[1].materialRef).toBeUndefined();
    expect(p.slides).toHaveLength(2);
  });
  it("keeps all table rows and refuses ambiguous names", () => {
    const p = deck();
    p.materials = [
      {
        id: "m",
        name: "data",
        blobKey: "m",
        size: 1,
        type: "text/csv",
        status: "ready",
        tables: [
          {
            name: "Customers",
            columns: ["name"],
            rows: Array.from({ length: 50 }, (_, i) => [i]),
          },
        ],
      },
    ];
    const r = applyUtterance(
      p,
      p.slides[0].id,
      "Show the Customers table",
      "agent",
      "create",
    );
    expect(r.project.slides[0].tableData?.rows).toHaveLength(50);
  });
});
