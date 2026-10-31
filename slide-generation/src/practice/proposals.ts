import { createVisualDiff } from "./visual-diff.js";
import { SlideEngine } from "../engine.js";
import {
  SourceError,
  type SourceRead,
  type Transaction,
} from "../contracts.js";
import { lineHash } from "../hashline.js";
import { childNodes } from "../schema.js";
import { nodes, parseSource, textContent } from "../parser.js";
import type { createLocalRuntime } from "../runtime.js";
import type {
  PreparedProposal,
  ProposedChange,
  Preview,
  ReviewContext,
} from "./contracts.js";

type Local = Awaited<ReturnType<typeof createLocalRuntime>>;
/** Reissue ONLY server-supplied baseline reads. Snapshot handles never need to survive eviction/restart. */
export function bindTransaction(
  engine: SlideEngine,
  baseline: string,
  reads: SourceRead[],
  proposal: ProposedChange,
): Transaction {
  const bySnapshot = new Map(reads.map((r) => [r.snapshotId, r]));
  const reissued = new Map<string, SourceRead>();
  return {
    edits: proposal.edits.map((edit) => {
      const original = bySnapshot.get(edit.snapshotId);
      if (!original || original.nodeId !== edit.nodeId)
        throw new SourceError(
          "proposal_anchor",
          "Proposal references a read not supplied in review context",
        );
      let current = reissued.get(original.snapshotId);
      if (!current) {
        current = engine.snapshots.read(baseline, original.nodeId);
        reissued.set(original.snapshotId, current);
      }
      if (JSON.stringify(current.lines) !== JSON.stringify(original.lines))
        throw new SourceError(
          "proposal_anchor",
          "Stored baseline anchors are inconsistent",
        );
      return { ...edit, snapshotId: current.snapshotId };
    }),
  };
}
const slides = (source: string) =>
  childNodes(parseSource(source)).filter((n) => n.tag === "Slide");
