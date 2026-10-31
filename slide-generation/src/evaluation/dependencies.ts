import { z } from 'zod';
import { lineHash } from '../hashline.js';

export const renderDependencySchema = z.object({
  kind: z.enum(['font', 'asset', 'catalog', 'renderer', 'compiler', 'contrast']),
  id: z.string().min(1), version: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
type Dependency = z.infer<typeof renderDependencySchema>;
const identity = (dependency: Dependency) => JSON.stringify([dependency.kind, dependency.id, dependency.version]);
const sorted = (dependencies: Dependency[]) => dependencies.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

/** Prefixes preserve typed font/asset/catalog identities in the existing manifest contract. */
export function manifestDependencies(input: unknown) {
  const dependencies = z.array(renderDependencySchema).parse(input), unique = new Map<string, Dependency>();
  for (const dependency of dependencies) {
    const previous = unique.get(identity(dependency));
    if (previous && previous.sha256 !== dependency.sha256) throw new Error(`Conflicting resolved dependency bytes: ${identity(dependency)}`);
    unique.set(identity(dependency), dependency);
  }
  return sorted([...unique.values()]).map(dependency => ({ name: `${dependency.kind}:${dependency.id}`, version: dependency.version, sha256: dependency.sha256 }));
}
export interface DependencySource {
  phase: 'initial' | 'recorded-state'; reference: string; source: string; revision?: string;
  slideId?: string; dependencies: unknown;
}
/** Only the supplied original render records are covered; this never asserts final-deck coverage. */
export function recordedDependencyInventory(input: DependencySource[], recordedErrors: { reference: string; error: string }[] = []) {
  const errors = [...recordedErrors], sources: { phase: DependencySource['phase']; reference: string; sourceSha256: string; slideId?: string; dependencies: Dependency[] }[] = [];
  const unique = new Map<string, Dependency>(), identities = new Map<string, Set<string>>();
  for (const source of input) {
    try {
      const sourceSha256 = lineHash(source.source);
      if (source.revision !== undefined && source.revision !== sourceSha256) throw new Error('Recorded source revision does not match source bytes');
      const dependencies = z.array(renderDependencySchema).parse(source.dependencies);
      sources.push({ phase: source.phase, reference: source.reference, sourceSha256, slideId: source.slideId, dependencies });
      for (const dependency of dependencies) {
        const key = identity(dependency), hashes = identities.get(key) ?? new Set<string>();
        hashes.add(dependency.sha256); identities.set(key, hashes); unique.set(JSON.stringify(dependency), dependency);
      }
    } catch (error) { errors.push({ reference: source.reference, error: String(error) }); }
  }
  if (!sources.some(source => source.phase === 'initial')) errors.push({ reference: 'configuration.json', error: 'Initial render dependencies unavailable' });
  const conflicts = [...identities].filter(([, hashes]) => hashes.size > 1).map(([identity, hashes]) => ({ identity: JSON.parse(identity), sha256: [...hashes].sort() }));
  return { schemaVersion: 1, coverage: 'initial-and-recorded-state-renders' as const, finalCoverage: 'not-verified' as const,
    status: conflicts.length ? 'conflict' as const : errors.length ? 'incomplete' as const : 'consistent' as const,
    sources, dependencies: sorted([...unique.values()]), conflicts, errors };
}
