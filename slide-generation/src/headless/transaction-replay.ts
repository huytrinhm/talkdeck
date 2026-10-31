import { z } from "zod";
import { SourceError, type DeckDocument } from "../contracts.js";
import { lineHash } from "../hashline.js";
import { nodes, parseSource, textContent } from "../parser.js";
import { childNodes } from "../schema.js";
import { utteranceSchema } from "../source/ingestion.js";
import {
  RecordedTools,
  assertReplayCompatible,
  compatibilitySchema,
  type ReplayCompatibility,
} from "../evaluation/replay.js";
import type { JsxBackend } from "../host/jsx-backend.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/),
  role = z.enum(["fast", "slow", "specialist"]);
const commitSchema = z
  .object({
    kind: z.literal("commit"),
    sequence: z.number().int().nonnegative(),
    beforeSourceSha: hash,
    afterSourceSha: hash,
    source: z.string(),
    reason: z.enum(["input", "edit"]),
    transactionId: z.string().optional(),
  })
  .passthrough();
const toolSchema = z.object({
  kind: z.literal("tool"),
  name: z.enum(["read_source", "edit_source"]),
  role,
  agent: z.string(),
  slideId: z.string().optional(),
  context: z.unknown(),
  argumentsJson: z.string(),
  resultJson: z.string().optional(),
  errorCode: z.string().optional(),
  sourceSha256: hash,
});
const operationSchema = z.discriminatedUnion("kind", [
  toolSchema,
  z.object({
    kind: z.literal("input"),
    input: utteranceSchema,
    sourceSha256: hash,
  }),
  z.object({
    kind: z.literal("create"),
    title: z.string().optional(),
    slideId: z.string(),
    sourceSha256: hash,
  }),
  z.object({
    kind: z.literal("navigate"),
    slideId: z.string(),
    sourceSha256: hash,
  }),
  z.object({ kind: z.literal("pause"), sourceSha256: hash }),
  z.object({ kind: z.literal("resume"), sourceSha256: hash }),
  z.object({
    kind: z.literal("history"),
    direction: z.enum(["undo", "redo"]),
    selectedSlideId: z.string(),
    sourceSha256: hash,
  }),
]);
export const integratedTransactionCassetteSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.literal("integrated-transaction-replay"),
  provenance: z.enum(["recorded-model", "synthetic-test"]),
  compatibility: compatibilitySchema,
  initial: z.object({ schemaVersion: z.literal(1), source: z.string() }),
  steps: z.array(operationSchema),
  finalSourceSha256: hash,
  coverage: z.object({
    commits: z.number().int().nonnegative(),
    ignoredObservationTools: z.array(z.string()),
  }),
});
export type IntegratedTransactionCassette = z.infer<
  typeof integratedTransactionCassetteSchema
