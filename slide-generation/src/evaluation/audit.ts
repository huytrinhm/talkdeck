/** Evaluator-only projections. These never enter model context or runtime mutation validation. */
export interface VisibleContent { nodeId: string; text: string; kind: string; role?: string; label?: string; by?: string }
export interface VisibleFrame {
  revision: string; slideId: string; atMs: number; painted: boolean; pending: boolean;
  content: VisibleContent[]; evidence: string;
}
export interface ExactExpectation {
  kind: string; targetAlias: string; texts?: string[]; value?: string; label?: string; text?: string; by?: string; match?: string;
}
export interface AuditResult { outcome: 'pass' | 'fail' | 'manual-review'; evidence: string[]; reason?: string }
const whitespace = (s: string) => s.replace(/\s+/g, ' ').trim();
/** Binding comes from observed slide identity/human review, never an arbitrary first slide or the model prompt. */
export function auditVisible(expectation: ExactExpectation, frame: VisibleFrame, bindings: ReadonlyMap<string, string>): AuditResult {
  const target = bindings.get(expectation.targetAlias);
  if (!target) return { outcome: 'manual-review', evidence: [], reason: 'Target alias is unresolved' };
  if (!frame.painted || frame.pending || frame.slideId !== target) return { outcome: 'fail', evidence: [frame.evidence], reason: 'Requested target was not visible in this frame' };
  const strings = frame.content.map(n => whitespace(n.text)), expected = expectation.texts?.map(whitespace) ?? [];
  let passed: boolean;
  switch (expectation.kind) {
    case 'visible_exact': passed = expected.every(s => strings.includes(s)); break;
    case 'visible_absent':
      if (expectation.match === 'standalone-numeric-token') {
        passed = expected.every(s => !strings.some(text => {
          const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return new RegExp(`(^|[^0-9.,])${escaped}($|[^0-9.,])`).test(text);
        }));
      } else passed = expected.every(s => !strings.includes(s));
      break;
    case 'ordered_text': {
      let index = -1; passed = expected.every(s => { index = strings.indexOf(s, index + 1); return index >= 0; }); break;
    }
    case 'number_exact': passed = frame.content.some(n => n.kind === 'Stat' && whitespace(n.text) === whitespace(expectation.value ?? '') && whitespace(n.label ?? '') === whitespace(expectation.label ?? '')); break;
    case 'quote_exact': passed = frame.content.some(n => n.kind === 'Quote' && whitespace(n.text) === whitespace(expectation.text ?? '') && whitespace(n.by ?? '') === whitespace(expectation.by ?? '')); break;
    default: return { outcome: 'manual-review', evidence: [frame.evidence], reason: `No automated semantic/design audit for ${expectation.kind}` };
  }
  return { outcome: passed ? 'pass' : 'fail', evidence: [frame.evidence] };
}
