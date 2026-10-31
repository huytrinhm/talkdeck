import { describe, it, expect } from "vitest";
import {
  buildRehearsal,
  decideProposal,
  materialFingerprint,
  paceTimeline,
} from "./review";
import { newProject, type Slide, type Proposal } from "./types";
const slide: Slide = {
  id: "s",
  title: "A",
  body: ["One"],
  notes: "",
  layout: "bullets",
  theme: "paper",
};
function fixture() {
  const p = newProject([]);
  p.slides = [structuredClone(slide)];
  const r = buildRehearsal(p.slides, [], 10);
  const proposal: Proposal = {
    id: "p",
    slideId: "s",
    type: "fields",
    title: "Title",
    reason: "Clearer",
    before: structuredClone(slide),
    after: { ...slide, title: "B" },
    fields: ["title"],
    status: "pending",
  };
  r.proposals = [proposal];
  p.rehearsals = [r];
  return { p, r };
}
describe("review decisions", () => {
  it("applies once without mutating snapshot and retains unrelated edits", () => {
    const { p, r } = fixture();
    p.slides[0].notes = "New notes";
    const first = decideProposal(p, r.id, "p", "accepted");
    expect(first.error).toBeUndefined();
    expect(first.project.slides[0]).toMatchObject({
      title: "B",
      notes: "New notes",
    });
    expect(first.project.rehearsals[0].snapshot[0].title).toBe("A");
    expect(
      decideProposal(first.project, r.id, "p", "accepted").error,
    ).toBeTruthy();
  });
  it("refuses stale affected content but allows rejection", () => {
    const { p, r } = fixture();
    p.slides[0].title = "Newer";
    expect(decideProposal(p, r.id, "p", "accepted").error).toBeTruthy();
    expect(
      decideProposal(p, r.id, "p", "rejected").project.rehearsals[0]
        .proposals[0].status,
    ).toBe("rejected");
  });
  it("refuses missing target, order drift and split identity collisions", () => {
    const { p, r } = fixture();
    p.slides = [];
    expect(decideProposal(p, r.id, "p", "accepted").error).toBeTruthy();
    p.slides = [slide];
    r.proposals[0] = {
      ...r.proposals[0],
      type: "reorder",
      baseOrder: ["other"],
      order: ["s"],
    };
    expect(decideProposal(p, r.id, "p", "accepted").error).toBeTruthy();
    r.proposals[0] = { ...r.proposals[0], type: "split", extraSlides: [slide] };
    expect(decideProposal(p, r.id, "p", "accepted").error).toBeTruthy();
  });
  it("does not create suggestions or speech for empty capture", () => {
    const r = buildRehearsal([slide], [], 20);
    expect(r.proposals).toEqual([]);
    expect(r.transcript).toEqual([]);
  });
  it("ties shortening proposals to captured slides only", () => {
    const s = {
      ...slide,
      body: [
        "First point",
        "Second point",
        "Third point",
        "Fourth point",
        "Fifth point",
        "Sixth point",
      ],
    };
    const r = buildRehearsal(
      [s, { ...s, id: "other" }],
      [
        {
          id: "t",
          slideId: "s",
          text: "An actual explanation of the first slide.",
          start: 0,
          end: 5,
        },
      ],
      5,
    );
    expect(r.proposals.every((p) => p.slideId === "s")).toBe(true);
  });
});

describe("captured review rules", () => {
  it("uses exact captured sentences and shortens long supplied text", () => {
    const long = {
      ...slide,
      body: [
        "These are the exact original words that the speaker provided on this slide and they continue for a few additional words.",
      ],
    };
    const title = { ...slide, id: "title", layout: "title" as const, body: [] };
    const transcript = [
      {
        id: "t",
        slideId: "s",
        text: "Actual captured speech.",
        start: 0,
        end: 5,
      },
      {
        id: "t2",
        slideId: "title",
        text: "An exact statement from the speaker.",
        start: 5,
        end: 10,
      },
    ];
    const r = buildRehearsal([long, title], transcript, 10);
    expect(r.proposals).toHaveLength(2);
    expect(r.proposals[1].after.body).toEqual([
      "An exact statement from the speaker.",
    ]);
    expect(r.proposals[0].after.body[0]).toContain("…");
  });
  it("guards changed material dependencies", () => {
    const { p, r } = fixture();
    r.proposals[0].materialFingerprint = materialFingerprint([]);
    p.materials = [
      {
        id: "m",
        name: "New",
        type: "text/plain",
        size: 0,
        blobKey: "new",
        status: "ready",
      },
    ];
    expect(decideProposal(p, r.id, "p", "accepted").error).toContain(
      "Source materials",
    );
  });
  it("applies split exactly once and keeps original snapshot", () => {
    const { p, r } = fixture();
    r.proposals[0] = {
      ...r.proposals[0],
      type: "split",
      extraSlides: [{ ...slide, id: "extra" }],
    };
    const result = decideProposal(p, r.id, "p", "accepted");
    expect(result.error).toBeUndefined();
    expect(result.project.slides.map((s) => s.id)).toEqual(["s", "extra"]);
    expect(result.project.rehearsals[0].snapshot).toHaveLength(1);
    expect(
      decideProposal(result.project, r.id, "p", "accepted").error,
    ).toBeTruthy();
  });
  it("apportions words over phrase timing and retains silence", () => {
    const bars = paceTimeline(
      [
        {
          id: "t",
          slideId: "s",
          text: "one two three four five",
          start: 0,
          end: 5,
        },
      ],
      15,
    );
    expect(bars.map((b) => b.wpm)).toEqual([60, 0, 0]);
    expect(paceTimeline([], 15)).toEqual([]);
  });
});
