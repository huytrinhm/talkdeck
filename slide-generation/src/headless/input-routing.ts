export type NavigationCommand = { type: 'new' | 'select'; title: string };
/** Extract a spoken title, retaining decimal punctuation and punctuation inside quotes. */
function titlePrefix(text: string): string {
  const quoted = text.match(/^(?:"([^"]+)"|“([^”]+)”)(?=\s|[.!?,]|$)/);
  if (quoted) return (quoted[1] ?? quoted[2]).trim();
  return text.split(/[!?]|\.(?=\s|$)/, 1)[0].trim();
}
/** Actual user words only; this module never receives fixture aliases or expectations. */
export function navigationCommand(text: string): NavigationCommand | undefined {
  const create = text.match(/^(?:new|create)\s+(?:(?:a|an|the)\s+)?(?:(?:opening|closing|section|temporary)\s+)?slide\s+titled\s+(.+)/i);
  if (create) return { type: 'new', title: titlePrefix(create[1]) };
  const select = text.match(/^(?:go back|return)\s+to\s+(.+)/i);
  if (select) return { type: 'select', title: titlePrefix(select[1]) };
  return undefined;
}
export function namedInputTarget(text: string, slides: readonly { id: string; title: string }[]): string | undefined {
  // Named editing does not navigate the audience. Matching uses the actual live
  // titles, longest first, so a title that contains commas can still be resolved.
  const prefix = text.match(/^on\s+(?:(?:the\s+)?slide\s+)?(.+)/i);
  if (!prefix) return undefined;
  const rest = prefix[1];
  const matching = slides.filter(slide => {
    const names = [slide.title, `"${slide.title}"`, `“${slide.title}”`];
    return names.some(name => rest.slice(0, name.length).toLowerCase() === name.toLowerCase() && /^\s*,/.test(rest.slice(name.length)));
  }).sort((a, b) => b.title.length - a.title.length);
  if (!matching.length) {
    // Only recognize an explicit comma-delimited editing directive, not narration
    // such as “On Friday we launched”. Preserve unknown targets as an error.
    if (rest.includes(',')) throw new Error('Named editing target does not match a live slide title');
    return undefined;
  }
  const longest = matching.filter(slide => slide.title.length === matching[0].title.length);
  if (longest.length !== 1) throw new Error('Named editing target is ambiguous');
  return longest[0].id;
}
