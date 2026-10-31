import { z } from "zod";
import {
  transactionSchema,
  type SourceRead,
  type Finding,
} from "../contracts.js";

const id = z.string().min(1).max(256),
  text = z.string().max(100_000);
export const reviewSchema = z
  .object({
    summary: text,
    feedback: z
      .array(
        z
          .object({
            id,
            observation: text,
            suggestion: text,
            evidenceIds: z.array(id),
          })
          .strict(),
      )
      .max(100),
    proposals: z
      .array(
        z
          .object({
            id,
            title: text,
            rationale: text,
            feedbackIds: z.array(id),
            evidenceIds: z.array(id),
            edits: transactionSchema.shape.edits,
            alternativeTo: z.array(id),
          })
          .strict(),
      )
      .max(64),
  })
  .strict();
export type ReviewOutput = z.infer<typeof reviewSchema>;
export type ProposedChange = ReviewOutput["proposals"][number];
export interface SpeechSpan {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  correctionOf?: string;
  timing: "aligned" | "receipt";
  slideId?: string;
}
export interface PracticeEvent {
  id: string;
  type:
    | "slide_selected"
    | "deck_changed"
    | "pause"
    | "resume"
    | "edit_command"
    | "undo"
    | "redo";
  atMs: number;
  slideId: string;
  revision: string;
  detail?: unknown;
}
export interface AudioChunk {
  sequence: number;
  startMs: number;
  endMs: number;
  file: string;
  sha256: string;
  bytes: number;
}
export interface Visit {
  id: string;
  slideId: string;
  revision: string;
  startMs: number;
  endMs: number;
  speechIds: string[];
}
export interface SlideImage {
  slideId: string;
  sourceRevision: string;
  jpeg: string;
}
export interface ReviewContext {
  /** Exact compiled guidance, frozen with evidence; absent on pre-skill records. */
  design?: import("../design/skills.js").DesignContext;
  version: 1;
  practiceId: string;
  instructions: string;
  brief: Record<string, string | number>;
  baseline: { revision: string; source: string; reads: SourceRead[] };
  slides: { id: string; notes: string; originalTranscript: string }[];
  speech: SpeechSpan[];
  speechHistory: SpeechSpan[];
  events: PracticeEvent[];
  visits: Visit[];
  priorDecks: { revision: string; source: string }[];
  measurements: {
    id: string;
    durationMs: number;
    pausedMs: number;
    wordCount: number;
    approximateWordsPerMinute: number | null;
    caveat: string;
  };
  images: SlideImage[];
  evidence: {
    id: string;
    kind: "source" | "speech" | "event" | "visit" | "measurement";
    revision?: string;
  }[];
}
export interface PreviewSide {
  html: string; css: string; notes: string; jpeg: string;
  capture?: import("../browser/review-capture.js").ReviewCapture;
}
export interface Preview {
  slideId: string;
  before: PreviewSide | null;
  after: PreviewSide | null;
  visualDiff?: import("./visual-diff.js").VisualDiff;
}
export interface PreparedProposal extends ProposedChange {
  status:
    "ready" | "invalid" | "stale" | "accepted" | "rejected" | "superseded";
  version: number;
  baseRevision: string;
  candidateSource?: string;
  candidateDigest?: string;
  previewBase?: string;
  previews: Preview[];
  findings: Finding[];
  error?: string;
  acceptedRevision?: string;
  acceptanceIntent?: { candidateDigest: string; expectedRevision: string };
  // Fingerprints of user-observable preview semantics, excluding unrelated deck content.
  previewSignature?: string;
  sourceChanges?: {
    nodeId: string;
    before: string | null;
    after: string | null;
  }[];
  slideOrder?: { before: string[]; after: string[] };
}
export interface PracticeRecord {
  version: 1;
  id: string;
  startedAt: string;
  brief: Record<string, string | number>;
  status: "recording" | "processing" | "ready" | "failed" | "cancelled";
  endedAtMs?: number;
  baseline?: { source: string; revision: string };
  events: PracticeEvent[];
  speech: SpeechSpan[];
  audio: AudioChunk[];
  sources: Record<string, string>;
  context?: ReviewContext;
  review?: ReviewOutput;
  proposals: PreparedProposal[];
  error?: string;
  attempts: number;
  changeRequest?: { slideId: string; prompt: string };
  revisionRequest?: {
    practiceId: string;
    proposal: PreparedProposal;
    prompt: string;
  };
}
export interface ReviewRequest {
  context: ReviewContext;
  revision?: { proposal: PreparedProposal; prompt: string };
  change?: { slideId: string; prompt: string };
  signal: AbortSignal;
}
export interface Reviewer {
  review(request: ReviewRequest): Promise<ReviewOutput>;
}
export interface Transcriber {
  transcribe(
    pcm: Buffer,
    signal: AbortSignal,
  ): Promise<{ startMs: number; endMs: number; text: string }[]>;
}
