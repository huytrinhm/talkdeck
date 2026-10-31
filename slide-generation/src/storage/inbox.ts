import { z } from 'zod';
import { mkdir, readFile, readdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { SourceError } from '../contracts.js';
import { lineHash } from '../hashline.js';
import { ingestCandidate, utteranceSchema, type InputUtterance } from '../source/ingestion.js';
import { atomicWrite, missing, serialized, syncDirectory } from './files.js';

const recordSchema = z.object({ sequence: z.number().int().positive(), event: utteranceSchema }).strict();

/** Durable pending input. Receipt does not depend on inference or browser work. */
export class EvidenceInbox {
  readonly directory: string;
  constructor(directory: string) { this.directory = resolve(directory); }
  private path(id: string) { return join(this.directory, `${lineHash(id)}.json`); }
  async retain(input: InputUtterance) {
    const event = utteranceSchema.parse(input), path = this.path(event.id);
    return serialized(this.directory, async () => {
      await mkdir(this.directory, { recursive: true });
      try {
        const existing = recordSchema.parse(JSON.parse(await readFile(path, 'utf8'))).event;
        if (JSON.stringify(existing) !== JSON.stringify(event)) throw new SourceError('input_conflict', 'Utterance ID already queued with different data');
        return { utteranceId: event.id, duplicate: true };
      } catch (error) { if (!missing(error)) throw error; }
      const queued = await this.readPending();
      const sequence = Math.max(0, ...queued.map(r => r.sequence)) + 1;
      await atomicWrite(path, JSON.stringify({ sequence, event }) + '\n');
      return { utteranceId: event.id, duplicate: false };
    });
  }
  pending(): Promise<InputUtterance[]> {
    return serialized(this.directory, async () => (await this.readPending()).map(r => r.event));
  }
  private async readPending() {
    await mkdir(this.directory, { recursive: true });
    const files = (await readdir(this.directory)).filter(f => /^[a-f0-9]{64}\.json$/.test(f));
    const events = await Promise.all(files.map(async file => {
      const record = recordSchema.parse(JSON.parse(await readFile(join(this.directory, file), 'utf8')));
      const { event } = record;
      if (file !== `${lineHash(event.id)}.json`) throw new SourceError('inbox_corrupt', 'Queued input identity does not match file');
      return record;
    }));
    return events.sort((a, b) => a.sequence - b.sequence);
  }
  /** Caller supplies the durably committed source. Exact retained evidence is checked before removal. */
  complete(id: string, committedSource: string) {
    return serialized(this.directory, async () => {
      const path = this.path(id);
      const event = recordSchema.parse(JSON.parse(await readFile(path, 'utf8'))).event;
      if (!ingestCandidate(committedSource, event).duplicate) throw new SourceError('input_uncommitted', 'Input is not in committed source');
      await unlink(path); await syncDirectory(this.directory);
    });
  }
}
