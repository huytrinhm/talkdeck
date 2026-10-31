import { resolve, relative, isAbsolute } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { createLocalRuntime } from "../runtime.js";
import { JsxBackend } from "../host/jsx-backend.js";
import { SlideRuntime } from "../orchestration/runtime.js";
import {
  OpenAIModel,
  OpenAIDecider,
  OpenAISlowDecider,
} from "../orchestration/openai.js";
import { models } from "../orchestration/config.js";
import { OpenAIPracticeReviewer, OpenAIPracticeTranscriber } from "./openai.js";
import { PracticeService } from "./service.js";
import { createPracticeApp } from "./app.js";
import type { Reviewer, Transcriber } from "./contracts.js";
import type { RuntimeOptions as ActorOptions } from "../orchestration/runtime.js";

export interface PracticeRuntimeOptions {
  directory: string;
  client?: OpenAI;
  reviewer?: Reviewer;
  transcriber?: Transcriber;
  actors?: Pick<ActorOptions, "model" | "decider" | "slowDecider" | "autoTick">;
  reviewInstructions?: string;
}
export async function createPracticeRuntime(options: PracticeRuntimeOptions) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const directory = resolve(options.directory),
    localPath = relative(root, directory);
  if (localPath.startsWith("..") || isAbsolute(localPath))
    throw new Error("Practice storage must remain inside slide-generation/");
  if ((!options.actors || !options.reviewer) && !options.client)
    throw new Error("Supply a client or explicit actor/reviewer adapters");
  const local = await createLocalRuntime({
    directory: joinPath(directory, "deck"),
  });
  let actors: SlideRuntime | undefined;
  try {
    const instructions = await readFile(
      new URL("../../docs/AGENT_PROMPT.md", import.meta.url),
      "utf8",
    );
    const backend = new JsxBackend(local, { instructions });
    const selected = models();
    actors = await SlideRuntime.create({
      backend,
      client: options.client,
      ...(options.actors ?? {
        model: new OpenAIModel(options.client!, selected),
        decider: new OpenAIDecider(options.client!, selected.decision),
        slowDecider: new OpenAISlowDecider(options.client!, selected.decision),
      }),
    });
    const practice = await PracticeService.create({
      directory: joinPath(directory, "practice"),
      local,
      backend,
      actors,
      reviewer:
        options.reviewer ??
        new OpenAIPracticeReviewer(options.client!, {
          instructions: options.reviewInstructions,
        }),
      transcriber:
        options.transcriber ??
        (options.client
          ? new OpenAIPracticeTranscriber(options.client)
          : undefined),
      reviewInstructions: options.reviewInstructions,
    });
    const runningActors = actors;
    return {
      local,
      backend,
      actors,
      practice,
      app: createPracticeApp(practice, actors, backend),
      async close() {
        await practice.close();
        await runningActors.close();
        await local.close();
      },
    };
  } catch (error) {
    await actors?.close();
    await local.close();
    throw error;
  }
}
function joinPath(base: string, name: string) {
  return resolve(base, name);
}
