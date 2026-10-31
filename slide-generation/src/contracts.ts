import { z } from 'zod';

export const CANVAS = { width: 1920, height: 1080 } as const;
export type Literal = string | number | boolean | Literal[] | { [key: string]: Literal };
export interface SourceNode {
  tag: string;
  id?: string;
  props: Record<string, Literal>;
  children: (SourceNode | string)[];
  start: number;
  end: number;
}
export interface DeckDocument { schemaVersion: 1; source: string }
export interface Finding {
  check: string;
  slideId: string;
  nodeId: string;
  severity: 'warning' | 'error';
  /** Nonnegative, with larger values indicating a worse violation. */
  magnitude: number;
  message: string;
  suggestion?: string;
}
export const editSchema = z.object({
  snapshotId: z.string().min(1),
  nodeId: z.string().min(1),
  op: z.enum(['replace', 'insert_before', 'insert_after']),
  startLine: z.number().int().positive(),
  hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1),
  text: z.string(),
}).strict();
export const transactionSchema = z.object({ edits: z.array(editSchema).min(1).max(128) }).strict();
export type SourceEdit = z.infer<typeof editSchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export interface AnchoredLine { number: number; hash: string; text: string }
export interface SourceRead { snapshotId: string; nodeId: string; lines: AnchoredLine[] }
export interface ValidationReport {
  /** Must remain false if any required stage is missing, times out, or crashes. */
  complete: boolean;
  findings: Finding[];
  pendingNodeIds: string[];
}
export interface ValidationPipeline {
  /** Full-deck validation is conservative; dependency-scoped validation can follow later. */
  check(source: string): Promise<ValidationReport>;
}
export interface AssetReference { id: string; version: string }
export interface ResolvedAsset {
  reference: AssetReference;
  mediaType: string;
  bytes: Uint8Array;
}
/** Provisional integration seam; callers resolve exact versions, never 'latest'. */
export interface AssetResolver { resolve(reference: AssetReference): Promise<ResolvedAsset> }
export interface RenderResult { html: string; css: string; slideId: string }
export interface SlideRenderer {
  render(source: string, slideId: string): Promise<RenderResult>;
  screenshot(source: string, slideId: string): Promise<Uint8Array>;
}
export class SourceError extends Error {
  constructor(public code: string, message: string, public nodeId?: string) {
    super(message);
    this.name = 'SourceError';
  }
}
