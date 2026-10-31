import type { Workspace } from "../domain/types";
import { applyUtterance } from "../domain/commands";
import { BrowserSpeechAdapter, type SpeechOptions } from "./speech";
/** Internal frontend boundaries, not declarations of teammate backend endpoints or wire schemas. */
export interface WorkspaceRepositoryPort {
  load(): Promise<Workspace>;
  save(workspace: Workspace): Promise<void>;
  putBlob(key: string, blob: Blob): Promise<void>;
  getBlob(key: string): Promise<Blob | undefined>;
  deleteBlob(key: string): Promise<void>;
}
export interface SpeechSessionPort {
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  retry(): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}
export interface FrontendAdapters {
  createSpeech: (options: SpeechOptions) => SpeechSessionPort;
  interpret: typeof applyUtterance;
}
/** Browser/local reference implementation. Replace only after agreeing service contracts. */
export const frontendAdapters: FrontendAdapters = {
  createSpeech: (options) => new BrowserSpeechAdapter(options),
  interpret: applyUtterance,
};
export function configureFrontendAdapters(
  adapters: Partial<FrontendAdapters>,
): void {
  Object.assign(frontendAdapters, adapters);
}
