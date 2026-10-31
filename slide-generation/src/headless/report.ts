import type { TalkFixture } from '../evaluation/fixtures.js';
import type { TalkRun } from '../evaluation/driver.js';
import { summarizeObservations, type Observation } from '../evaluation/metrics.js';
import type { HeadlessAudit } from './audit.js';

export interface HeadlessReportInput {
  fixture: TalkFixture; run: TalkRun; observations: readonly Observation[]; audit: HeadlessAudit;
  model: { calls: number | null; inputTokens: number | null; outputTokens: number | null; costUsd?: number | null; servedTiers?: readonly string[] };
  finalSlides: readonly { slideId: string; path: string }[]; viewerGalleryPath?: string;
}
const cell = (value: unknown) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const value = (input: number | null | undefined) => input === null || input === undefined ? 'unknown' : String(input);
const link = (path: string) => {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(path) || path.split(/[\\/]/).includes('..')) throw new Error('Report links must be relative run artifacts');
  return path.replaceAll(' ', '%20').replaceAll(')', '%29').replaceAll('(', '%28');
};
/** A per-run evidence report, not a baseline comparison or qualification certificate. */
export function renderMarkdownReport(input: HeadlessReportInput) {
  const summary = summarizeObservations(input.observations);
  const latency = (group: typeof summary.visible) => `| ${group.expected} | ${group.successes} | ${group.misses} | ${group.coverage === null ? 'undefined' : `${(100 * group.coverage).toFixed(1)}%`} | ${value(group.latencyMs.p50)} | ${value(group.latencyMs.p90)} | ${value(group.latencyMs.p95)} | ${value(group.latencyMs.max)} |`;
  const failures = input.audit.checks.filter(check => check.result.outcome !== 'pass');
  return `# ${cell(input.fixture.title)}\n\nRun provenance: ${input.run.provenance}. Termination: ${input.run.termination}. Input retained: ${input.run.inputs.filter(record => record.outcome === 'retained').length}/${input.fixture.events.length}. Recording complete: ${input.run.recordingComplete}.\n\nQualification complete: false. These are individual-run observations; no speed improvement or design/faithfulness qualification is established.\n\n| Effect | Expected | Success | Miss/censored | Coverage | p50 ms | p90 ms | p95 ms | Observed max ms |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n| Actual visible ${latency(summary.visible)}\n| Complete readiness ${latency(summary.ready)}\n\nLatencies start at actual delivered utterance end. Misses remain in coverage denominators and have no fabricated zero latency. Observed maxima describe successful samples only; censored failures can be slower. Repetitions and a compatible frozen baseline are still required for comparison.\n\nModel calls: ${value(input.model.calls)}. Input tokens: ${value(input.model.inputTokens)}. Output tokens: ${value(input.model.outputTokens)}. Cost USD: ${value(input.model.costUsd)}. Actual served tiers: ${input.model.servedTiers?.length ? input.model.servedTiers.map(cell).join(', ') : 'unknown'}.\n\n## Final checks\n\n| Check | Outcome | Evidence/limitation |\n|---|---|---|\n${Object.entries(input.audit.finalChecks).map(([name, check]) => `| ${cell(name)} | ${check.outcome} | ${cell(check.reason)} |`).join('\n')}\n\n## Individual failures and required review\n\n${failures.length ? failures.map(check => `- ${cell(check.expectationId)}: ${check.result.outcome} — ${cell(check.result.reason)}${check.result.evidence.length ? ` ([frame](${link(check.result.evidence[0])}))` : ''}`).join('\n') : 'No failed automated event checks; semantic/design qualification remains separate.'}\n\n## Viewer timeline\n\n${input.viewerGalleryPath ? `[Open original PNG/video gallery](${link(input.viewerGalleryPath)}).` : 'Viewer gallery unavailable; inspect the recorded viewer artifacts.'} DOM samples, screenshot captures, publication acknowledgments and readiness are separate events. Review video for obsolete values, interrupted motion, intermediate counting and exits.\n\n## Final rendered slides\n\n${input.finalSlides.length ? input.finalSlides.map(slide => `### ${cell(slide.slideId)}\n\n![Final rendered slide ${cell(slide.slideId)}](${link(slide.path)})`).join('\n\n') : 'No final slide screenshots were supplied. Final source retention alone does not establish visual correctness.'}\n`;
}
