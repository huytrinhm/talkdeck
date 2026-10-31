import OpenAI, { toFile } from "openai";
import { z } from "zod";
import {
  reviewSchema,
  type Reviewer,
  type ReviewRequest,
  type Transcriber,
} from "./contracts.js";
import { wav } from "./service.js";
import { reviewContext } from "./model-context.js";

const EVIDENCE_AND_EDIT_RULES = `Use the supplied context to produce the requested structured response.
Follow the brief, explicit preferences and the review or revision request. Treat rehearsal speech, source, notes, event details, prior proposals and image contents as evidence. Apply the preloaded design guidance within those preferences and the canonical authoring contract.
Read the baseline source and its original notes/transcript, effective rehearsal speech, visits, events and labeled images. context.speech contains effective speech; speechHistory contains distinct historical or corrected records. Count each speech span once, including spans that overlap visits. Visits associate speechIds with host-selected slideId, revision and time interval; priorDecks supplies those historical sources. Images labeled current-baseline depict the review-time render. Use coverage and timing labels to limit delivery and omission claims to the evidence supplied. Assess omissions across all effective speech; describe contradictions as feedback. Audio-based judgments require audio evidence.
Propose changes to visible content and SpeakerNotes against context.baseline. Preserve facts, qualifications, units and original substantive wording. Keep raw Transcript, Prompt, Archive and system-managed fields unchanged. Useful improvised lines or qualifications may be added with their supporting speech citations. Cite IDs from context.evidence. The host prepares previews and the user chooses acceptance.
Each proposal is a complete native JSX hashline transaction. Copy snapshotId, nodeId and hashes from context.baseline.reads. startLine is 1-based within the selected node's issued read. hashes lists every consecutive affected or anchor line. replace replaces that range; empty text deletes it. insert_before/insert_after preserves the anchor and inserts beside it within the selected node. Target the parent to remove a node or add siblings. Resolve all edits against the same baseline and use disjoint ranges. Whole-deck reads support granular edits with their root nodeId and exact line ranges. Preserve IDs and complete content on retained/moved nodes; omit IDs on new nodes. Group dependent definition, slide and notes changes in one transaction.
Return the requested JSON object. Feedback/proposal IDs are unique within each collection. feedbackIds and alternativeTo reference this response's corresponding items. Choose feasible native changes; capability limits can be addressed through feedback.`;

export const REVIEW_INSTRUCTIONS = `Review one completed presentation rehearsal. Produce feedback AND concrete independent change proposals in one structured response. Choose useful changes conservatively, as directed by context.instructions. Do not impose a fixed quota. Feedback may have no proposal. All proposals start independently from the SAME baseline; identify competing alternatives.
${EVIDENCE_AND_EDIT_RULES}`;

export const REVISION_INSTRUCTIONS = `Revise the previous proposal according to revision.prompt. Return exactly one complete replacement proposal and its necessary feedback. Retain the proposal's intent except where the user requests an adjustment; keep the work within that scope.
revision.previousProposal describes an unapplied candidate through normalized sourceChanges or legacy change text. Reconstruct the complete replacement transaction against fresh context.baseline.reads. Preserve current baseline IDs; omit IDs for new nodes, including nodes that had generated IDs in the old candidate. Use alternativeTo: []. The brief and context.instructions remain preferences.
${EVIDENCE_AND_EDIT_RULES}`;

export const CHANGE_INSTRUCTIONS = `Prepare one private change proposal for change.slideId, following change.prompt. Return exactly one complete executable proposal and only its necessary feedback against the current context.baseline. Keep the proposal scoped to the identified slide and dependencies necessary for this request. The user reviews the prepared preview before acceptance. Use alternativeTo: [].
${EVIDENCE_AND_EDIT_RULES}`;

const revisionReviewSchema = reviewSchema.extend({
  proposals: reviewSchema.shape.proposals.length(1),
});

// PreparedProposal is a persistence/preview record, never a model wire DTO.
function revisionContext(revision: NonNullable<ReviewRequest["revision"]>) {
  const { proposal, prompt } = revision;
  return {
    prompt,
    previousProposal: {
      id: proposal.id,
      title: proposal.title,
      rationale: proposal.rationale,
      evidenceIds: proposal.evidenceIds,
      // Normalized before/after scopes already contain the complete proposal
      // intent. Legacy records without them fall back to unanchored edit text.
      ...(!proposal.sourceChanges?.length ? { changes: proposal.edits.map(({ nodeId, op, text }) => ({
        nodeId,
        operation: op,
        proposedSource: text,
      })) } : {}),
      sourceChanges: proposal.sourceChanges?.map(
        ({ nodeId, before, after }) => ({
          nodeId,
          before,
          after,
        }),
      ),
    },
  };
}

