import type { Finding } from '../contracts.js';
import type { RGB } from '../render/contrast.js';

export interface Rect { x: number; y: number; width: number; height: number }
export interface MeasuredNode {
  id: string; authoredId?: string; rect: Rect; bleed: boolean; shape?: string; shapeOpacity?: string;
}
export interface TextRun {
  id: string; nodeId: string; role: string; text: string; rects: Rect[];
  bounds: { id: string; rect: Rect }[]; fontPx: number; fontWeight: number;
  color: RGB; alpha: number; onSurface: boolean; statId?: string;
  backgrounds: RGB[];
}
export interface ShapeIntersection { shapeId: string; textId: string; nodeId: string; pixels: number }
export interface SlideMeasurement {
  slideId: string; canvas: Rect; nodes: MeasuredNode[]; texts: TextRun[];
  shapeIntersections: ShapeIntersection[]; pendingNodeIds: string[]; displayFloor: number;
}
export interface CheckEvidence {
  slideId: string; sourceDigest: string; artifactDigest: string; browserVersion: string;
  policyVersion: string; checkedAt: string; durationMs: number;
  textRuns: number; measuredNodes: number;
}
export interface BrowserCheckResult { findings: Finding[]; measurement: SlideMeasurement; evidence: CheckEvidence }
