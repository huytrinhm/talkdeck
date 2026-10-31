import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const locks = new Map<string, Promise<unknown>>();
/** Single process only: all writers for a canonical path must use this module. */
export async function serialized<T>(path: string, action: () => Promise<T>): Promise<T> {
  const key = resolve(path), previous = locks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(action);
  locks.set(key, run);
  try { return await run; } finally { if (locks.get(key) === run) locks.delete(key); }
}
export async function syncDirectory(path: string) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
export class DurabilityError extends Error {
  readonly replacementOccurred = true;
  constructor(readonly path: string, options: ErrorOptions) { super('Atomic replacement occurred but post-replacement confirmation failed; reload before retry', options); }
}
export async function atomicWrite(path: string, contents: string) {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let replaced = false, failed = false;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(contents, 'utf8'); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path); replaced = true;
    await syncDirectory(parent);
  } catch (cause) {
    failed = true;
    if (replaced) throw new DurabilityError(path, { cause });
    throw cause;
  } finally {
    try { await rm(temporary, { force: true }); } catch (cause) {
      // Cleanup must not replace a more informative operation failure or report
      // a generic rollback after the canonical file has already been replaced.
      if (!failed) { if (replaced) throw new DurabilityError(path, { cause }); throw cause; }
    }
  }
}
export function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }
