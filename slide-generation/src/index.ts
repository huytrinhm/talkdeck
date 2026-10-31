export { createApp } from './app.js';
export { createDeck } from './bootstrap.js';
export { SlideEngine } from './engine.js';
export { SnapshotStore, lineHash } from './hashline.js';
export { parseSource, nodeById, nodes } from './parser.js';
export { introducedErrors, ready, UnavailableValidation } from './validation.js';
export * from './contracts.js';

export { createPracticeRuntime } from "./practice/runtime.js";
export { PracticeService } from "./practice/service.js";
export { OpenAIPracticeReviewer, OpenAIPracticeTranscriber } from "./practice/openai.js";
export type { Reviewer, ReviewContext, ReviewOutput, PreparedProposal, PracticeRecord } from "./practice/contracts.js";
