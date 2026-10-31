import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export const assetOrigin = "https://assets.talkdeck.local";
export class AssetStore {
  private assets = new Map<string, { mediaType: string; data: Buffer }>();
  constructor(private directory?: string) {
    if (directory) mkdirSync(directory, { recursive: true });
  }
  put(mediaType: string, data: Buffer): string {
    const copy = Buffer.from(data);
    const hash = createHash("sha256")
      .update(mediaType)
      .update(copy)
      .digest("hex");
    const ref = `${assetOrigin}/${hash}`;
    if (!this.assets.has(ref)) {
      this.assets.set(ref, { mediaType, data: copy });
      if (this.directory) {
        writeFileSync(join(this.directory, hash), copy, { flag: "wx" });
        writeFileSync(
          join(this.directory, hash + ".json"),
          JSON.stringify({ ref, mediaType }),
          { flag: "wx" },
        );
      }
    }
    return ref;
  }
  get(ref: string) {
    const asset = this.assets.get(ref.split("#")[0]);
    return asset
      ? { mediaType: asset.mediaType, data: Buffer.from(asset.data) }
      : undefined;
  }
  refs() {
    return [...this.assets.keys()];
  }
}
