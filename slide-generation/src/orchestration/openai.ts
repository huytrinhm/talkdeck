import OpenAI from "openai";
import type {
  Decider,
  DecisionInput,
  SlowDecider,
  SlowDecisionInput,
  Model,
  ModelInput,
  ModelResult,
  Role,
  Log,
} from "./types.js";
import { silentLog } from "./types.js";
import { speechDecisionContext, slowDecisionContext } from "./decision-context.js";
const common = `You build a presentation deck of editable 1280x720 slides from audience-facing narration. The user controls the displayed slide. Never speak audibly, advance/select slides, or treat narration as editing instructions. Tasks tagged edit_comment are explicit user editing instructions (push-to-edit), not narration: apply the requested change to that task's slideId, never display the instruction itself. User undo/redo control messages supersede older tasks; never recreate undone changes solely from historical narration or conversation. Stable slide IDs identify targets independently of the selected view. Each model boundary supplies the full deck source and slide-attributed narration; screenshots show the latest two inspected observations. In-flight edits stay bound to their original slide even if the user navigates. Removed IDs cannot be retargeted automatically. Do not invent facts or numbers. Preserve useful design. Use view_slide(slideId) and exact-match edit(slideId,old,new) for local changes. A null slideId means your working slide, not necessarily the displayed one. old must occur exactly once in the source supplied to your inference; use a sufficiently specific fragment. Expand a fragment for insertion; empty new deletes. Multiple calls in one inference operate on its original source plus your own preceding successful edits, NOT unseen concurrent changes. Rejections include current state: reconsider at your next model boundary. Images in your input are actual slide screenshots. Older observation bodies are archived. The latest observation is authoritative; prior tool history is preserved. A tool call is optional. When nothing useful remains, call finish (preferred) or return without tools. Never make a no-op edit or invent an invisible element just to produce a tool call. A tool result requires you to check whether further action is useful, not to edit automatically. No explanatory prose is displayed to the user. Use compact HTML/CSS and SVG, readable typography and intentional hierarchy. No external references except supplied immutable asset URLs, no timers, no numeric animations. Inline registered custom elements are allowed. Visual diagnostics are advisory; source/render validation does not verify facts.`;
const instructions: Record<Role, string> = {
  fast: `${common}\nYou are Fast: low-latency routine content additions and initial composition on your working slide only. Use speech.slideId and workingSlideId; do not copy prior-slide narration into a new slide. Your session continues across navigation. Make small local edits. Show complete meanings even if a trailing claim remains unresolved. Prefer a few useful incremental edits over rebuilding the document. Correct prior claims when narration corrects them. Do not manage specialists, negotiate conflicts, or redesign extensively. The boundary already supplies the current slide; avoid redundant view_slide calls. Prioritize short edit calls and finish quickly. A stale conflict is forwarded to Slow once; do not retry that intent yourself, even with a different old fragment. Once all complete meanings are represented, call finish immediately. Use the finish tool after a successful content update unless there is concrete missing or incorrect content. No-op or cosmetic edit calls are not valid substitutes for finish. Without new speech, only complete unfinished additions or repair factual/validation errors. Never paraphrase an already represented fact, rearrange an existing caption, or duplicate a statistic to polish wording: leave refinement to Slow. Do not respond to routine stylistic coordination messages with edits.`,
  slow: `${common}\nYou are Slow: refine hierarchy, composition, visual explanation and semantic clarity across the whole deck. Later narration can clarify or correct a past slide: use its stable ID and full source from deck context to fix it without navigating the user. Use list_slides/view_slide to inspect as helpful; edit_slides for atomic broader edits, split_slide for an overcrowded slide, or merge_slides for adjacent redundant slides. Structural tools require complete self-contained HTML for each result. Preserve facts and distinctions when splitting/merging; do not invent content. You may edit any region; Fast has no ownership or precedence. Passive speech was sent to Fast for routine additions: adapt only if useful. It does not obligate continuation. Integrate complete private specialist artifacts when useful. Use delegate for focused image/SVG/table/component tasks, send_message for queue-only information, followup_task to request new work, and wait_for when a required result is outstanding. At most two specialists run concurrently. A child completion does not wake you after you finish. Finish only when no valuable refinement or REQUIRED specialist result remains. Do not repeatedly polish an already clear slide. Do not send routine status/ownership messages to Fast, ask it to avoid regions, or ask it to clean up styling. Do not refine tiny wording variations with no audience benefit; prefer finishing. Use messages only for concrete useful facts or rejected intents. Existing boundary source/screenshot is already a view: call view_slide only when a fresh view would help.`,
  specialist: `You create private artifacts for a slide-building parent. Follow the focused task and facts provided. You cannot publish or edit the shared slide. Return a final artifact using save_artifact: SVG image, HTML component including any registration code, CSS, or text. Asset references are immutable. Use image_generate (OpenAI gpt-image-2.5-flare / Flare 2.5, configurable quality and size) for a genuinely useful raster illustration, not for charts with precise numbers. Do not invent factual content. Messages are queued; followup_task requests another turn. A task may finish with explanation only if an artifact is inappropriate.`,
};
export class OpenAIDecider implements Decider {
  constructor(
    private client: OpenAI,
    private model: string,
    private log: Log = silentLog,
  ) {}
  async evaluate(input: DecisionInput, signal: AbortSignal) {
    const start = performance.now();
    const response = await this.client.decisions.create(
      {
        model: this.model,
        input: speechDecisionContext(input),
        questions: [
          {
            type: "choice",
            name: "speech_dispatch",
            instructions:
              "Decide whether the candidate speech warrants Fast reasoning now, not whether to mutate a slide. Compare cumulative speech with lastDispatched and delta; use current visible content as evidence, not stored Transcript/SpeakerNotes as proof of publication. Follow speechMode: explicit editing requests are actionable only in the stated mode, and are never audience content. Dispatch any useful new complete meaning, intelligible topic introduction, meaningful correction, or permitted explicit request. An unresolved tail must not suppress earlier complete ideas. Hold only when no such useful new meaning or request is available. Do not wait for silence or infer completeness from timing. Respect coverage: absent images/diagnostics are not evidence of a blank or validated slide. Previously dispatched content may still be in flight; do not redispatch solely because it is not yet visible.",
            choices: [
              {
                value: "dispatch",
                description:
                  "Enough meaningful new or corrected speech for Fast to consider.",
              },
              {
                value: "hold",
                description:
                  "Only unresolved fragments or repetition; accumulate further.",
              },
            ],
          },
        ],
      },
      { signal, maxRetries: 0 },
    );
    const answer = response.answers.find((a) => a.name === "speech_dispatch");
    this.log.write("decision_api", {
      latencyMs: performance.now() - start,
      revision: input.speech.revision,
      answer,
      usage: response.usage,
    });
    if (
      answer?.type !== "choice" ||
      (answer.choice !== "dispatch" && answer.choice !== "hold")
    )
      throw new Error("Decision API did not return a dispatch/hold choice");
    return answer.choice;
  }
}
export class OpenAIModel implements Model {
  constructor(
    private client: OpenAI,
    private models: Record<Role, string>,
    private log: Log = silentLog,
    private options: { maxOutputTokens?: number } = {},
  ) {}
  async infer(input: ModelInput): Promise<ModelResult> {
    const start = performance.now();
    const response = await this.client.responses.create(
      {
        model: this.models[input.role],
        instructions: input.instructions ?? instructions[input.role],
        input: input.input,
        tools: input.tools,
        parallel_tool_calls: false,
        reasoning: {
          effort:
            input.role === "fast"
              ? "none"
              : input.role === "slow"
                ? "medium"
                : "low",
        },
        service_tier: "fast" as const,
        store: false,
        include: ["reasoning.encrypted_content"],
        max_output_tokens: this.options.maxOutputTokens ?? 12000,
      },
      { signal: input.signal, maxRetries: 0, timeout: 60000 },
    );
    this.log.write("model_response", {
      agent: input.agent,
      latencyMs: performance.now() - start,
      status: response.status,
      serviceTier: response.service_tier,
      output: response.output,
      usage: response.usage,
    });
    if (response.status !== "completed")
      throw new Error(
        `Inference did not complete: ${response.status}; ${JSON.stringify(response.incomplete_details ?? response.error)}`,
      );
    return { output: response.output, usage: response.usage };
  }
}

