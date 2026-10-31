import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
/** Source-distributed Node/tsx service: manifest includes every renderer/normalizer dependency, not just a label. */
const files = ['renderer.tsx','assets.ts','contrast.ts','icons.ts','theme.ts','types.ts','pipeline.ts',
  '../parser.ts','../schema.ts','../expansion.ts','../contracts.ts','../source/candidate.ts','../source/surgery.ts'];
const hash = createHash('sha256');
for (const file of files) { hash.update(file); hash.update(readFileSync(new URL(file,import.meta.url))); }
export const RENDER_PIPELINE_DIGEST = hash.digest('hex');
