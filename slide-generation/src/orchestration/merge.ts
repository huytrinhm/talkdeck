import { diffArrays } from "diff";
// Numeric values (including decimal/unit suffixes) and identifiers are indivisible.
const tokenize = (source: string) =>
  source.match(
    /\d+(?:[.,]\d+)*(?:[eE][+-]?\d+)?(?:%|[a-zA-Z]+)?|[\p{L}_$][\p{L}\p{N}_$-]*|\s+|[^\s]/gu,
  ) ?? [];
interface Change {
  start: number;
  end: number;
  text: string;
}
function changes(base: string, next: string): Change[] {
  const result: Change[] = [];
  let pos = 0;
  let pending: Change | undefined;
  for (const part of diffArrays(tokenize(base), tokenize(next))) {
    const value = part.value.join("");
    if (part.added || part.removed) {
      pending ??= { start: pos, end: pos, text: "" };
      if (part.added) pending.text += value;
      else {
        pos += value.length;
        pending.end = pos;
      }
    } else {
      if (pending) result.push(pending);
      pending = undefined;
      pos += value.length;
    }
  }
  if (pending) result.push(pending);
  return result;
}
function same(a: Change, b: Change) {
  return a.start === b.start && a.end === b.end && a.text === b.text;
}
function overlap(a: Change, b: Change) {
  if (a.start === a.end) return a.start >= b.start && a.start <= b.end;
  if (b.start === b.end) return b.start >= a.start && b.start <= a.end;
  return a.start < b.end && b.start < a.end;
}
export function merge(base: string, proposed: string, current: string): string {
  if (base === current || proposed === current) return proposed;
  if (proposed === base) return current;
  const ours = changes(base, proposed),
    theirs = changes(base, current);
  for (const a of ours)
    for (const b of theirs) {
      if (overlap(a, b) && !same(a, b))
        throw new Error(
          "Incompatible concurrent changes overlap. Observe current slide and reconsider the intent.",
        );
    }
  const all = [
    ...theirs,
    ...ours.filter((a) => !theirs.some((b) => same(a, b))),
  ].sort((a, b) => b.start - a.start);
  let result = base;
  for (const c of all)
    result = result.slice(0, c.start) + c.text + result.slice(c.end);
  return result;
}
export function replaceExactly(
  source: string,
  old: string,
  replacement: string,
): string {
  if (!old)
    throw new Error(
      "old cannot be empty. Insert by expanding an existing fragment.",
    );
  const first = source.indexOf(old);
  if (first < 0 || source.indexOf(old, first + 1) >= 0)
    throw new Error(
      "old must match exactly once in the source supplied to this inference.",
    );
  return (
    source.slice(0, first) + replacement + source.slice(first + old.length)
  );
}