>;
export interface IntegratedRecording {
  initial: DeckDocument;
  compatibility: ReplayCompatibility;
  provenance: "recorded-model" | "synthetic-test";
  commits: unknown[];
  /** Completion logs; commit order is reconstructed from verified source/transaction identities. */
  operations: unknown[];
}
function fail(message: string): never {
  throw new SourceError("replay_recording_incomplete", message);
}
function promptMap(source: string) {
  const result = new Map<string, { text: string; slideId: string }>();
  for (const slide of nodes(parseSource(source)))
    if (slide.tag === "Slide" || slide.tag === "ArchivedSlide")
      for (const prompt of nodes(slide))
        if (prompt.tag === "Prompt")
          result.set(String(prompt.props.utteranceId), {
            text: textContent(prompt),
            slideId: String(
              slide.tag === "Slide" ? slide.id : slide.props.slideId,
            ),
          });
  return result;
}
/** Reconstruct source order from commits, never from overlapping completion timestamps. */
export function buildIntegratedTransactionCassette(
  recording: IntegratedRecording,
): IntegratedTransactionCassette {
  const commits = recording.commits.map((value) => commitSchema.parse(value));
  const states = [recording.initial.source],
    ranks = new Map([[lineHash(recording.initial.source), 0]]);
  const claimed = new Map<number, string>();
  for (const [index, commit] of commits.entries()) {
    if (
      commit.sequence !== index ||
      commit.beforeSourceSha !== lineHash(states[index]) ||
      commit.afterSourceSha !== lineHash(commit.source)
    )
      fail(`Commit ${index} has a broken source/sequence chain`);
    if (ranks.has(commit.afterSourceSha))
      fail(`Commit ${index} reuses an exact source revision`);
    states.push(commit.source);
    ranks.set(commit.afterSourceSha, index + 1);
  }
  const promptStates = states.map(promptMap);
  const slideStates = states.map((source) =>
    childNodes(parseSource(source))
      .filter((node) => node.tag === "Slide")
      .map((node) => node.id),
  );
  const seenInputs = new Map<string, string>();
  const rankOf = (digest: unknown) => {
    const rank = typeof digest === "string" ? ranks.get(digest) : undefined;
    if (rank === undefined)
      fail(
        `Operation refers to an unrecorded source revision: ${String(digest)}`,
      );
    return rank;
  };
  const ranked: {
    rank: number;
    phase: number;
    index: number;
    step: z.infer<typeof operationSchema>;
  }[] = [];
  const ignoredObservationTools: string[] = [];
  const boundarySnapshots = new Set<string>();
  for (const [index, raw] of recording.operations.entries()) {
    if (!raw || typeof raw !== "object")
      fail(`Operation ${index} is not an object`);
    const event = raw as Record<string, any>;
    let rank: number,
      mutation = false,
      step: z.infer<typeof operationSchema>;
    // Preloaded boundary anchors are real issued reads, even without a model
    // read_source call. Replay them at their recorded source revision, including
    // anchors that were already stale when the eventual edit executed.
    for (const key of ["sourceSnapshot", "themeSnapshot"]) {
      const read = event.context?.[key];
      if (!read || boundarySnapshots.has(read.snapshotId)) continue;
      boundarySnapshots.add(read.snapshotId);
      ranked.push({ rank: rankOf(read.revision), phase: 1, index: index - .5,
        step: toolSchema.parse({ kind: "tool", name: "read_source", agent: event.agent,
          role: event.role, slideId: event.slideId, context: event.context,
          argumentsJson: JSON.stringify({ nodeId: read.nodeId }), resultJson: JSON.stringify(read),
          sourceSha256: read.revision }) });
    }
    if (event.kind === "tool") {
      if (!["read_source", "edit_source"].includes(event.name)) {
        if (
          ![
            "read_speaker_notes",
            "list_library",
            "presentation_readiness",
            "render",
            "check",
            "screenshot",
            "palette_report",
            "search_icons",
            "read_icon",
          ].includes(event.name)
        )
          fail(`Unrecognized generation tool ${event.name}`);
        ignoredObservationTools.push(event.name);
        continue;
      }
      const args = event.argumentsJson ?? JSON.stringify(event.arguments);
      const result =
        event.resultJson === undefined
          ? event.result
          : JSON.parse(event.resultJson);
      const errorCode = event.errorCode ?? event.error?.code;
      if (event.name === "read_source" && !errorCode)
        rank = rankOf(result?.revision);
      else if (
        event.name === "edit_source" &&
        result?.accepted === true &&
        !result.noOp
      ) {
        const matches = commits
          .map((commit, i) => ({ commit, rank: i + 1 }))
          .filter((v) => v.commit.transactionId === result.transactionId);
        if (matches.length !== 1)
          fail(
            `Accepted transaction ${result.transactionId} does not identify one commit`,
          );
        rank = matches[0].rank;
        mutation = true;
        if (
          result.revision !== commits[rank - 1].afterSourceSha ||
          result.source?.revision !== result.revision
        )
          fail(`Accepted edit ${index} has inconsistent result revisions`);
      } else rank = rankOf(result?.revision ?? event.sourceSha256);
      step = toolSchema.parse({
        kind: "tool",
        name: event.name,
        role: event.role,
        agent: event.agent,
        slideId: event.slideId,
        context: event.context,
        argumentsJson: args,
        resultJson: result === undefined ? undefined : JSON.stringify(result),
        errorCode,
        sourceSha256: lineHash(states[rank]),
      });
    } else if (event.kind === "input") {
      const input = utteranceSchema.parse(event.input);
      const matches = commits
        .map((commit, i) => ({ commit, rank: i + 1 }))
        .filter(
          ({ rank }) =>
            !promptStates[rank - 1].has(input.id) &&
            promptStates[rank].has(input.id),
        );
      if (matches.length !== 1 || matches[0].commit.reason !== "input")
        fail(`Input ${input.id} does not identify one durable evidence commit`);
      rank = matches[0].rank;
      mutation = true;
      const retained = promptStates[rank].get(input.id)!;
      if (retained.text !== input.text || retained.slideId !== input.slideId)
        fail(`Input ${input.id} changed text or attribution`);
      const prior = seenInputs.get(input.id);
      if (prior !== undefined) {
        if (prior !== JSON.stringify(input))
          fail(`Duplicate input ${input.id} changed payload`);
        rank = rankOf(event.sourceSha256);
        mutation = false;
      } else seenInputs.set(input.id, JSON.stringify(input));
      step = operationSchema.parse({
        kind: "input",
        input,
        sourceSha256: lineHash(states[rank]),
      });
    } else if (event.kind === "create") {
      const matches = commits
        .map((commit, i) => ({ commit, rank: i + 1 }))
        .filter(
          ({ rank }) =>
            !slideStates
              .slice(0, rank)
              .some((ids) => ids.includes(event.slideId)) &&
            slideStates[rank].includes(event.slideId),
        );
      if (matches.length !== 1)
        fail(`Created slide ${event.slideId} does not identify one commit`);
      rank = matches[0].rank;
      mutation = true;
      step = operationSchema.parse({
        kind: "create",
        title: event.title,
        slideId: event.slideId,
        sourceSha256: lineHash(states[rank]),
      });
    } else {
      rank = rankOf(event.sourceSha256);
      mutation = event.kind === "history";
      step = operationSchema.parse(event);
    }
    if (mutation) {
      if (rank === 0 || claimed.has(rank))
        fail(`Commit ${rank} has multiple or invalid operation owners`);
      claimed.set(rank, `${event.kind}:${index}`);
    }
    ranked.push({ rank, phase: mutation ? 0 : 1, index, step });
  }
  for (let rank = 1; rank <= commits.length; rank++)
    if (!claimed.has(rank))
      fail(
        `Commit ${rank} has no recorded input, transaction or host operation`,
      );
  ranked.sort(
    (a, b) => a.rank - b.rank || a.phase - b.phase || a.index - b.index,
  );
  return integratedTransactionCassetteSchema.parse({
    schemaVersion: 1,
    mode: "integrated-transaction-replay",
    provenance: recording.provenance,
    compatibility: recording.compatibility,
    initial: recording.initial,
    steps: ranked.map((v) => v.step),
    finalSourceSha256: lineHash(states.at(-1)!),
    coverage: { commits: commits.length, ignoredObservationTools },
  });
}

