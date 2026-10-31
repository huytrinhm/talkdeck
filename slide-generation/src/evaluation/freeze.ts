import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, writeFile, lstat, readlink } from 'node:fs/promises';
import { resolve, relative, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const freezeSchema = z.object({ schemaVersion: z.literal(1), sourceSha: z.string().regex(/^[a-f0-9]{40}$/), createdAt: z.string().datetime(),
  archiveSha256: digest, files: z.array(z.object({ path: z.string(), kind: z.enum(['file', 'symlink']), sha256: digest }).strict()) }).strict();
export type FrozenBaseline = z.infer<typeof freezeSchema>;
async function hash(path: string) { const sha = createHash('sha256'); for await (const chunk of createReadStream(path)) sha.update(chunk); return sha.digest('hex'); }
async function inventory(root: string, sub = ''): Promise<FrozenBaseline['files']> {
  const files: FrozenBaseline['files'] = [];
  for (const name of (await readdir(join(root, sub))).sort()) {
    const path = join(sub, name), full = join(root, path), stat = await lstat(full);
    if (stat.isSymbolicLink()) files.push({ path, kind: 'symlink', sha256: createHash('sha256').update(await readlink(full)).digest('hex') });
    else if (stat.isDirectory()) files.push(...await inventory(root, path));
    else if (stat.isFile()) files.push({ path, kind: 'file', sha256: await hash(full) });
    else throw new Error('Unsupported file type in baseline export');
  }
  return files;
}
async function command(command: string, args: string[], cwd: string) {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', error = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => error += d);
  const code = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  if (code !== 0) throw new Error(`${command} failed: ${error.trim()}`); return out.trim();
}
/** Export a committed complete repository without branch/worktree changes. Run before candidate changes. */
export async function freezeBaseline(repoRoot: string, outputDirectory: string) {
  const root = resolve(repoRoot), output = resolve(outputDirectory), artifacts = fileURLToPath(new URL('../../.artifacts/baselines/', import.meta.url));
  if (relative(artifacts, output).startsWith('..') || output === resolve(artifacts)) throw new Error('Baseline must be a new directory under slide-generation/.artifacts/baselines');
  if (await command('git', ['status', '--porcelain'], root)) throw new Error('Freeze requires a clean committed repository; do not label current dirty code as a previous baseline');
  const sourceSha = await command('git', ['rev-parse', 'HEAD'], root);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { recursive: false }); await mkdir(join(output, 'repo'));
  const child = spawn('git', ['archive', '--format=tar', sourceSha], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.resume();
  const exit = new Promise<void>((resolve, reject) => { child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error('git archive failed'))); });
  await Promise.all([pipeline(child.stdout, createWriteStream(join(output, 'source.tar'), { flags: 'wx' })), exit]);
  await command('tar', ['-xf', join(output, 'source.tar'), '-C', join(output, 'repo')], root);
  const record = freezeSchema.parse({ schemaVersion: 1, sourceSha, createdAt: new Date().toISOString(), archiveSha256: await hash(join(output, 'source.tar')), files: await inventory(join(output, 'repo')) });
  await writeFile(join(output, 'freeze.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  return record;
}
export async function verifyFrozenBaseline(directory: string): Promise<FrozenBaseline> {
  const record = freezeSchema.parse(JSON.parse(await readFile(join(directory, 'freeze.json'), 'utf8')));
  if (await hash(join(directory, 'source.tar')) !== record.archiveSha256 || JSON.stringify(await inventory(join(directory, 'repo'))) !== JSON.stringify(record.files))
    throw new Error('Frozen baseline source or archive changed');
  return record;
}