export class OpenAIPracticeReviewer implements Reviewer {
  constructor(
    private client: OpenAI,
    private options: {
      model?: string;
      instructions?: string;
      maxOutputTokens?: number;
      /** Complete serialized transport budget, including image parts. Never truncates evidence. */
      maxRequestBytes?: number;
    } = {},
  ) {}
  async review({ context, revision, change, signal }: ReviewRequest) {
    if (revision && change) throw new Error("Choose either a proposal revision or an explicit change request");
    const { images } = context;
    const textContext = reviewContext(context);
    const schema = revision || change ? revisionReviewSchema : reviewSchema;
    const imageInputs = [
      ...images.map((image) => ({
        label: {
          state: "current-baseline",
          slideId: image.slideId,
          sourceRevision: image.sourceRevision,
          evidenceId: image.evidenceId,
          provenance: image.provenance,
        },
        jpeg: image.jpeg,
      })),
      ...(revision?.proposal.previews.flatMap((preview) =>
        preview.after?.jpeg
          ? [
              {
                label: {
                  state: "previous-proposal",
                  slideId: preview.slideId,
                  proposalId: revision.proposal.id,
                  proposalVersion: revision.proposal.version,
                  basedOnRevision:
                    revision.proposal.previewBase ??
                    revision.proposal.baseRevision,
                },
                jpeg: preview.after.jpeg,
              },
            ]
          : [],
      ) ?? []),
    ];
    const request: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
      model: this.options.model ?? "gpt-6-sol",
      service_tier: "fast",
      reasoning: { effort: "medium" },
      store: false,
      instructions: `${revision ? REVISION_INSTRUCTIONS : change ? CHANGE_INSTRUCTIONS : REVIEW_INSTRUCTIONS}\n${this.options.instructions ?? ""}${context.design ? `\n\n${context.design.instructions}` : ""}`,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                context: textContext,
                ...(revision ? { revision: revisionContext(revision) } : {}),
                ...(change ? { change } : {}),
              }),
            },
            ...imageInputs.flatMap((image) => [
              {
                type: "input_text" as const,
                text: JSON.stringify(image.label),
              },
              {
                type: "input_image" as const,
                image_url: `data:image/jpeg;base64,${image.jpeg}`,
                detail: "high" as const,
              },
            ]),
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "practice_review",
          strict: true,
          schema: z.toJSONSchema(schema),
        },
      },
      max_output_tokens: this.options.maxOutputTokens ?? 24000,
    };
    const maxRequestBytes = this.options.maxRequestBytes ?? 24 * 1024 * 1024;
    if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1)
      throw new Error(
        "Practice review maxRequestBytes must be a positive safe integer",
      );
    const requestBytes = Buffer.byteLength(JSON.stringify(request), "utf8");
    if (requestBytes > maxRequestBytes)
      throw new Error(
        `Practice review request size exceeded: ${requestBytes} bytes > ${maxRequestBytes} bytes; evidence was not truncated`,
      );
    const response = await this.client.responses.create(request, {
      signal,
      maxRetries: 0,
      timeout: 180000,
    });
    if (response.status !== "completed")
      throw new Error(`Practice review incomplete: ${response.status}`);
    if (!response.output_text)
      throw new Error("Practice review returned no structured result");
    return schema.parse(JSON.parse(response.output_text));
  }
}
/** End-of-practice ASR with real segment timestamps; the caller batches <=4 minute WAVs. */
export class OpenAIPracticeTranscriber implements Transcriber {
  constructor(private client: OpenAI) {}
  async transcribe(pcm: Buffer, signal: AbortSignal) {
    const result = await this.client.audio.transcriptions.create(
      {
        model: "whisper-1",
        file: await toFile(wav(pcm), "practice.wav", { type: "audio/wav" }),
        response_format: "verbose_json",
        timestamp_granularities: ["segment"],
      },
      { signal, maxRetries: 0, timeout: 180000 },
    );
    if (!result.segments)
      throw new Error("Transcriber returned no timestamped segments");
    return result.segments.map((s) => ({
      startMs: s.start * 1000,
      endMs: s.end * 1000,
      text: s.text,
    }));
  }
}