/** Execute original source operations through the real backend; no actor or provider fallback. */
export async function replayIntegratedTransactions(
  input: unknown,
  backend: JsxBackend,
  compatibility: ReplayCompatibility,
) {
  const cassette = integratedTransactionCassetteSchema.parse(input);
  assertReplayCompatible(cassette.compatibility, compatibility, "transaction");
  const engine = backend.runtime.engine;
  if (engine.readDocument().source !== cassette.initial.source)
    throw new SourceError(
      "replay_initial_mismatch",
      "Initialize the exact recorded source before integrated replay",
    );
  let active: z.infer<typeof toolSchema> | undefined;
  const controller = new AbortController();
  const toolSteps = cassette.steps.filter(
    (step): step is z.infer<typeof toolSchema> => step.kind === "tool",
  );
  const tools = new RecordedTools(
    toolSteps.map((step) => ({
      name: step.name,
      argumentsJson: step.argumentsJson,
      resultJson: step.resultJson,
      errorCode: step.errorCode,
    })),
    async (name, args) => {
      if (!active) throw new Error("Replay tool context missing");
      return (
        await backend.generation.invoke(
          {
            agent: active.agent,
            role: active.role,
            slideId: active.slideId,
            inferenceId: "transaction-replay",
            signal: controller.signal,
            context: active.context,
          },
          name,
          args,
        )
      ).output;
    },
  );
  for (const [index, step] of cassette.steps.entries()) {
    if (step.kind === "tool") {
      active = step;
      try {
        await tools.invoke(step.name, step.argumentsJson);
      } catch (error) {
        if (!(error instanceof SourceError) || error.code !== step.errorCode)
          throw error;
      } finally {
        active = undefined;
      }
    } else if (step.kind === "input")
      await backend.deliverUtterance(step.input);
    else if (step.kind === "create") {
      const created = await backend.createSlide(step.title);
      if (created.id !== step.slideId)
        throw new SourceError(
          "replay_slide_mismatch",
          "Canonical slide allocation differs",
        );
    } else if (step.kind === "navigate") await backend.navigate(step.slideId);
    else if (step.kind === "pause" || step.kind === "resume")
      backend.setPaused(step.kind === "pause");
    else {
      const restored = await backend.restoreHistory(step.direction);
      if (
        restored.outcome !== "restored" ||
        restored.selectedId !== step.selectedSlideId
      )
        throw new SourceError(
          "replay_history_mismatch",
          "Canonical history restoration differs",
        );
    }
    if (lineHash(engine.readDocument().source) !== step.sourceSha256)
      throw new SourceError(
        "replay_source_mismatch",
        `Integrated step ${index} differs from recorded canonical source`,
      );
  }
  tools.assertConsumed();
  const final = lineHash(engine.readDocument().source);
  if (final !== cassette.finalSourceSha256)
    throw new SourceError(
      "replay_final_mismatch",
      "Integrated replay final source differs",
    );
  return {
    mode: cassette.mode,
    provenance: cassette.provenance,
    sourceSha256: final,
    steps: cassette.steps.length,
    coverage: cassette.coverage,
    snapshots: tools.snapshots.entries(),
    transactions: tools.transactions(),
    actorReplay: false as const,
  };
}
