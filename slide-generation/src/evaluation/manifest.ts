import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const dependency = z.object({ name: z.string(), version: z.string(), sha256: digest }).strict();
/** Deliberately no arbitrary settings/env object: unknown fields fail instead of leaking keys. */
export const manifestSchema = z.object({
  schemaVersion: z.literal(1), sourceSha: z.string().regex(/^[a-f0-9]{40}$/), dirty: z.boolean(),
  nodeVersion: z.string(), platform: z.string(), startedAt: z.string().datetime(),
  lockSha256: digest, promptSha256: digest, fixtureSha256: digest,
  dependencies: z.array(dependency),
  model: z.object({ provider: z.string(), name: z.string(), resolvedVersion: z.string().optional(),
    serviceTier: z.enum(['fast', 'priority', 'default', 'auto', 'flex', 'scale', 'ultrafast']).optional(),
    maxCalls: z.number().int().positive(), maxTokens: z.number().int().positive() }).strict().optional(),
  mode: z.enum(['environment', 'live', 'transaction-replay', 'actor-replay']),
}).strict();
export function serializeManifest(input: unknown) { return JSON.stringify(manifestSchema.parse(input), null, 2) + '\n'; }
export const runDirectories = ['model', 'tools', 'states', 'viewer', 'screenshots', 'final'] as const;
export async function createRunDirectory(root: string, segments: [string, string, string, string], manifest: unknown) {
  const serialized = serializeManifest(manifest);
  for (const segment of segments) if (!/^[a-zA-Z0-9_-]+$/.test(segment)) throw new Error('Invalid run path segment');
  const path = join(root, ...segments);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'manifest.json'), serialized, { flag: 'wx' });
  await Promise.all(runDirectories.map(name => mkdir(join(path, name))));
  return path;
}