const notes = (source: string, id: string) => {
  const slide = slides(source).find((s) => s.id === id);
  const note = slide && childNodes(slide).find((n) => n.tag === "SpeakerNotes");
  return note ? textContent(note) : "";
};
async function view(local: Local, source: string, id: string) {
  if (!slides(source).some((s) => s.id === id)) return null;
  const rendered = await local.renderer.render(source, id);
  return {
    artifact: rendered,
    html: rendered.html,
    css: rendered.css,
    notes: notes(source, id),
    jpeg: "",
  };
}
/** Real canonical validation in a private engine; no live writes/publications/history. */
export async function prepareProposal(
  local: Local,
  context: ReviewContext,
  proposal: ProposedChange,
  source: string,
  version = 1,
  signal?: AbortSignal,
): Promise<PreparedProposal> {
  const prepared: PreparedProposal = {
    ...structuredClone(proposal),
    version,
    baseRevision: context.baseline.revision,
    previewBase: lineHash(source),
    status: "invalid",
    previews: [],
    findings: [],
  };
  try {
    signal?.throwIfAborted();
    const fork = local.engine.fork({ schemaVersion: 1, source });
    const result = await fork.edit(
      bindTransaction(
        fork,
        context.baseline.source,
        context.baseline.reads,
        proposal,
      ),
      undefined,
      () => signal?.throwIfAborted(),
    );
    if (!result.accepted) {
      prepared.findings = result.findings;
      prepared.error = "Canonical validation refused this proposal";
      return prepared;
    }
    if (result.noOp) {
      prepared.error = "Proposal makes no change";
      return prepared;
    }
    const candidate = fork.readDocument().source;
    const beforeIds = slides(source).map((s) => s.id!),
      afterIds = slides(candidate).map((s) => s.id!);
    for (const slideId of new Set([...beforeIds, ...afterIds])) {
      signal?.throwIfAborted();
      const before = await view(local, source, slideId),
        after = await view(local, candidate, slideId);
      if (
        JSON.stringify(before && {html:before.html,css:before.css,notes:before.notes,dependencies:before.artifact.dependencies}) === JSON.stringify(after && {html:after.html,css:after.css,notes:after.notes,dependencies:after.artifact.dependencies}) &&
        beforeIds.indexOf(slideId) === afterIds.indexOf(slideId)
      )
        continue;
      // Capture the image and text ranges from exactly the artifact compared above.
      const capture = async (side: NonNullable<typeof before>) => {
        const { artifact, ...visible } = side;
        const captured = await local.browser.captureReview(artifact);
        return { ...visible, jpeg: captured.jpeg, capture: captured };
      };
      const oldSide = before ? await capture(before) : null;
      const newSide = after ? await capture(after) : null;
      prepared.previews.push({ slideId, before: oldSide, after: newSide,
        visualDiff: createVisualDiff({slideId, version, before:oldSide?.capture??null, after:newSide?.capture??null,
          beforeNotes:oldSide?.notes??"", afterNotes:newSide?.notes??"",
          beforeIndex:beforeIds.indexOf(slideId), afterIndex:afterIds.indexOf(slideId)}) });
    }
    signal?.throwIfAborted();
    const beforeNodes = new Map(
      [...nodes(parseSource(source))].map((n) => [n.id!, n]),
    );
    const afterNodes = new Map(
      [...nodes(parseSource(candidate))].map((n) => [n.id!, n]),
    );
    prepared.sourceChanges = [
      ...new Set(proposal.edits.map((e) => e.nodeId)),
    ].map((nodeId) => {
      const before = beforeNodes.get(nodeId),
        after = afterNodes.get(nodeId);
      return {
        nodeId,
        before: before ? source.slice(before.start, before.end) : null,
        after: after ? candidate.slice(after.start, after.end) : null,
      };
    });
    prepared.slideOrder = { before: beforeIds, after: afterIds };
    prepared.candidateSource = candidate;
    prepared.candidateDigest = lineHash(candidate);
    prepared.findings = result.findings;
    prepared.status = "ready";
    // HTML may include source-managed versions/IDs. Conservative mismatches request a refreshed preview.
    prepared.previewSignature = lineHash(
      JSON.stringify({
        sourceChanges: prepared.sourceChanges,
        order: prepared.previews.map((p) => ({
          id: p.slideId,
          before: beforeIds.indexOf(p.slideId),
          after: afterIds.indexOf(p.slideId),
        })),
        previews: prepared.previews.map((p) => ({
          slideId: p.slideId,
          before: p.before && { html:p.before.html, css:p.before.css, notes:p.before.notes,
            renderDigest:p.before.capture?.renderDigest, imageDigest:p.before.capture?.imageDigest,
            geometry:p.before.capture?.geometry, dependencies:p.before.capture?.dependencies },
          after: p.after && { html:p.after.html, css:p.after.css, notes:p.after.notes,
            renderDigest:p.after.capture?.renderDigest, imageDigest:p.after.capture?.imageDigest,
            geometry:p.after.capture?.geometry, dependencies:p.after.capture?.dependencies },
          diff: p.visualDiff && {algorithmVersion:p.visualDiff.algorithmVersion, changes:p.visualDiff.changes},
        })),
      }),
    );
    return prepared;
  } catch (error) {
    signal?.throwIfAborted();
    prepared.error = error instanceof Error ? error.message : String(error);
    return prepared;
  }
}
export function makeReads(engine: SlideEngine, source: string): SourceRead[] {
  const root = parseSource(source);
  const scopes = [
    root,
    ...childNodes(root).filter((n) =>
      ["Slide", "Theme", "Library", "Brief"].includes(n.tag),
    ),
  ];
  if (scopes.length > 256)
    throw new SourceError(
      "review_context_limit",
      "Too many source scopes for a single review; no source was truncated",
    );
  return scopes.map((n) => engine.snapshots.read(source, n.id!));
}
