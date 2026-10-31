import {
  uid,
  type Material,
  type Project,
  type Proposal,
  type Rehearsal,
  type Slide,
  type TranscriptSegment,
} from "./types";
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export const wordCount = (text: string) =>
  text.trim().split(/\s+/u).filter(Boolean).length;
export const clarityMatches = (text: string) =>
  Array.from(
    text.matchAll(
      /\b(this thing|that thing|usual stuff|usual way|it just works|and all that|and so on|somehow|stuff|kind of|sort of|this part|over here)\b/gi,
    ),
  )
    .slice(0, 3)
    .map((m) => ({ text: m[0], index: m.index! }));
export const materialFingerprint = (materials: Material[]) =>
  JSON.stringify(
    materials.map((m) => ({
      id: m.id,
      blobKey: m.blobKey,
      text: m.text,
      tables: m.tables,
      status: m.status,
    })),
  );
export function buildRehearsal(
  snapshot: Slide[],
  transcript: TranscriptSegment[],
  elapsed: number,
  materials: Material[] = [],
): Rehearsal {
  const safe = structuredClone(snapshot),
    capture = structuredClone(transcript),
    proposals: Proposal[] = [];
  for (const slide of safe) {
    if (!capture.some((t) => t.slideId === slide.id && wordCount(t.text)))
      continue;
    const spoken = capture
      .filter((t) => t.slideId === slide.id)
      .map((t) => t.text.trim())
      .filter(Boolean);
    if (slide.body.some((line) => wordCount(line) > 14)) {
      const after = {
        ...structuredClone(slide),
        body: slide.body.map((line) =>
          wordCount(line) > 14
            ? line.trim().split(/\s+/u).slice(0, 14).join(" ") + "…"
            : line,
        ),
      };
      proposals.push({
        id: uid(),
        slideId: slide.id,
        type: "fields",
        title: "Shorten the on-slide text",
        reason:
          "Keep the first fourteen words of long points on the slide. Review the preview to ensure the shortened wording still conveys your meaning.",
        before: structuredClone(slide),
        after,
        fields: ["body"],
        status: "pending",
        materialFingerprint: slide.materialRef
          ? materialFingerprint(materials)
          : undefined,
      });
    }
    if (
      slide.layout === "title" &&
      slide.body.length === 0 &&
      spoken.some((text) => text.toLowerCase() !== slide.title.toLowerCase())
    ) {
      const lines =
        spoken
          .join(" ")
          .match(/[^.!?]+[.!?]?/g)
          ?.map((text) => text.trim())
          .filter((text) => wordCount(text) >= 3)
          .slice(0, 4) ?? [];
      if (lines.length)
        proposals.push({
          id: uid(),
          slideId: slide.id,
          type: "fields",
          title: "Bring your explanation onto the slide",
          reason:
            "Use these exact captured phrases as visible points. Review the transcript wording before approving.",
          before: structuredClone(slide),
          after: { ...structuredClone(slide), layout: "bullets", body: lines },
          fields: ["layout", "body"],
          status: "pending",
          materialFingerprint: slide.materialRef
            ? materialFingerprint(materials)
            : undefined,
        });
    }
    if (slide.body.length > 5) {
      const half = Math.ceil(slide.body.length / 2);
      const after = {
        ...structuredClone(slide),
        body: slide.body.slice(0, half),
      };
      proposals.push({
        id: uid(),
        slideId: slide.id,
        type: "split",
        title: "Give these points more room",
        reason:
          "This slide contains more than five points. Split the existing content across two slides to make it easier to follow.",
        before: structuredClone(slide),
        after,
        fields: ["body"],
        extraSlides: [
          {
            ...structuredClone(slide),
            id: uid(),
            title: `${slide.title} — continued`,
            body: slide.body.slice(half),
          },
        ],
        status: "pending",
        materialFingerprint: slide.materialRef
          ? materialFingerprint(materials)
          : undefined,
      });
    }
  }
  return {
    id: uid(),
    snapshot: safe,
    transcript: capture,
    elapsed: Math.max(0, elapsed),
    proposals,
    createdAt: Date.now(),
  };
}
export function decideProposal(
  project: Project,
  rehearsalId: string,
  proposalId: string,
  decision: "accepted" | "rejected",
): { project: Project; error?: string } {
  const session = project.rehearsals.find((r) => r.id === rehearsalId),
    p = session?.proposals.find((p) => p.id === proposalId);
  const fail = (error: string) => ({ project, error });
  if (!p || !session)
    return fail(
      "This suggestion is no longer available. Return to slides and practice again.",
    );
  if (p.status !== "pending")
    return fail("This suggestion has already been decided.");
  const target = project.slides.find((s) => s.id === p.slideId);
  if (decision === "accepted") {
    if (!target)
      return fail(
        "The original slide was removed. Reject this suggestion or practice again.",
      );
    if (p.fields.some((key) => !equal(target[key], p.before[key])))
      return fail(
        "The affected slide content changed after practice. Reject this suggestion or practice again.",
      );
    if (
      p.materialFingerprint !== undefined &&
      p.materialFingerprint !== materialFingerprint(project.materials)
    )
      return fail(
        "Source materials changed after practice. Reject this suggestion or practice again.",
      );
    if (
      p.type === "reorder" &&
      (!p.baseOrder ||
        !equal(
          p.baseOrder,
          project.slides.map((s) => s.id),
        ) ||
        !p.order ||
        p.order.length !== project.slides.length ||
        new Set(p.order).size !== p.order.length ||
        p.order.some((id) => !project.slides.some((s) => s.id === id)))
    )
      return fail(
        "The slide order changed or the proposed order is incomplete. Practice again.",
      );
    if (
      p.type === "split" &&
      (!p.extraSlides?.length ||
        p.extraSlides.some((s) =>
          project.slides.some((live) => live.id === s.id),
        ) ||
        new Set(p.extraSlides.map((s) => s.id)).size !== p.extraSlides.length ||
        !equal(target, p.before))
    )
      return fail(
        "The split conflicts with newer slide content. Reject this suggestion or practice again.",
      );
  }
  const next = structuredClone(project),
    r = next.rehearsals.find((r) => r.id === rehearsalId)!,
    proposal = r.proposals.find((p) => p.id === proposalId)!;
  if (decision === "accepted") {
    const index = next.slides.findIndex((s) => s.id === p.slideId);
    if (p.type === "reorder")
      next.slides = p.order!.map((id) => next.slides.find((s) => s.id === id)!);
    else {
      for (const key of p.fields)
        Object.assign(next.slides[index], {
          [key]: structuredClone(p.after[key]),
        });
      if (p.type === "split")
        next.slides.splice(index + 1, 0, ...structuredClone(p.extraSlides!));
    }
  }
  proposal.status = decision;
  next.updatedAt = Date.now();
  return { project: next };
}
export function paceTimeline(transcript: TranscriptSegment[], elapsed: number) {
  if (elapsed <= 0 || !transcript.some((t) => wordCount(t.text))) return [];
  const window = Math.max(5, Math.ceil(elapsed / 40));
  const result: { start: number; end: number; wpm: number }[] = [];
  for (let start = 0; start < elapsed; start += window) {
    let end = Math.min(elapsed, start + window);
    if (elapsed - end < window / 3) end = elapsed;
    let words = 0;
    for (const t of transcript) {
      const duration = t.end - t.start;
      if (duration > 0)
        words +=
          (wordCount(t.text) *
            Math.max(0, Math.min(end, t.end) - Math.max(start, t.start))) /
          duration;
      else if (t.start >= start && t.start < end) words += wordCount(t.text);
    }
    result.push({ start, end, wpm: Math.round((words * 60) / (end - start)) });
    if (end === elapsed) break;
  }
  return result;
}
