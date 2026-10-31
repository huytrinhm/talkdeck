import { Parser } from "acorn";
import jsx from "acorn-jsx";
import type {
  DecisionInput,
  Observation,
  SlowDecisionInput,
} from "./types.js";

const JSXParser = Parser.extend(jsx());
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

// Gates decide whether reasoning is useful; they never need executable anchors.
function visibleSource(source: string) {
  try {
    const ast = JSXParser.parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
    }) as any;
    const root = ast.body.length === 1 ? ast.body[0].expression : undefined;
    if (
      root?.type !== "JSXElement" ||
      root.openingElement.name.name !== "Slide"
    )
      return source;
    for (const child of [...root.children].reverse())
      if (
        child.type === "JSXElement" &&
        ["Transcript", "SpeakerNotes"].includes(child.openingElement.name.name)
      )
        source = source.slice(0, child.start) + source.slice(child.end);
    return source;
  } catch {
    return source;
  } // Legacy HTML is not rewritten with JSX assumptions.
}

// The single-slide speech gate needs no routing identity; the host owns it.
function evidence(current?: Observation) {
  const mime = current?.screenshotMimeType ?? "image/png";
  const attached = !!current?.screenshot.length && ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime);
  const availability = current?.availability?.screenshot;
  const imageIssue = attached && availability && !/^(available[;:]|current render$)/i.test(availability)
    ? availability : undefined;
  return {
    fields: {
      ...(!attached ? { image_unavailable: availability ?? "No slide image supplied", ...(current ? { visible_source: visibleSource(current.source) } : {}) } : {}),
      ...(imageIssue ? { image_limitation: imageIssue } : {}),
      ...(current?.diagnostics.length ? { findings: current.diagnostics } : {}),
    },
    image: attached ? { type: "input_image" as const, image_url: `data:${mime};base64,${current!.screenshot.toString("base64")}`, detail: "auto" as const } : undefined,
  };
}

function message(fields: unknown, image: ReturnType<typeof evidence>["image"]) {
  return [
    {
      role: "user" as const,
      content: [
        { type: "input_text" as const, text: JSON.stringify(fields) },
        ...(image ? [image] : []),
      ],
    },
  ];
}

// Static rules and mode belong in the question instructions, not the evidence.
export const SPEECH_GATE_INSTRUCTIONS = `Decide whether newly available speech gives the slide-writing agent useful work now. The presenter is speaking while the agent builds the current slide.
Compare current_transcript with previously_sent_transcript, the last snapshot sent to the agent. Null means this slide has received no dispatch. The transcript is cumulative and may revise earlier wording. correction_context supplies additional recognition corrections when relevant.
Choose dispatch for a useful complete idea, intelligible topic introduction, meaningful correction, or authorized editing request. Choose hold for repetition or unresolved fragments. 'Today we compare' alone is unresolved. A trailing incomplete phrase must allow earlier complete ideas to proceed.
Dispatch sends the cumulative transcript for reasoning and advances the baseline. Hold retains speech for another evaluation. The agent may still be processing previously sent speech. Base dispatch on new meaning or corrections, including while the agent is busy. Each dispatch replaces its pending snapshot.
Use the attached slide image, or visible_source when supplied, as presentation context. Follow any concrete evidence limitations in the request.`;

export const REFINEMENT_GATE_INSTRUCTIONS = `Decide whether the presentation designer should work on the supplied draft now. The content editor handles routine additions from speech. The designer develops the initial composition, hierarchy, visual explanation and deck consistency, and resolves still-relevant failed edits. These agents can work concurrently.
Choose wake for a concrete audience benefit: a meaningful comparison, sequence, focal point, grouping, or supported content needing recovery. A readable draft can still benefit from its first deliberate composition. Preserve intentional design and explicit user preferences. Choose hold when the available content supports only cosmetic churn or incomplete ideas with no useful design work yet.
The attached image or visible_source depicts target_slide_id. current_transcript belongs to this slide; other_slide_speech identifies another slide. slide_inventory locates other slides by title and ID. design_state reports the theme's relation to bootstrap defaults and the shared-definition count. Use the brief, source evidence and image to choose useful work. work_messages can contain failed-edit evidence; check whether the intent still needs recovery.
Wake schedules designer reasoning; the designer chooses its work within its task scope. Hold leaves it idle. Publications, retained failed edits, and one coalesced settling check after unreviewed work permit reevaluation. Explicit tasks can activate the designer independently. The user controls navigation.`;

const speechPolicy = (spokenEdits?: boolean) => spokenEdits
  ? "Speech may contain audience content and explicit user editing requests. Treat editing requests as work to perform; preserve the intended audience content on the slide."
  : "Treat speech as audience-facing narration. Editing instructions arrive through separate tasks.";
export const speechGateInstructions = (input: DecisionInput) => `${SPEECH_GATE_INSTRUCTIONS}\n${speechPolicy(input.spokenEdits)}`;
export const refinementGateInstructions = (input: SlowDecisionInput) => `${REFINEMENT_GATE_INSTRUCTIONS}\n${speechPolicy(input.spokenEdits)}`;

export function speechDecisionContext(input: DecisionInput) {
  const baseline = input.lastDispatched?.slideId === input.speech.slideId ? input.lastDispatched : null;
  // Never accidentally attach a different slide while concealing its attribution.
  const current = input.current?.slideId === input.speech.slideId ? input.current : undefined;
  const view = evidence(current);
  const corrections = input.speech.corrections
    .filter(c => c.revision > (baseline?.revision ?? 0))
    .filter(c => c.before !== c.after && !(c.before === baseline?.text && c.after === input.speech.text))
    .map(({ before, after }) => ({ before, after }));
  return message({
    previously_sent_transcript: baseline?.text ?? null,
    current_transcript: input.speech.text,
    ...(corrections.length ? { correction_context: corrections } : {}),
    ...view.fields,
    ...(input.context ? { brief: input.context } : {}),
  }, view.image);
}

export function slowDecisionContext(input: SlowDecisionInput) {
  const view = evidence(input.current);
  const deck = record(input.deck), slides = deck?.slides, design = record(deck?.designState);
  return message({
    target_slide_id: input.current.slideId ?? null,
    ...view.fields,
    ...(design ? { design_state: { theme: design.theme, sharedDefinitions: design.sharedDefinitions } } : {}),
    ...(input.speech ? input.speech.slideId === input.current.slideId
      ? { current_transcript: input.speech.text }
      : { other_slide_speech: { slideId: input.speech.slideId, text: input.speech.text } } : {}),
    ...(Array.isArray(slides) && slides.length > 1 ? { slide_inventory: slides.map(s => {
      const slide = record(s); return { id: slide?.id, title: slide?.title };
    }) } : {}),
    ...(input.messages.length ? { work_messages: input.messages.map(({ from, text, targetSlideId }) => ({ from, text, targetSlideId })) } : {}),
    ...(input.context ? { brief: input.context } : {}),
  }, view.image);
}