/** Event-driven refinement eligibility; separate from the 200 ms speech gate. */
export class OpenAISlowDecider implements SlowDecider {
  constructor(
    private client: OpenAI,
    private model: string,
    private log: Log = silentLog,
  ) {}
  async evaluate(input: SlowDecisionInput, signal: AbortSignal) {
    const start = performance.now();
    const current = input.current;
    const response = await this.client.decisions.create(
      {
        model: this.model,
        input: slowDecisionContext(input),
        questions: [
          {
            type: "choice",
            name: "slow_activation",
            instructions:
              "Decide whether waking Slow for refinement reasoning is useful now, not whether to mutate. Inspect only supplied source, attached image, diagnostics, deck fields, passive speech, statuses and queued messages; inventory is not whole-deck source. Follow speechMode: explicit user editing requests may be actionable, but stored transcript/notes are source evidence, not proof of visible fulfillment. Respect slide attribution and coverage; absent diagnostics do not mean validation passed. Fast handles routine additions, including work still in flight. Wake for worthwhile composition, hierarchy, visual explanation, semantic clarity, an unfulfilled permitted request needing Slow, or concrete conflict reconciliation. Later context can justify inspecting a past slide, but do not invent defects in unseen slides. Hold for minor additions, already clear slides, incomplete ideas Fast is developing, or cosmetic wording without audience benefit. A publication or watermark increment alone is not a reason to wake. Slow may inspect further and finish without editing.",
            choices: [
              {
                value: "wake",
                description:
                  "Useful refinement or concrete reconciliation warrants a Slow activation.",
              },
              {
                value: "hold",
                description:
                  "Keep Slow idle until another Fast publication; no worthwhile refinement yet.",
              },
            ],
          },
        ],
      },
      { signal, maxRetries: 0, timeout: 30000 },
    );
    const answer = response.answers.find((a) => a.name === "slow_activation");
    this.log.write("slow_decision_api", {
      latencyMs: performance.now() - start,
      observationId: current.id,
      fastWatermark: current.fastWatermark,
      answer,
      usage: response.usage,
    });
    if (
      answer?.type !== "choice" ||
      (answer.choice !== "wake" && answer.choice !== "hold")
    )
      throw new Error(
        "Decision API did not return a wake/hold choice for Slow",
      );
    return answer.choice;
  }
}
