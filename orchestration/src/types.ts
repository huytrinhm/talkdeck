import type {
  ResponseInputItem,
  ResponseOutputItem,
  FunctionTool,
} from "openai/resources/responses/responses";
export type Role = "fast" | "slow" | "specialist";
export interface Correction {
  revision: number;
  before: string;
  after: string;
}
export interface Speech {
  revision: number;
  text: string;
  receivedAt: number;
  corrections: Correction[];
}
export interface Diagnostic {
  code: string;
  severity: "error" | "advisory";
  message: string;
}
export interface Geometry {
  scope: string;
  selector: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Observation {
  id: string;
  source: string;
  screenshot: Buffer;
  geometry: Geometry[];
  diagnostics: Diagnostic[];
  fastWatermark: number;
}
export interface Rendered {
  screenshot: Buffer;
  geometry: Geometry[];
  diagnostics: Diagnostic[];
}
export interface Renderer {
  render(source: string): Promise<Rendered>;
  close(): Promise<void>;
}
export interface DecisionInput {
  speech: Speech;
  lastDispatched: Speech | null;
  undispatchedAgeMs: number;
  context: string;
}
export interface Decider {
  evaluate(
    input: DecisionInput,
    signal: AbortSignal,
  ): Promise<"dispatch" | "hold">;
}
export interface ModelInput {
  agent: string;
  role: Role;
  input: ResponseInputItem[];
  tools: FunctionTool[];
  signal: AbortSignal;
}
export interface ModelResult {
  output: ResponseOutputItem[];
  usage?: unknown;
}
export interface Model {
  infer(input: ModelInput): Promise<ModelResult>;
}
export interface Message {
  kind?: "specialist_completion";
  id: string;
  from: string;
  to: string;
  text: string;
  artifacts?: string[];
}
export interface Task {
  task: string;
  facts: string;
}
export type State = "idle" | "running" | "waiting" | "failed" | "closed";
export interface Event {
  sequence: number;
  at: number;
  type: string;
  [key: string]: unknown;
}
export interface Log {
  write(type: string, data: Record<string, unknown>): void;
  observation(observation: Observation): void;
}
export const silentLog: Log = { write() {}, observation() {} };
export const diagnostic = (
  code: string,
  message: string,
  severity: Diagnostic["severity"] = "error",
): Diagnostic => ({ code, message, severity });
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export const blankSlide =
  '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:1280px;height:720px;overflow:hidden;background:#f8fafc;color:#0f172a;font-family:Arial,sans-serif}main{box-sizing:border-box;width:100%;height:100%;padding:64px}</style></head><body><main><h1>Your talk</h1><p>Listening for your first idea.</p></main></body></html>';
