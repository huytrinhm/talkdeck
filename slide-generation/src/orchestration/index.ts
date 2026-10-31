/** Public orchestration API. All versions/watermarks are runtime bookkeeping. */
export { SlideRuntime, type RuntimeOptions } from "./runtime.js";
export {
  Publisher,
  type Edit,
  type EditResult,
  type SlideRecord,
  type DeckSnapshot,
  type StructureResult,
  type HistoryResult,
} from "./publisher.js";
export { AssetStore } from "./assets.js";
export { ChromiumRenderer } from "./renderer.js";
export { OpenAIDecider, OpenAISlowDecider, OpenAIModel } from "./openai.js";
export {
  LiveTranscription,
  TranscriptAccumulator,
  readWav,
} from "./transcription.js";
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
} from "./types.js";
