import { Parser } from "acorn";
import jsx from "acorn-jsx";
import type { Observation } from "./types.js";
const JSXParser = Parser.extend(jsx());

/** Model-facing projection only. Runtime guards, logs and replay retain raw state. */
const object = (value: unknown): Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

export const taskContext = (tasks: unknown[]) => tasks.map(value => {
  const { id: _id, ...task } = object(value);
  if (task.facts === "Explicit user editing instruction; do not insert the instruction itself as slide content.") delete task.facts;
  return task;
});
export const messageContext = (messages: unknown[]) => messages.map(value => {
  const { id: _id, to: _to, ...message } = object(value);
  return message;
});

function notesInObservation(notes: any, observation?: Observation) {
  if (!notes || !observation || notes.slideId !== observation.slideId)
    return false;
  try {
    // Inspection-only parsing also accepts a Slide subtree with external
    // definition names. The canonical parser deliberately requires a full Deck.
    const ast = JSXParser.parse(observation.source, {
      ecmaVersion: "latest",
      sourceType: "module",
    }) as any;
    const slide = ast.body.length === 1 ? ast.body[0].expression : undefined;
    if (
      slide?.type !== "JSXElement" ||
      slide.openingElement.name.name !== "Slide"
    )
      return false;
    const children = slide.children.filter(
      (node: any) => node.type === "JSXElement",
    );
    const transcript = children.find(
      (node: any) => node.openingElement.name.name === "Transcript",
    );
    const speakerNotes = children.find(
      (node: any) => node.openingElement.name.name === "SpeakerNotes",
    );
    return (
      !!transcript &&
      !!speakerNotes &&
      observation.source.slice(transcript.start, transcript.end) ===
        notes.transcript &&
      speakerNotes.children.every((child: any) => child.type === "JSXText") &&
      speakerNotes.children.map((child: any) => child.value).join("") ===
        notes.notes
    );
  } catch {
    return false;
  }
}

export function actorContext(
  raw: Record<string, unknown>,
  observation?: Observation,
) {
  const recipient = object(raw.recipient),
    deck = object(raw.deck);
  const delivery = object(raw.speechDelivery),
    speech = object(raw.speech);
  const specialist = recipient.role === "specialist";
  const tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
  const statuses = Array.isArray(raw.statuses) ? raw.statuses : [];
  const activeTasks = Array.isArray(raw.activeTasks) ? raw.activeTasks : tasks;
  const children = statuses.filter(s => s.role === "specialist");
  const design = object(deck.designState);
  return {
    kind: "current_boundary",
    ...(specialist ? { recipient: { parentId: recipient.parentId } } : {}),
    ...(activeTasks.length ? { activeTasks: taskContext(activeTasks) } : {}),
    ...(tasks.length ? { newTaskCount: tasks.length } : {}),
    workingSlideId: raw.workingSlideId,
    ...(raw.context ? { brief: raw.context } : {}),
    ...(!specialist
      ? {
          deck: {
            // The inventory locates other slides; it does not imply they were read.
            slides: deck.slides,
            ...(deck.sourceSnapshot ? { sourceSnapshot: deck.sourceSnapshot } : {}),
            ...(deck.themeSnapshot ? { themeSnapshot: deck.themeSnapshot } : {}),
            ...(deck.designState ? { designState: { theme: design.theme, sharedDefinitions: design.sharedDefinitions } } : {}),
            // The complete source observation already includes these exact bodies.
            ...(!notesInObservation(deck.notes, observation)
              ? { notes: deck.notes }
              : {}),
          },
          speech: raw.speech
            ? {
                slideId: speech.slideId,
                text: speech.text,
                ...(speech.corrections?.length
                  ? {
                      corrections: speech.corrections.map(
                        ({ before, after }: any) => ({ before, after }),
                      ),
                    }
                  : {}),
              }
            : null,
          speechDelivery: {
            kind: delivery.kind,
            delta: delivery.delta,
            ...(delivery.previousSlideId !== delivery.slideId
              ? { previousSlideId: delivery.previousSlideId }
              : {}),
          },
        }
      : {}),
    ...(Array.isArray(raw.messages) && raw.messages.length ? { messages: messageContext(raw.messages) } : {}),
    ...(recipient.role === "slow" && children.length
      ? {
          specialists: children
            .map(({ id, state, error }) => ({
              id,
              state,
              ...(error ? { error } : {}),
              resultRequired:
                Array.isArray(raw.requiredResults) &&
                raw.requiredResults.includes(id),
            })),
        }
      : {}),
    ...(Array.isArray(raw.assetRefs) && raw.assetRefs.length
      ? { assetRefs: raw.assetRefs }
      : {}),
  };
}

export const ACTOR_CONTEXT_INSTRUCTIONS = `# Your context
You are building a presentation from live speech. Fast writes content promptly; Slow develops the design; specialists produce focused deliverables for Slow. The user controls navigation.
workingSlideId identifies your task target. activeTasks contains the explicit assignments for the current working slide; queued assignments for other slides arrive at separate boundaries. newTaskCount identifies new assignments at the end of that list. Continue the active assignments across tool calls and follow their scope, including inspect-only requests. Messages supply facts, coordination and results. Undo/redo control messages supersede earlier work.
For editors, speech contains cumulative speaker evidence. speechDelivery identifies newly supplied wording or a replacement since your previous inference. Use the current source and tool outcomes to determine remaining work. deck.slides locates slides. deck.sourceSnapshot supplies issued editable anchors for the working slide; deck.themeSnapshot does so for the theme when supplied. Use these directly, without a redundant read_source call. Read other nodes only when needed. Source observations include its transcript and notes, with additional notes extracts supplied when necessary.
Use issued read_source/edit_source snapshots for exact editing anchors. Inspect attached images and actionable findings. designState reports source-level theme defaults and definition counts; use the brief and user preferences to establish styling intent.
For the designer, specialists lists child status and resultRequired. Wait for required results, inspect them, and integrate useful work. Give each specialist a self-contained task with the necessary facts and style constraints. Private artifact references require canonical asset registration before source integration.`;
