import { validWorkspace } from "../domain/validation";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { emptyWorkspace, type Workspace } from "../domain/types";
interface TalkdeckDB extends DBSchema {
  workspace: { key: string; value: Workspace };
  blobs: { key: string; value: Blob };
}
import type { WorkspaceRepositoryPort } from "./adapters";
export class WorkspaceRepository implements WorkspaceRepositoryPort {
  private dbPromise: Promise<IDBPDatabase<TalkdeckDB>> | undefined;
  constructor(private name = "talkdeck-local-v2") {}
  private db() {
    if (!this.dbPromise)
      this.dbPromise = openDB<TalkdeckDB>(this.name, 1, {
        upgrade(db) {
          db.createObjectStore("workspace");
          db.createObjectStore("blobs");
        },
        blocking: () => {
          void this.dbPromise?.then((db) => db.close());
          this.dbPromise = undefined;
        },
      }).catch((error) => {
        this.dbPromise = undefined;
        throw error;
      });
    return this.dbPromise;
  }
  async load(): Promise<Workspace> {
    const data = await (await this.db()).get("workspace", "current");
    if (!data) return emptyWorkspace();
    if (!validWorkspace(data))
      throw new Error("Saved workspace is incompatible or damaged.");
    return data;
  }
  async save(workspace: Workspace): Promise<void> {
    const tx = (await this.db()).transaction("workspace", "readwrite");
    await tx.store.put(workspace, "current");
    await tx.done;
  }
  async getBlob(key: string): Promise<Blob | undefined> {
    return (await this.db()).get("blobs", key);
  }
  async putBlob(key: string, blob: Blob): Promise<void> {
    const tx = (await this.db()).transaction("blobs", "readwrite");
    await tx.store.put(blob, key);
    await tx.done;
  }
  async deleteBlob(key: string): Promise<void> {
    const tx = (await this.db()).transaction("blobs", "readwrite");
    await tx.store.delete(key);
    await tx.done;
  }
}
export const repository = new WorkspaceRepository();
