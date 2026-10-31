export type NavigationCommand = { type: 'new' | 'select'; title: string };
/** Extract a spoken title, retaining decimal punctuation and punctuation inside quotes. */
function readTitle(text: string): { title: string; rest: string } {
  const quoted = text.match(/^(?:"([^"]+)"|“([^”]+)”)(?=\s|[.!?,]|$)/);
  if (quoted) return { title: (quoted[1] ?? quoted[2]).trim(), rest: text.slice(quoted[0].length).replace(/^\s*[.!?]\s*/, '').trim() };
  const end = text.search(/[!?]|\.(?=\s|$)/);
  return { title: (end < 0 ? text : text.slice(0, end)).trim(), rest: end < 0 ? '' : text.slice(end + 1).trim() };
}
/** Actual user words only; this module never receives fixture aliases or expectations. */
export function navigationCommand(text: string): NavigationCommand | undefined {
  const create = text.match(/^(?:new|create)\s+(?:(?:a|an|the)\s+)?(?:(?:opening|closing|section|temporary)\s+)?slide\s+titled\s+(.+)/i);
  if (create) return { type: 'new', title: readTitle(create[1]).title };
  const select = text.match(/^(?:go back|return)\s+to\s+(.+)/i);
  if (select) return { type: 'select', title: readTitle(select[1]).title };
  return undefined;
}
/** A literal rename request supplies a routing alias, never an unvalidated visible title. */
export function requestedTitle(text: string, slides: readonly { id: string; title: string }[] = []): string | undefined {
  const navigation = text.match(/^(?:go back|return)\s+to\s+(.+)/i);
  const directive = navigation ? readTitle(navigation[1]).rest : namedDirective(text, slides)?.directive ?? text;
  const rename = directive.match(/^change\s+(?:its|this|the)\s+title\s+to\s+(.+)/i);
  return rename ? readTitle(rename[1]).title || undefined : undefined;
}
export function routingTitles(slides: readonly { id: string; title: string }[], requested: ReadonlyMap<string, string>) {
  return slides.flatMap(slide => {
    const alias = requested.get(slide.id);
    return alias && alias.toLowerCase() !== slide.title.toLowerCase() ? [slide, { id: slide.id, title: alias }] : [slide];
  });
}
// This is a limited explicit command grammar, not general language understanding.
// A comma alone is narration; quoted examples are not imperative directives.
function isEditDirective(text: string): boolean {
  return /^(?:please\s+)?(?:(?:do\s+not|don't)\s+)?(?:add|change|remove|replace|update|delete|rename|show|hide|reveal|keep|move|set|insert|use|make|put|include|exclude|resize|align|preserve|turn|split|merge|reorder|restore|undo|redo|reword|rewrite|reduce|increase|decrease|switch|leave|retain|drop|swap|highlight|emphasize|bold|italicize)\b/i.test(text.trim());
}
function unquotedComma(text: string): number {
  let quote: string | undefined;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quote) { if (character === quote) quote = undefined; }
    else if (character === '"' || character === '“') quote = character === '“' ? '”' : '"';
    else if ((character === "'" || character === '‘') && (index === 0 || /\s/.test(text[index - 1]))) quote = character === '‘' ? '’' : "'";
    else if (character === ',') return index;
  }
  return -1;
}
function namedDirective(text: string, slides: readonly { id: string; title: string }[]): { slideId: string; directive: string } | undefined {
  const prefix = text.match(/^on\s+(?:(?:the\s+)?slide\s+)?(.+)/i);
  if (!prefix) return undefined;
  const rest = prefix[1];
  const matching = slides.flatMap(slide => {
    const names = [slide.title, `"${slide.title}"`, `“${slide.title}”`];
    const name = names.find(name => rest.slice(0, name.length).toLowerCase() === name.toLowerCase() && /^\s*,/.test(rest.slice(name.length)));
    if (!name) return [];
    const directive = rest.slice(name.length).replace(/^\s*,\s*/, '');
    return isEditDirective(directive) ? [{ slideId: slide.id, length: slide.title.length, directive }] : [];
  }).sort((a, b) => b.length - a.length);
  if (!matching.length) {
    const comma = unquotedComma(rest);
    if (comma >= 0 && isEditDirective(rest.slice(comma + 1))) throw new Error('Named editing target does not match a live slide title');
    return undefined;
  }
  const longest = matching.filter(slide => slide.length === matching[0].length);
  if (new Set(longest.map(slide => slide.slideId)).size !== 1) throw new Error('Named editing target is ambiguous');
  return longest[0];
}
export function namedInputTarget(text: string, slides: readonly { id: string; title: string }[]): string | undefined {
  return namedDirective(text, slides)?.slideId;
}
