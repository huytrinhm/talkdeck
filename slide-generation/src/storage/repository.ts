import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { SourceError, type DeckDocument } from '../contracts.js';
import { lineHash } from '../hashline.js';
import { nodes, parseSource } from '../parser.js';
import { atomicWrite, missing, serialized } from './files.js';

const envelope = z.object({ schemaVersion: z.literal(1), source: z.string().max(2_000_000) }).strict();
function canonical(input: unknown): DeckDocument {
  const doc = envelope.parse(input), root = parseSource(doc.source);
  if ([...nodes(root)].some(n => !n.id)) throw new SourceError('storage_identity', 'Persisted nodes require assigned IDs');
  return doc;
}
export interface StoredDeck { document: DeckDocument; revision: string }
export interface DeckRepository {
  load(): Promise<StoredDeck>;
  initialize(document: DeckDocument): Promise<StoredDeck>;
  compareAndSwap(expectedRevision: string, document: DeckDocument): Promise<StoredDeck>;
}
/** Atomic JSON envelope replacement; visual validation remains the engine's mandatory responsibility. */
export class FileDeckRepository implements DeckRepository {
  readonly path: string;
  constructor(path: string) { this.path = resolve(path); }
  async load(): Promise<StoredDeck> {
    const document = canonical(JSON.parse(await readFile(this.path, 'utf8')));
    return { document, revision: lineHash(document.source) };
  }
  async initialize(document: DeckDocument) {
    const candidate = canonical(document);
    return serialized(this.path, async () => {
      try { return await this.load(); } catch (error) { if (!missing(error)) throw error; }
      await atomicWrite(this.path, JSON.stringify(candidate) + '\n');
      return this.load();
    });
  }
  async compareAndSwap(expectedRevision: string, document: DeckDocument) {
    const candidate = canonical(document);
    return serialized(this.path, async () => {
      const previous = await this.load();
      if (previous.revision !== expectedRevision) throw new SourceError('revision_conflict', 'Committed source changed; restage and revalidate');
      if (previous.document.source === candidate.source) return previous;
      await atomicWrite(this.path, JSON.stringify(candidate) + '\n');
      return this.load();
    });
  }
}
