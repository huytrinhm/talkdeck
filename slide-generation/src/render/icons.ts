import { jsx } from 'hono/jsx';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { SourceError } from '../contracts.js';
const attributes = z.record(z.string(), z.union([z.string(), z.number()]));
const iconSchema = z.object({ name: z.string(), size: z.number().positive(), aliases: z.array(z.string()), node: z.array(z.tuple([z.enum(['path','circle','rect','line','polyline','polygon','ellipse']), attributes])) }).strict();
const catalogSchema = z.object({ schemaVersion: z.literal(1), catalogVersion: z.string(), package: z.literal('lucide-react'), sourceDigest: z.string(), icons: z.array(iconSchema) }).strict();
const bytes = readFileSync(new URL('../../assets/icons/lucide.json', import.meta.url));
const catalog = catalogSchema.parse(JSON.parse(bytes.toString('utf8')));
export const LUCIDE_VERSION = '1.55.0';
if (catalog.catalogVersion !== LUCIDE_VERSION || catalog.icons.length !== 1877) throw new Error('Pinned Lucide catalog mismatch');
export const LUCIDE_DIGEST = createHash('sha256').update(bytes).digest('hex');
if (LUCIDE_DIGEST !== '4dda5661ac24463c3e7f30e6207ecf4ac3b5279ea91ba71dd6a6688e970d5a5a') throw new Error('Pinned Lucide bytes changed without a catalog version migration');
export const LUCIDE_COUNT = catalog.icons.length;
export type IconData = z.infer<typeof iconSchema>;
const byName = new Map(catalog.icons.map(icon => [icon.name, icon]));
const aliases = new Map(catalog.icons.flatMap(icon => icon.aliases.map(alias => [alias, icon.name] as const)));
export function readIcon(name: string, catalogVersion: string) {
  if (catalogVersion !== LUCIDE_VERSION) throw new SourceError('icon_version', `Available catalogVersion is ${LUCIDE_VERSION}`);
  const icon = byName.get(name);
  if (!icon) throw new SourceError('icon_name', `Unknown canonical Lucide name ${name}${aliases.has(name) ? `; use ${aliases.get(name)}` : ''}`);
  const svg = jsx('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${icon.size} ${icon.size}`, width: icon.size, height: icon.size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, ...icon.node.map(([tag, attrs]) => jsx(tag, attrs))).toString();
  if (typeof svg !== 'string') throw new Error('Static catalog SVG must render synchronously');
  return { ...icon, svg, catalogVersion: LUCIDE_VERSION, viewBox: `0 0 ${icon.size} ${icon.size}`, digest: LUCIDE_DIGEST };
}
export function searchIcons(query = '', cursor?: string, limit = 20) {
  if (typeof query !== 'string' || query.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new SourceError('icon_search', 'Use a query up to 200 characters and limit 1–100');
  const normalized = query.trim().toLowerCase(), signature = createHash('sha256').update(`${LUCIDE_DIGEST}:${normalized}`).digest('hex').slice(0, 16);
  let offset = 0;
  if (cursor !== undefined) {
    const match = /^([a-f0-9]{16}):(\d+)$/.exec(cursor);
    if (!match || match[1] !== signature || !Number.isSafeInteger(Number(match[2]))) throw new SourceError('icon_cursor', 'Cursor does not match this query/catalog');
    offset = Number(match[2]);
  }
  const terms = normalized.split(/[\s_-]+/).filter(Boolean);
  const results = catalog.icons.filter(icon => terms.every(term => [icon.name, ...icon.aliases].some(name => name.includes(term))));
  if (offset > results.length) throw new SourceError('icon_cursor', 'Cursor is outside the result set');
  const page = results.slice(offset, offset + limit).map(icon => ({ name: icon.name, catalogVersion: LUCIDE_VERSION, aliases: icon.aliases }));
  return { icons: page, total: results.length, cursor: offset + limit < results.length ? `${signature}:${offset + limit}` : undefined };
}
