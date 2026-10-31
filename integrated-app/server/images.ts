import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SourceError, type AssetReference, type AssetResolver, type ResolvedAsset } from '../../slide-generation/src/contracts.js';
import { digest, resolveImage } from '../../slide-generation/src/render/assets.js';
import type { Material } from '../shared/protocol.js';

/** Project-owned uploads implement the canonical renderer's exact-version resolver. */
export class ProjectImages implements AssetResolver {
  constructor(private directory: string, private projectId: string, private materials: () => Material[]) {}

  search(query = '', offset = 0, limit = 20) {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const matches = this.materials().filter(material => {
      if (!material.asset || material.status !== 'image-ready') return false;
      const searchable = `${material.name} ${material.mime} ${material.asset.id}`.toLowerCase();
      return terms.every(term => searchable.includes(term));
    });
    const assets = matches.slice(offset, offset + limit).map(material => ({
      name: material.name, mediaType: material.mime, bytes: material.bytes,
      asset: { ...material.asset! },
    }));
    return { assets, total: matches.length, offset,
      ...(offset + assets.length < matches.length ? { nextOffset: offset + assets.length } : {}),
    };
  }

  private mediaType(material: Pick<Material, 'name' | 'mime'>, bytes: Buffer) {
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    if (material.mime === 'image/svg+xml' || /\.svg$/i.test(material.name)) return 'image/svg+xml';
    if (/^image\/(png|jpeg|webp)$/.test(material.mime) || /\.(png|jpe?g|webp)$/i.test(material.name))
      throw new SourceError('asset_type', 'Image bytes do not match a supported PNG, JPEG, or WebP file');
    return undefined;
  }

  async register(material: Material, bytes: Buffer) {
    const mediaType = this.mediaType(material, bytes);
    if (!mediaType) return;
    const asset: ResolvedAsset = {
      reference: { id: `upload:${this.projectId}:${material.id}`, version: digest(bytes) },
      mediaType, bytes,
    };
    // Reuse the canonical format and self-contained SVG validation boundary.
    await resolveImage(asset.reference, { resolve: async () => asset });
    material.asset = asset.reference;
    material.mime = mediaType;
    material.status = 'image-ready';
    delete material.text;
    delete material.imageError;
  }

  async restore() {
    for (const material of this.materials()) {
      if (material.asset) continue; // Never silently change a published reference/version.
      if (!material.mime.startsWith('image/') && !/\.(png|jpe?g|webp|svg)$/i.test(material.name)) continue;
      try { await this.register(material, await readFile(join(this.directory, material.id))); }
      catch { material.imageError = 'Image could not be registered. Upload a valid PNG, JPEG, WebP, or self-contained SVG.'; }
    }
  }

  async resolve(reference: AssetReference): Promise<ResolvedAsset> {
    const material = this.materials().find(item => item.asset?.id === reference.id && item.asset.version === reference.version);
    if (!material) throw new SourceError('asset_unavailable', 'This image version is not available in this project');
    const bytes = await readFile(join(this.directory, material.id));
    if (digest(bytes) !== reference.version) throw new SourceError('asset_immutable', 'Stored image bytes no longer match their registered version');
    return { reference: { ...reference }, mediaType: material.mime, bytes };
  }
}
