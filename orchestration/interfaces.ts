/** Public orchestration API. All versions/watermarks are runtime bookkeeping. */
export { SlideRuntime, type RuntimeOptions } from "./src/runtime.js";
export {
  Publisher,
  type Edit,
  type EditResult,
  type SlideRecord,
  type DeckSnapshot,
  type StructureResult,
  type HistoryResult,
} from "./src/publisher.js";
export { AssetStore } from "./src/assets.js";
export { ChromiumRenderer } from "./src/renderer.js";
export { OpenAIDecider, OpenAISlowDecider, OpenAIModel } from "./src/openai.js";
export {
  LiveTranscription,
  TranscriptAccumulator,
  readWav,
} from "./src/transcription.js";
export type {
  Speech,
  Correction,
  Observation,
  Diagnostic,
  Geometry,
  Event,
  State,
  Role,
  Model,
  ModelInput,
  ModelResult,
  Decider,
  SlowDecider,
  SlowDecisionInput,
  DecisionInput,
  Renderer,
  Rendered,
  Message,
  Task,
  Log,
} from "./src/types.js";
