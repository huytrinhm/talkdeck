import { z } from 'zod';

export const VIEWER_PROTOCOL = 1 as const;
const id = z.string().min(1).max(4096);
const ms = z.number().finite().nonnegative();
const common = { version: z.literal(VIEWER_PROTOCOL), channel: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/) };
export const motionSchema = z.object({
  durationMs: z.number().min(0).max(3000),
  stiffness: z.number().min(20).max(1000),
  damping: z.number().min(1).max(100),
}).strict();
export const DEFAULT_MOTION = { durationMs: 320, stiffness: 220, damping: 26 } as const;
export const publicationSchema = z.object({
  ...common, type: z.literal('publish'), sequence: z.number().int().nonnegative(),
  publicationId: id, revision: id, slideId: id,
  html: z.string().max(16_000_000), css: z.string().max(16_000_000),
  mode: z.enum(['editor', 'presentation']),
  readiness: z.object({ revision: id, ready: z.boolean() }).strict(),
  motion: motionSchema,
  build: z.number().int().nonnegative(),
  holdIds: z.array(id).max(10000),
}).strict();
export const buildSchema = z.object({
  ...common, type: z.literal('build'), sequence: z.number().int().nonnegative(),
  revision: id, build: z.number().int().nonnegative(), holdIds: z.array(id).max(10000),
}).strict();
export const incomingSchema = z.discriminatedUnion('type', [publicationSchema, buildSchema]);
export type PublicationMessage = z.infer<typeof publicationSchema>;
export type IncomingMessage = z.infer<typeof incomingSchema>;
export type OutboundMessage = IncomingMessage extends infer Message ? Message extends IncomingMessage ? Omit<Message, 'version' | 'channel'> : never : never;
export const acknowledgmentSchema = z.object({
  ...common, type: z.enum(['ready', 'applied', 'painted', 'settled', 'refused']),
  publicationId: id.optional(), revision: id.optional(), slideId: id.optional(),
  sequence: z.number().int().nonnegative().optional(),
  monotonicMs: ms, timeOriginMs: ms, build: z.number().int().nonnegative().optional(),
  visibleNodeIds: z.array(id).optional(), code: id.optional(),
  domEquivalent: z.boolean().optional(),
}).strict();
export type ViewerAcknowledgment = z.infer<typeof acknowledgmentSchema>;

export function mayPresent(message: PublicationMessage): boolean {
  return message.mode !== 'presentation' || (message.readiness.ready && message.readiness.revision === message.revision);
}
/** Geometry is unchanged: hidden ancestors still gate descendants. */
export function visibleAtBuild(groups: readonly number[], build: number): boolean {
  return groups.every(group => group <= build);
}
export function nextBuild(groups: readonly number[], current: number): number | undefined {
  return [...new Set(groups)].filter(group => group > current).sort((a, b) => a - b)[0];
}
export function fitCanvas(width: number, height: number) {
  if (![width, height].every(n => Number.isFinite(n) && n >= 0)) throw new Error('Invalid viewport size');
  const scale = Math.min(width / 1920, height / 1080);
  return { scale, left: (width - 1920 * scale) / 2, top: (height - 1080 * scale) / 2 };
}
