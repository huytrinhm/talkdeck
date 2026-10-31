import { parseArgs } from 'node:util';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { atomicWrite } from '../src/storage/files.js';
import { verifyFrozenBaseline } from '../src/evaluation/freeze.js';

const { values } = parseArgs({ options: {
  out: { type: 'string' }, baseline: { type: 'string' }, candidate: { type: 'string' }, repetitions: { type: 'string' },
  fixtures: { type: 'string' }, 'max-runs': { type: 'string' }, 'plan-only': { type: 'boolean' },
  'max-calls': { type: 'string' }, 'max-input-tokens': { type: 'string' }, 'max-output-tokens': { type: 'string' },
}, strict: true });
if (!values.out || !values.baseline || !values.candidate) throw new Error('Required: --out NEW_DIR --baseline FROZEN_DIR --candidate FROZEN_DIR');
const root = fileURLToPath(new URL('../', import.meta.url)), out = resolve(values.out);
const within = relative(join(root, '.artifacts'), out);
if (!within || within.startsWith('..') || isAbsolute(within)) throw new Error('Batch output must be under slide-generation/.artifacts');
function positive(value: string | undefined, fallback: number) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('Budgets and repetition counts must be finite positive integers');
  return number;
}
const repetitions = positive(values.repetitions, 3), maxRuns = positive(values['max-runs'], 30);
const budget = { calls: positive(values['max-calls'], 600), inputTokens: positive(values['max-input-tokens'], 8_000_000), outputTokens: positive(values['max-output-tokens'], 250_000) };
const fixtureNames = values.fixtures?.split(',') ?? ['edit-heavy', 'numbers-business', 'style-switch', 'narrative-keynote', 'long-technical'];
if (fixtureNames.some(name => !/^[a-z-]+$/.test(name))) throw new Error('Fixture names must be simple talk identifiers');
const versions = { baseline: resolve(values.baseline), candidate: resolve(values.candidate) };
const frozen = { baseline: await verifyFrozenBaseline(versions.baseline), candidate: await verifyFrozenBaseline(versions.candidate) };
const jobs: { version: keyof typeof versions; fixture: string; repetition: number; output: string; status: string; exitCode?: number | null; runDirectory?: string }[] = [];
for (let repetition = 1; repetition <= repetitions; repetition++) for (const fixture of fixtureNames) {
  // Alternate pair order to reduce provider time-order confounding; never run concurrently.
  const order: (keyof typeof versions)[] = repetition % 2 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
  for (const version of order) jobs.push({ version, fixture, repetition, output: join(out, version, fixture, String(repetition)), status: 'pending' });
}
const selected = jobs.slice(0, maxRuns);
const plan = { schemaVersion: 1, versions: Object.fromEntries(Object.entries(frozen).map(([name, source]) => [name, source.sourceSha])),
  frozenDirectories: versions, repetitions, requestedRuns: jobs.length, scheduledRuns: selected.length, pace: 1, concurrency: 1,
  budgetPerRun: budget, maximumBatchCalls: selected.length * budget.calls, jobs: selected };
if (values['plan-only']) console.log(JSON.stringify(plan, null, 2));
else {
  await mkdir(out, { recursive: false });
  const save = () => atomicWrite(join(out, 'batch.json'), JSON.stringify(plan, null, 2));
  await save();
  for (const [index, job] of selected.entries()) {
    await mkdir(join(out, job.version, job.fixture), { recursive: true });
    job.status = 'running'; await save();
    console.log(JSON.stringify({ event: 'batch-run-started', index: index + 1, total: selected.length, ...job }));
    const log = createWriteStream(join(out, `run-${String(index + 1).padStart(3, '0')}.log`), { flags: 'wx' });
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/headless-run.ts', '--fixture', `fixtures/talks/${job.fixture}.json`,
      '--out', job.output, '--frozen', versions[job.version], '--repetition', String(job.repetition),
      '--max-calls', String(budget.calls), '--max-input-tokens', String(budget.inputTokens), '--max-output-tokens', String(budget.outputTokens)],
    { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    job.exitCode = await new Promise<number | null>((done, reject) => { child.once('error', reject); child.once('close', done); });
    await new Promise<void>(done => log.end(done));
    job.status = job.exitCode === 0 ? 'completed' : 'failed';
    try { const location = JSON.parse(await readFile(join(job.output, 'run-location.json'), 'utf8')); job.runDirectory = join(job.output, location.runDirectory); } catch { /* Failed before export; original log remains. */ }
    await save(); console.log(JSON.stringify({ event: 'batch-run-finished', index: index + 1, total: selected.length, ...job }));
    if (job.runDirectory) {
      try {
        const cassette = JSON.parse(await readFile(join(job.runDirectory, 'provider-cassette.json'), 'utf8'));
        if (cassette.records.some((record: { status?: number }) => record.status === 401 || record.status === 403)) {
          console.error('Stopping batch after an authentication failure; remaining jobs stay pending.'); process.exitCode = 1; break;
        }
      } catch { /* Preserve run failure; no fabricated provider status. */ }
    }
  }
  if (selected.some(job => job.status !== 'completed')) process.exitCode = 1;
}
