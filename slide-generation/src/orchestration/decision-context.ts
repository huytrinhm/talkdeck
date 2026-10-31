import { Parser } from "acorn";
import jsx from "acorn-jsx";
import type {
  DecisionInput,
  Observation,
  SlowDecisionInput,
  Speech,
} from "./types.js";

const JSXParser = Parser.extend(jsx());
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

// Decision-only projection; never use these spans or this source for edits.
function projectSource(source: string) {
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
      return { source };
    const evidence = root.children.filter(
      (child: any) =>
        child.type === "JSXElement" &&
        ["Transcript", "SpeakerNotes"].includes(child.openingElement.name.name),
    );
    const text = (node: any): string =>
      node.type === "JSXText"
        ? node.value
        : (node.children ?? []).map(text).join("");
    let projected = source;
    for (const child of [...evidence].reverse())
      projected = projected.slice(0, child.start) + projected.slice(child.end);
    return {
      source: projected,
      ...(evidence.length
        ? {
            sourceProjection:
              "Direct Transcript and SpeakerNotes children omitted; evidence supplied separately. Not an edit snapshot.",
            sourceEvidence: evidence.map((child: any) =>
              source.slice(child.start, child.end),
            ),
            comparableNotes: {
              transcript: evidence
                .filter(
                  (child: any) =>
                    child.openingElement.name.name === "Transcript",
                )
                .map((child: any) => source.slice(child.start, child.end))
                .join(""),
              notes: evidence
                .filter(
                  (child: any) =>
                    child.openingElement.name.name === "SpeakerNotes",
                )
                .map(text)
                .join(""),
            },
          }
        : {}),
    };
  } catch {
    // Legacy HTML and unsupported syntax remain intact rather than being regex-rewritten.
    return { source };
  }
}

function speechSnapshot(speech: Speech | null) {
  return (
    speech && {
      slideId: speech.slideId ?? null,
      revision: speech.revision,
      text: speech.text,
    }
  );
}

function speechChange(input: DecisionInput) {
  const baseline = input.lastDispatched;
  if (baseline && baseline.slideId !== input.speech.slideId)
    return {
      kind: "incomparable_slide",
      instruction:
        "Baseline belongs to another slide; do not subtract it from this candidate.",
    };
  if (!baseline) return { kind: "initial", instruction: "All of speech.text is undispatched." };
  if (input.speech.text === baseline.text)
    return { kind: "unchanged", newText: "" };
  if (input.speech.text.startsWith(baseline.text))
    return {
      kind: "append",
      newText: input.speech.text.slice(baseline.text.length),
    };
  return {
    kind: "replacement",
    instruction:
      "Compare candidate and baseline for changed or corrected meaning; this is not an append-only delta.",
  };
}

// Unknown context may contain Buffers too. Strip bytes before JSON.stringify calls toJSON.
function withoutBinary(value: unknown): unknown {
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer)
    return "[binary omitted]";
  if (Array.isArray(value)) return value.map(withoutBinary);
  const object = record(value);
  if (object)
    return Object.fromEntries(
      Object.entries(object).map(([key, item]) => [key, withoutBinary(item)]),
    );
  return value;
}

