import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import { create as decodeFont, type Font } from 'fontkit';
import { SourceError, type AssetReference, type AssetResolver, type ResolvedAsset } from '../contracts.js';
import type { RenderDependency, RenderFont } from './types.js';

export const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const key = (ref: AssetReference) => JSON.stringify([ref.id, ref.version]);
/** Provisional fixture/integration resolver: exact references only, no implicit latest version. */
export class MemoryAssetResolver implements AssetResolver {
  private readonly assets = new Map<string, ResolvedAsset>();
  add(asset: ResolvedAsset) {
    if (!asset.reference.id || !asset.reference.version) throw new SourceError('asset_reference', 'Asset reference needs id and version');
    const identity = key(asset.reference), existing = this.assets.get(identity);
    if (existing && (existing.mediaType !== asset.mediaType || digest(existing.bytes) !== digest(asset.bytes))) throw new SourceError('asset_immutable', 'An asset version cannot change bytes');
    this.assets.set(identity, { ...asset, reference: { ...asset.reference }, bytes: Uint8Array.from(asset.bytes) });
  }
  async resolve(reference: AssetReference): Promise<ResolvedAsset> {
    const asset = this.assets.get(key(reference));
    if (!asset) throw new SourceError('asset_unavailable', `Missing asset ${reference.id}@${reference.version}`);
    return { ...asset, reference: { ...asset.reference }, bytes: Uint8Array.from(asset.bytes) };
  }
}
async function exactAsset(reference: AssetReference, resolver?: AssetResolver) {
  if (!resolver) throw new SourceError('asset_unavailable', `No resolver for ${reference.id}@${reference.version}`);
  const asset = await resolver.resolve(reference);
  if (key(reference) !== key(asset.reference)) throw new SourceError('asset_version', 'Resolver returned a different asset version');
  if (!asset.bytes.length || asset.bytes.length > 25_000_000) throw new SourceError('asset_bytes', 'Asset bytes are empty or exceed 25 MB');
  return asset;
}
function verifySvg(bytes: Uint8Array) {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new SourceError('asset_svg', 'SVG entities/doctype are unsupported');
  let invalid = false;
  const doc = new DOMParser({ onError: () => { invalid = true; } }).parseFromString(source, 'image/svg+xml');
  if (invalid || doc.documentElement?.localName !== 'svg') throw new SourceError('asset_svg', 'Invalid SVG asset');
  for (const node of Array.from(doc.getElementsByTagName('*'))) {
    if (['script', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video', 'animate', 'set', 'animateTransform'].includes(node.localName ?? '')) throw new SourceError('asset_svg', `Unsupported SVG element ${node.localName}`);
    for (const attribute of Array.from(node.attributes)) {
      if (/^on/i.test(attribute.name)) throw new SourceError('asset_svg', 'SVG event attributes are forbidden');
      if (['href', 'xlink:href'].includes(attribute.name) && !/^(?:#[A-Za-z][\w:.-]*|data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+)$/.test(attribute.value)) throw new SourceError('asset_svg', 'SVG reference must be internal or embedded raster data');
    }
  }
  // Resolver must deliver sanitized, self-contained SVG; reject external CSS/resource syntax at the boundary.
  if (/@import|\\/i.test(source)) throw new SourceError('asset_svg', 'SVG contains external or escaped resource syntax');
  for (const match of source.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    const value = (match[1] ?? match[2] ?? match[3]).trim();
    if (!/^(?:#[A-Za-z][\w:.-]*|data:(?:font\/[a-z0-9-]+|application\/font-[a-z0-9-]+);base64,[a-zA-Z0-9+/=]+)$/.test(value))
      throw new SourceError('asset_svg', 'SVG contains external CSS resources');
  }
}
export async function resolveImage(reference: AssetReference, resolver?: AssetResolver) {
  const asset = await exactAsset(reference, resolver);
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(asset.mediaType)) throw new SourceError('asset_type', 'Expected PNG/JPEG/WebP or sanitized SVG');
  if (asset.mediaType === 'image/svg+xml') verifySvg(asset.bytes);
  const sha256 = digest(asset.bytes);
  return { url: `data:${asset.mediaType};base64,${Buffer.from(asset.bytes).toString('base64')}`,
    dependency: { kind: 'asset', id: reference.id, version: reference.version, sha256 } as RenderDependency };
}
interface FontFace { family: string; weight: number; bytes: Uint8Array; mediaType: string; format: string; cssWeight?: string; font: Font; dependency: RenderDependency }
export interface ResolvedFonts { family: string; css: string; dependencies: RenderDependency[]; faces: FontFace[] }
const bundled = [
  { file: 'NotoSans-Regular.ttf', weight: 400, sha256: '89c3c497f618fdaa0b2d1e98fef93582f28c71debd2c4a8cdf41f190ced2909d' },
  { file: 'NotoSans-Bold.ttf', weight: 700, sha256: 'e83493c945848ecd4a9ad0f6d19164541a0d3e23a9c952304a00a46e00272ac5' },
];
export async function resolveFonts(reference?: AssetReference, resolver?: AssetResolver): Promise<ResolvedFonts> {
  let faces: FontFace[];
  const decode = (bytes: Uint8Array) => {
    try { const font = decodeFont(Buffer.from(bytes)); if (!('hasGlyphForCodePoint' in font)) throw new Error('Font collection needs an explicit face'); return font; }
    catch (error) { throw new SourceError('font_decode', `Invalid/unsupported font: ${String(error)}`); }
  };
  if (reference) {
    const asset = await exactAsset(reference, resolver);
    const formats: Record<string, string> = { 'font/ttf': 'truetype', 'font/otf': 'opentype', 'font/woff': 'woff', 'font/woff2': 'woff2' };
    if (!formats[asset.mediaType]) throw new SourceError('font_type', 'Expected an explicit font media type');
    const sha256 = digest(asset.bytes), family = `Talkdeck Custom ${sha256.slice(0, 16)}`;
    const font = decode(asset.bytes), weight = font['OS/2'].usWeightClass, axis = font.variationAxes.wght;
    faces = [{ family, weight, cssWeight: axis ? `${axis.min} ${axis.max}` : String(weight), bytes: asset.bytes, mediaType: asset.mediaType, format: formats[asset.mediaType], font, dependency: { kind: 'font', id: reference.id, version: reference.version, sha256 } }];
  } else {
    faces = await Promise.all(bundled.map(async face => {
      const bytes = await readFile(new URL(`../../assets/fonts/${face.file}`, import.meta.url));
      if (digest(bytes) !== face.sha256) throw new SourceError('font_digest', 'Bundled font digest mismatch');
      return { family: 'Talkdeck Noto Sans', weight: face.weight, bytes, mediaType: 'font/ttf', format: 'truetype', font: decode(bytes),
        dependency: { kind: 'font' as const, id: face.file, version: face.sha256, sha256: face.sha256 } };
    }));
  }
  return { family: faces[0].family, faces, dependencies: faces.map(f => f.dependency),
    css: faces.map(f => `@font-face{font-family:"${f.family}";font-style:normal;font-weight:${f.cssWeight ?? f.weight};font-display:block;src:url(data:${f.mediaType};base64,${Buffer.from(f.bytes).toString('base64')}) format("${f.format}");}`).join('\n') };
}
export function verifyGlyphs(fonts: ResolvedFonts, text: string): RenderFont[] {
  for (const face of fonts.faces) for (const char of text) {
    if (/\s/.test(char) || ['\u200d', '\ufe0e', '\ufe0f'].includes(char)) continue;
    if (!face.font.hasGlyphForCodePoint(char.codePointAt(0)!)) throw new SourceError('font_glyph', `Font ${face.family} lacks U+${char.codePointAt(0)!.toString(16).toUpperCase()}; resolve a font with that glyph`);
  }
  return fonts.faces.map(f => ({ family: f.family, weight: f.weight, style: 'normal', testText: text || 'Talkdeck' }));
}
