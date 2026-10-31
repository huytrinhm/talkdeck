import { createHash, randomUUID } from 'node:crypto';
import { SourceError, type SourceEdit, type SourceRead } from './contracts.js';
import { nodeById, parseSource } from './parser.js';

export const lineHash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
interface Snapshot { nodeId: string; lines: string[] }
interface Patch { start: number; end: number; text: string; nodeId: string }
export class SnapshotStore {
  private snapshots = new Map<string, Snapshot>();
  constructor(private capacity = 256) {}
  read(source: string, nodeId: string): SourceRead {
    const node = nodeById(parseSource(source), nodeId);
    const lines = source.slice(node.start, node.end).split('\n');
    const snapshotId = randomUUID();
    this.snapshots.set(snapshotId, { nodeId, lines });
    while (this.snapshots.size > this.capacity) this.snapshots.delete(this.snapshots.keys().next().value!);
    return { snapshotId, nodeId, lines: lines.map((text, index) => ({ number: index + 1, hash: lineHash(text), text })) };
  }
  stage(source: string, edits: SourceEdit[]): string {
    const root = parseSource(source);
    const patches: Patch[] = edits.map(edit => {
      const snapshot = this.snapshots.get(edit.snapshotId);
      if (!snapshot || snapshot.nodeId !== edit.nodeId) throw new SourceError('unknown_snapshot', 'Read this node before editing', edit.nodeId);
      const first = edit.startLine - 1;
      const expected = snapshot.lines.slice(first, first + edit.hashes.length);
      if (expected.length !== edit.hashes.length || expected.some((line, index) => lineHash(line) !== edit.hashes[index])) throw new SourceError('anchor_mismatch', 'Hashes do not match the issued read', edit.nodeId);
      const node = nodeById(root, edit.nodeId);
      const current = source.slice(node.start, node.end).split('\n');
      // Check every line, including exact snapshot bytes, and require uniqueness even
      // when the original line number still happens to match one repeated range.
      const matches: number[] = [];
      for (let i = 0; i <= current.length - expected.length; i++) {
        if (!expected.every((line, j) => current[i + j] === line)) continue;
        if (edit.op !== 'replace') {
          const gap = edit.op === 'insert_before' ? first : first + expected.length;
          const currentGap = edit.op === 'insert_before' ? i : i + expected.length;
          if (snapshot.lines[gap - 1] !== current[currentGap - 1] || snapshot.lines[gap] !== current[currentGap]) continue;
        }
        matches.push(i);
      }
      if (matches.length !== 1) throw new SourceError(matches.length ? 'ambiguous_anchor' : 'stale_anchor', 'Target must match exactly once inside its node', edit.nodeId);
      const index = matches[0];
      const offset = (line: number) => node.start + current.slice(0, line).reduce((sum, text) => sum + text.length + 1, 0);
      const start = offset(index);
      const end = offset(index + expected.length - 1) + current[index + expected.length - 1].length;
      if (edit.op === 'insert_before') return { start, end: start, text: `${edit.text}\n`, nodeId: edit.nodeId };
      if (edit.op === 'insert_after') return { start: end, end, text: `\n${edit.text}`, nodeId: edit.nodeId };
      return { start, end, text: edit.text, nodeId: edit.nodeId };
    });
    patches.sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 1; i < patches.length; i++) {
      const previous = patches[i - 1], next = patches[i];
      if (next.start < previous.end || (next.start === previous.start) || (next.start === previous.end && (previous.start === previous.end || next.start === next.end))) throw new SourceError('overlap', 'Transaction ranges overlap or share an ambiguous insertion boundary', next.nodeId);
    }
    let candidate = source;
    for (const patch of patches.reverse()) candidate = candidate.slice(0, patch.start) + patch.text + candidate.slice(patch.end);
    // Catch accidental renaming of a selected node. Removal targets its parent.
    const after = parseSource(candidate);
    for (const edit of edits) nodeById(after, edit.nodeId);
    return candidate;
  }
}