function evidence(current: Observation | undefined, deck: unknown) {
  const deckObject = record(deck);
  const slides = Array.isArray(deckObject?.slides) ? deckObject.slides : [];
  const slideSources = slides.flatMap((slide) => {
    const item = record(slide);
    return typeof item?.source === "string" ? [item.id] : [];
  });
  const screenshot = current?.screenshot;
  const mimeType = current?.screenshotMimeType ?? "image/png";
  const hasImage =
    !!screenshot?.length &&
    ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mimeType);
  const projected = current ? projectSource(current.source) : undefined;
  const notes = record(deckObject?.notes);
  // The canonical deck context already supplies these exact evidence bodies.
  if (
    projected?.sourceEvidence &&
    notes?.slideId === current?.slideId &&
    notes?.transcript === projected.comparableNotes?.transcript &&
    notes?.notes === projected.comparableNotes?.notes
  )
    delete projected.sourceEvidence;
  if (projected) delete projected.comparableNotes;
  return {
    fields: {
      current: current
        ? {
            id: current.id,
            slideId: current.slideId ?? null,
            sourceRevision: current.sourceRevision,
            visualSourceRevision: current.visualSourceRevision,
            ...projected,
            fastWatermark: current.fastWatermark,
            geometry: current.geometry,
            diagnostics: current.diagnostics,
          }
        : null,
      deck: deck ?? null,
      coverage: {
        currentSource: current
          ? "provided for current.slideId only"
          : "unavailable",
        screenshot: hasImage
          ? {
              status: "attached",
              slideId: current?.slideId ?? null,
              observationId: current?.id,
              mimeType,
              availability: current?.availability?.screenshot,
              sourceRevision: current?.visualSourceRevision,
            }
          : {
              status: "unavailable; no image attached",
              availability: current?.availability?.screenshot,
            },
        geometry:
          current?.availability?.geometry ??
          (current?.geometry.length
            ? "provided"
            : "unavailable or not measured"),
        diagnostics:
          current?.availability?.diagnostics ??
          (current?.diagnostics.length
            ? "provided"
            : "unavailable or no findings; validation coverage unspecified"),
        deck:
          deck === undefined
            ? "unavailable"
            : "Only the supplied fields are available; a slide inventory is not whole-deck source or images.",
        slideSources,
      },
    },
    image: hasImage
      ? {
          type: "input_image" as const,
          image_url: `data:${mimeType};base64,${screenshot!.toString("base64")}`,
          detail: "auto" as const,
        }
      : undefined,
  };
}

function message(fields: unknown, image: ReturnType<typeof evidence>["image"]) {
  return [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text: JSON.stringify(withoutBinary(fields)),
        },
        ...(image ? [image] : []),
      ],
    },
  ];
}

export function speechDecisionContext(input: DecisionInput) {
  const view = evidence(input.current, input.deck);
  return message(
    {
      role: "Speech dispatch gate for Fast, the routine slide-content/edit agent.",
      actionEffects: {
        dispatch:
          "Send this cumulative speech snapshot to Fast for reasoning and advance the dispatch baseline; does not itself edit or prove publication.",
        hold: "Do not dispatch or advance the baseline; retain speech for later evaluation.",
      },
      speechContract:
        "speech.text is the cumulative current transcript for speech.slideId, not a new chunk. lastDispatched is the previous dispatched snapshot for that slide; null means none. Dispatch is not proof its content was published. Revisions order snapshots; timestamps do not measure semantic completeness and are omitted.",
      speech: speechSnapshot(input.speech),
      lastDispatched: speechSnapshot(input.lastDispatched),
      delta: speechChange(input),
      correctionsSinceDispatch: input.speech.corrections.filter(
        (c) =>
          c.revision >
          (input.lastDispatched?.slideId === input.speech.slideId
            ? (input.lastDispatched?.revision ?? 0)
            : 0),
      ),
      speechMode: input.spokenEdits
        ? "Audience content and explicit user editing requests; do not display editing requests as slide content."
        : "Audience-facing narration only, not editing commands.",
      ...view.fields,
      statuses: input.statuses ?? null,
      ...(input.context ? { context: input.context } : {}),
    },
    view.image,
  );
}

export function slowDecisionContext(input: SlowDecisionInput) {
  const view = evidence(input.current, input.deck);
  return message(
    {
      role: "Eligibility gate for Slow, the deck-refinement agent; triggered by unobserved Fast publication(s).",
      actionEffects: {
        wake: "Activate Slow to inspect/refine; no mutation is authorized by this choice alone, and Slow can finish without edits.",
        hold: "Leave Slow idle; retain pending context for reconsideration on a later Fast publication. Explicit tasks can activate Slow independently.",
      },
      ...view.fields,
      lastObservedFastWatermark: input.lastObservedFastWatermark,
      watermarkContract:
        "current.fastWatermark orders Fast publications; lastObservedFastWatermark is the last one Slow observed. These are not transcript revisions or proof that a particular request was fulfilled.",
      speech: speechSnapshot(input.speech),
      speechContract:
        "speech is latest passive cumulative narration, not necessarily the cause or fully represented result of the current publication. Its slideId can differ from current.slideId; never silently retarget it.",
      speechMode: input.spokenEdits
        ? "Spoken input can include explicit editing requests as well as audience content. Stored transcript/notes preserve source evidence; their presence does not prove a requested change is visible."
        : "Narration is audience content, not commands.",
      messages: input.messages,
      statuses: input.statuses ?? null,
      ...(input.context ? { context: input.context } : {}),
    },
    view.image,
  );
}
