import { createHash, randomUUID } from 'node:crypto';
import { SourceError, editSchema, type SourceEdit, type SourceRead } from './contracts.js';
import { nodeById, parseSource } from './parser.js';

export const lineHash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
interface Snapshot { nodeId: string; lines: string[]; start: number; end: number }
export interface RangeResolution {
  nodeId: string; snapshotId: string; originalScope: { start: number; end: number }; currentScope: { start: number; end: number };
  originalLine: number; currentLine: number; relocated: boolean; hashes: string[]; exactText: string;
}
interface Patch { start: number; end: number; text: string; nodeId: string }
export class SnapshotStore {
  private snapshots = new Map<string, Snapshot>();
  constructor(private capacity = 256) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Snapshot capacity must be positive');
  }
  read(source: string, nodeId: string): SourceRead {
    const node = nodeById(parseSource(source), nodeId);
    const lines = source.slice(node.start, node.end).split('\n');
    const snapshotId = randomUUID();
    this.snapshots.set(snapshotId, { nodeId, lines, start: node.start, end: node.end });
    while (this.snapshots.size > this.capacity) this.snapshots.delete(this.snapshots.keys().next().value!);
    return { snapshotId, nodeId, sourceRange: { start: node.start, end: node.end }, revision: lineHash(source), lines: lines.map((text, index) => ({ number: index + 1, hash: lineHash(text), text })) };
  }
  stage(source: string, edits: SourceEdit[]): string {
    return this.stageDetailed(source, edits).source;
  }
  stageDetailed(source: string, edits: SourceEdit[]): { source: string; resolutions: RangeResolution[] } {
    const root = parseSource(source);
    const resolutions: RangeResolution[] = [];
    const patches: Patch[] = edits.map(edit => {
      editSchema.parse(edit);
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
      if ((edit.op === 'insert_before' && start === node.start) || (edit.op === 'insert_after' && end === node.end))
        throw new SourceError('scope_escape', 'Insert inside this node or target its parent', edit.nodeId);
      resolutions.push({ nodeId: edit.nodeId, snapshotId: edit.snapshotId,
        originalScope: { start: snapshot.start, end: snapshot.end }, currentScope: { start: node.start, end: node.end },
        originalLine: edit.startLine, currentLine: index + 1, relocated: index !== first,
        hashes: [...edit.hashes], exactText: expected.join('\n') });
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
    for (const patch of [...patches].reverse()) candidate = candidate.slice(0, patch.start) + patch.text + candidate.slice(patch.end);
    // Catch accidental renaming of a selected node. Removal targets its parent.
    const after = parseSource(candidate);
    for (const edit of edits) nodeById(after, edit.nodeId);
    let drift = 0;
    for (const patch of patches) {
      const scope = nodeById(after, patch.nodeId);
      const start = patch.start + drift;
      const end = start + patch.text.length;
      // Replacing an entire scoped root must not smuggle siblings before/after it.
      if (patch.text.length && (start < scope.start || end > scope.end))
        throw new SourceError('scope_escape', 'Replacement escapes selected node; target its parent', patch.nodeId);
      drift += patch.text.length - (patch.end - patch.start);
    }
    return { source: candidate, resolutions };
  }
}
