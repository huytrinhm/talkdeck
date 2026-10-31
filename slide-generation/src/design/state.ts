import { createDeck } from '../bootstrap.js';
import { parseSource } from '../parser.js';
import { childNodes } from '../schema.js';
import type { SourceNode } from '../contracts.js';

// Derived from source, so loading, undo and redo cannot leave stale lifecycle flags.
// This describes evidence, never guesses whether the user intentionally chose defaults.
function signature(node: SourceNode): string {
  return JSON.stringify([node.tag, Object.fromEntries(Object.entries(node.props).filter(([key]) => key !== 'id').sort(([a], [b]) => a.localeCompare(b))), childNodes(node).map(signature)]);
}
const bootstrapTheme = signature(childNodes(parseSource(createDeck().source)).find(n => n.tag === 'Theme')!);
export function designState(source: string) {
  const children = childNodes(parseSource(source));
  const theme = children.find(n => n.tag === 'Theme')!;
  return {
    theme: signature(theme) === bootstrapTheme ? 'matches_bootstrap_defaults' : 'customized',
    sharedDefinitions: childNodes(children.find(n => n.tag === 'Library')!).length,
    interpretation: 'Source evidence only, not proof that design is finished or user-approved. Use the brief and slide image to decide whether an initial deliberate composition is still needed; default values may be intentional.',
  };
}
