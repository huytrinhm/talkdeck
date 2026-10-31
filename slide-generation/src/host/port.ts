import type { SourceRead, Transaction, RenderResult } from '../contracts.js';
/** Proposed host boundary. The existing orchestration Publisher does not implement it. */
export interface Utterance {
  id: string; text: string; deliveredAtMs: number; slideId: string; correctionOf?: string;
}
export interface IngestionReceipt { utteranceId: string; revision: string; retainedAtMs: number }
export interface Publication { id: string; revision: string; slideId: string; render: RenderResult }
export interface ViewerAcknowledgment {
  publicationId: string; revision: string; slideId: string;
  appliedAtMs: number; paintedAtMs: number; settledAtMs?: number;
  clockOffsetMs: number; clockUncertaintyMs: number; visibleBuild: number;
}
export interface SlideHostPort {
  /** Resolves on durable receipt, independently of model/validation/publication work. */
  deliverUtterance(input: Utterance): Promise<IngestionReceipt>;
  readSource(nodeId: string): SourceRead;
  editSource(transaction: Transaction): Promise<unknown>;
  subscribe(listener: (publication: Publication) => void): () => void;
  acknowledge(ack: ViewerAcknowledgment): void;
}
