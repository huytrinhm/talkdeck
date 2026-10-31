import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureSchema } from '../src/evaluation/fixtures.js';
import type { TalkRun } from '../src/evaluation/driver.js';
import { auditHeadless } from '../src/headless/audit.js';
import { renderMarkdownReport } from '../src/headless/report.js';
import type { CapturedFrame } from '../src/headless/viewer.js';
import { createDeck } from '../src/bootstrap.js';
import { ingestCandidate } from '../src/source/ingestion.js';
import { lineHash } from '../src/hashline.js';
import { nodeById, parseSource } from '../src/parser.js';

function scenario() {
  const fixture = fixtureSchema.parse({ schemaVersion: 1, id: 'synthetic-audit', title: 'Synthetic audit controls', purpose: 'Test evaluator', initialContext: 'Synthetic only',
    timing: { mode: 'utterance-end', speed: 1, wordsPerSecond: 2, postTalkObservationMs: 10, maxDrainMs: 10 },
    events: [{ id: 'u1', startMs: 0, endMs: 10, kind: 'utterance', text: 'Revenue was 42%.', targetAlias: 'overview', silenceAfterMs: 0 },
      { id: 'u2', startMs: 11, endMs: 20, kind: 'utterance', text: 'Correct revenue to 40.2%.', targetAlias: 'overview', silenceAfterMs: 0 }],
    expectations: [
      { id: 'e1', triggerEventId: 'u1', targetAlias: 'overview', kind: 'number_exact', value: '42%', label: 'Revenue' },
      { id: 'e2', triggerEventId: 'u2', targetAlias: 'overview', kind: 'correction', old: '42%', new: '40.2%', label: 'Revenue' },
      { id: 'e3', triggerEventId: 'u2', targetAlias: 'overview', kind: 'sparse_design', noEmptyPanels: true, intentionalHierarchy: true },
      { id: 'e4', triggerEventId: 'u2', targetAlias: 'overview', kind: 'presentation_ready' },
    ], finalExpectations: { slideCount: 1, allUserSourceRetained: true, presentationReady: true, noInventedMetrics: true } });
  const run: TalkRun = { fixtureId: fixture.id, provenance: 'synthetic-test', startMs: 0, finishedAtMs: 100, observationUntilMs: 90, deadlineMs: 100,
    inputs: fixture.events.map(e => ({ id: e.id, text: e.text, scheduledEndMs: e.endMs, deliveredAtMs: e.endMs, scheduledAtMs: e.endMs, deliveryDriftMs: 0, retainedAtMs: e.endMs, outcome: 'retained' })),
    recordingComplete: true, settled: true, termination: 'settled', pendingInputIds: [], undeliveredInputIds: [], errors: [] };
  let source = createDeck().source;
  for (const e of fixture.events) source = ingestCandidate(source, { id: e.id, slideId: 'n10', text: e.text, deliveredAtMs: e.endMs }).source;
  return { fixture, run, source, routes: fixture.events.map(e => ({ utteranceId: e.id, slideId: 'n10' })), readiness: { complete: true, ready: true, revision: lineHash(source) } };
}
function frame(atMs: number, text: string, extra: Partial<CapturedFrame> = {}): CapturedFrame {
  return { revision: 'r1', slideId: 'n10', publicationId: 'p1', atMs, painted: true, pending: false, coherent: true, trigger: 'settled', surface: 'editor',
    captureStartedAtMs: atMs, captureFinishedAtMs: atMs + 1, evidence: `viewer/frame-${atMs}.png`, content: [{ nodeId: 'stat', kind: 'Stat', text, label: 'Revenue' }], ...extra };
}
test('temporal corrections preserve prior misses, exact labels and timed readiness independently', () => {
  const data = scenario();
  const evaluated = auditHeadless({ ...data, frames: [frame(15, '42%'), frame(25, '42%'), frame(30, '40.2%')], readinessAtMs: 90, readinessEvidence: 'final/readiness.json' });
  assert.deepEqual(evaluated.observations.map(o => o.firstCorrectVisibleAtMs ?? o.readyAtMs ?? o.missingReason), [15, 30, 'manual-review', 90]);
  assert.deepEqual(evaluated.audit.checks[1].obsoleteObservedAtMs, [25]);
  assert.equal(evaluated.audit.finalChecks.allUserSourceRetained.outcome, 'pass');
  assert.equal(evaluated.audit.finalChecks.noInventedMetrics.outcome, 'manual-review');
  assert.equal(evaluated.audit.qualificationComplete, false);
  const late = auditHeadless({ ...data, frames: [frame(25, '42%'), frame(30, '40.2%')] });
  assert.equal(late.observations[0].firstCorrectVisibleAtMs, undefined); assert.equal(late.observations[0].missingReason, 'superseded-before-display');
  assert.equal(late.observations[3].readyAtMs, undefined); assert.equal(late.observations[3].missingReason, 'check-unavailable');
});
test('offscreen, wrong-label, unpainted, pending, post-run and incoherent frames cannot score', () => {
  const data = scenario();
  for (const bad of [frame(15, '42%', { slideId: 'elsewhere' }), frame(15, '42%', { painted: false }), frame(15, '42%', { pending: true }),
    frame(15, '42%', { coherent: false }), frame(150, '42%'), frame(15, '42%', { content: [{ nodeId: 'stat', kind: 'Stat', text: '42%', label: 'Margin' }] })]) {
    assert.equal(auditHeadless({ ...data, frames: [bad] }).observations[0].firstCorrectVisibleAtMs, undefined);
  }
  const ambiguous = auditHeadless({ ...data, routes: [data.routes[0], { utteranceId: 'u2', slideId: 'other' }], frames: [frame(15, '42%')] });
  assert.equal(ambiguous.audit.ambiguousAliases.length, 1); assert.equal(ambiguous.observations[0].missingReason, 'manual-review');
});
test('native ordered text, quote, absent tokens and attached qualifiers use actual frames', () => {
  const data = scenario();
  data.fixture.expectations = fixtureSchema.parse({ ...data.fixture, expectations: [
    { id: 'order', triggerEventId: 'u1', targetAlias: 'overview', kind: 'ordered_text', texts: ['Draft', 'Review'] },
    { id: 'quote', triggerEventId: 'u1', targetAlias: 'overview', kind: 'quote_exact', text: 'Listen.', by: 'Mara' },
    { id: 'absent', triggerEventId: 'u1', targetAlias: 'overview', kind: 'visible_absent', texts: ['42'], match: 'standalone-numeric-token' },
    { id: 'qualifier', triggerEventId: 'u1', targetAlias: 'overview', kind: 'must_preserve_qualifier', label: 'active accounts', qualifier: 'preliminary' },
  ] }).expectations;
  const content = [{ nodeId: 'a', kind: 'Text', text: 'Draft' }, { nodeId: 'b', kind: 'Text', text: 'Review' },
    { nodeId: 'c', kind: 'Quote', text: 'Listen.', by: 'Mara' }, { nodeId: 'd', kind: 'Stat', text: '142', label: 'active accounts, preliminary' }];
  const good = auditHeadless({ ...data, frames: [frame(15, '', { content })] });
  assert.ok(good.observations.every(o => o.firstCorrectVisibleAtMs === 15));
  const bad = auditHeadless({ ...data, frames: [frame(15, '', { content: [content[1], content[0], { ...content[2], by: 'Wrong' }, { ...content[3], text: '42', label: 'active accounts' }, { nodeId: 'q', kind: 'Text', text: 'preliminary' }] })] });
  assert.ok(bad.observations.every(o => o.firstCorrectVisibleAtMs === undefined));
  const oldLabel = auditHeadless({ ...data, frames: [frame(15, '', { content: [{ nodeId: 'x', kind: 'Stat', text: '10', label: '42' }] })] });
  assert.equal(oldLabel.observations.find(o => o.expectationId === 'absent')!.firstCorrectVisibleAtMs, undefined);
});
test('raw retention requires exact-once Prompt identity across archive; final readiness must match source', () => {
  const data = scenario(), slide = nodeById(parseSource(data.source), 'n10');
  const archived = data.source.slice(slide.start, slide.end).replace('<Slide ', '<ArchivedSlide slideId="n10" ').replace('</Slide>', '</ArchivedSlide>');
  const source = data.source.slice(0, slide.start) + data.source.slice(slide.end);
  const moved = source.replace('<Archive id="n13" />', `<Archive id="n13">${archived}</Archive>`);
  const archiveAudit = auditHeadless({ ...data, source: moved, frames: [] });
  assert.equal(archiveAudit.audit.finalChecks.allUserSourceRetained.outcome, 'pass');
  assert.equal(archiveAudit.audit.finalChecks.presentationReady.outcome, 'fail');
  assert.equal(archiveAudit.audit.finalChecks.slideCount.outcome, 'fail');
  const changed = auditHeadless({ ...data, source: data.source.replace('Revenue was 42%.', 'Revenue was 41%.'), frames: [] });
  assert.equal(changed.audit.finalChecks.allUserSourceRetained.outcome, 'fail');
});
test('report exposes censored coverage, unknown usage, actual served tiers and original galleries', () => {
  const data = scenario(), evaluated = auditHeadless({ ...data, frames: [] });
  const report = renderMarkdownReport({ ...data, ...evaluated, model: { calls: 2, inputTokens: null, outputTokens: 10, servedTiers: ['fast'] }, finalSlides: [{ slideId: 'n10', path: 'final/slide-1.jpg' }], viewerGalleryPath: 'viewer-gallery.html' });
  assert.match(report, /Qualification complete: false/); assert.match(report, /Input tokens: unknown/); assert.match(report, /Actual served tiers: fast/);
  assert.match(report, /viewer-gallery\.html/); assert.match(report, /final\/slide-1\.jpg/); assert.match(report, /Miss\/censored/);
  assert.throws(() => renderMarkdownReport({ ...data, ...evaluated, model: { calls: 0, inputTokens: 0, outputTokens: 0 }, finalSlides: [{ slideId: 'n10', path: '../../secret' }] }), /relative run artifacts/);
});
