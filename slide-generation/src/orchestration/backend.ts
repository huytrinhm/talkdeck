import type {
  FunctionTool,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import type { InputUtterance } from "../source/ingestion.js";
import type { Publisher } from "./publisher.js";
import type { Role, Speech } from "./types.js";

export interface GenerationInvocation {
  agent: string;
  role: Role;
  slideId?: string;
  inferenceId: string;
  signal: AbortSignal;
  /** Immutable backend context supplied to this inference. */
  context: unknown;
}
export interface GenerationToolResult {
  output: unknown;
  /** Explicitly requested images, appended after all sibling call results. */
  modelItems?: ResponseInputItem[];
}
export interface GenerationPolicy {
  instructions(role: Role): string;
  definitions(role: Role): FunctionTool[];
  context(input: Omit<GenerationInvocation, "context">): unknown;
  invoke(
    input: GenerationInvocation,
    name: string,
    args: unknown,
  ): Promise<GenerationToolResult>;
  deliverUtterance(input: InputUtterance): Promise<{
    receipt: {
      utteranceId: string;
      retainedAtMs: number;
      duplicate?: boolean;
      pending?: boolean;
    };
    speech: Speech;
    duplicate?: boolean;
  }>;
}
/** One actor scheduler, with either the legacy HTML or canonical JSX authority. */
export interface GenerationBackend extends Pick<
  Publisher,
  | "undo"
  | "deckUndo"
  | "selectedId"
  | "revision"
  | "fastWatermark"
  | "latestFastSlideId"
  | "current"
  | "closed"
  | "initialize"
  | "get"
  | "list"
  | "next"
  | "navigate"
  | "historyStatus"
  | "restoreHistory"
  | "setPaused"
  | "close"
  | "onPublish"
  | "onStructure"
  | "onConflict"
  | "validateAccess"
  | "branch"
  | "edit"
  | "editMany"
  | "split"
  | "mergeSlides"
> {
  /** Absent only for the explicitly retained legacy HTML mode. */
  generation?: GenerationPolicy;
}
