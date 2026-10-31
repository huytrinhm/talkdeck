import type { RenderResult } from '../contracts.js';
export interface RenderDependency { kind: 'font' | 'asset' | 'catalog' | 'renderer' | 'compiler' | 'contrast'; id: string; version: string; sha256: string }
export interface RenderFont { family: string; weight: number; style: 'normal'; testText: string }
export interface RenderArtifact extends RenderResult {
  source: string;
  dependencies: RenderDependency[];
  fonts: RenderFont[];
  pendingNodeIds: string[];
  /** Hash of the complete normalized source + pipeline + byte dependencies. */
  artifactKey: string;
}
