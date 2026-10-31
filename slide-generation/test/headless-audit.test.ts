import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureSchema } from '../src/evaluation/fixtures.js';
import type { TalkRun } from '../src/evaluation/driver.js';
import { auditHeadless, buildCreationEvidence } from '../src/headless/audit.js';
import { renderMarkdownReport } from '../src/headless/report.js';
import type { CapturedFrame } from '../src/headless/viewer.js';
import { createDeck } from '../src/bootstrap.js';
import { ingestCandidate } from '../src/source/ingestion.js';
import { lineHash } from '../src/hashline.js';
import { nodeById, parseSource } from '../src/parser.js';

function scenario() {
  const fixture = fixtureSchema.parse({ schemaVersion: 1, id: 'synthetic-audit', title: 'Synthetic audit controls', purpose: 'Test evaluator', initialContext: 'Synthetic only',
    timing: { mode: 'utterance-end', speed: 1, wordsPerSecond: 2, postTalkObservationMs: 10, maxDrainMs: 10 },
    events: [{ id: 'u1', startMs: 0, endMs: 10, kind: 'utterance', text: 'Create a slide titled Overview. Revenue was 42%.', targetAlias: 'overview', silenceAfterMs: 0 },
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
  return { fixture, run, source, creationEvidence: [{ utteranceId: 'u1', slideId: 'n10', beforeSource: createDeck().source, afterSource: source, kind: 'seed' as const }], routes: fixture.events.map(e => ({ utteranceId: e.id, slideId: 'n10' })), readiness: { complete: true, ready: true, revision: lineHash(source) } };
}
function frame(atMs: number, text: string, extra: Partial<CapturedFrame> = {}): CapturedFrame {
  return { revision: 'r1', slideId: 'n10', publicationId: 'p1', atMs, painted: true, pending: false, coherent: true, visibilityVerified: true, domEquivalent: true, trigger: 'settled', surface: 'editor',
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
  assert.equal(ambiguous.audit.ambiguousAliases.length, 0); assert.equal(ambiguous.observations[0].firstCorrectVisibleAtMs, 15);
  assert.deepEqual(ambiguous.audit.wrongTargetRoutes, [{ utteranceId: 'u2', expectedSlideId: 'n10', actualSlideId: 'other' }]);
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
  const good = auditHeadless({ ...data, frames: [frame(5, '42'), frame(15, '', { content })] });
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
  const report = renderMarkdownReport({ ...data, ...evaluated, model: { calls: 2, inputTokens: null, outputTokens: 10, servedTiers: ['fast'] }, finalSlides: [{ slideId: 'n10', path: 'final/slide-1.jpg' }], viewerGalleryPath: 'viewer-gallery.html', contactSheetPath: 'final/deck-contact-sheet.png' });
  assert.match(report, /Qualification complete: false/); assert.match(report, /Input tokens: unknown/); assert.match(report, /Actual served tiers: fast/);
  assert.match(report, /Entire final deck in canonical order/); assert.match(report, /final\/deck-contact-sheet\.png/);
  assert.match(report, /viewer-gallery\.html/); assert.match(report, /final\/slide-1\.jpg/); assert.match(report, /Miss\/censored/);
  assert.throws(() => renderMarkdownReport({ ...data, ...evaluated, model: { calls: 0, inputTokens: 0, outputTokens: 0 }, finalSlides: [{ slideId: 'n10', path: '../../secret' }] }), /relative run artifacts/);
});


test('routes cannot establish expected identity or score a wrong target; rejected creation stays unresolved', () => {
  const data = scenario();
  const wrong = auditHeadless({ ...data, routes: data.routes.map(route => ({ ...route, slideId: 'wrong' })), frames: [frame(15, '42%', { slideId: 'wrong' })] });
  assert.equal(wrong.audit.bindings.overview, 'n10'); assert.equal(wrong.observations[0].firstCorrectVisibleAtMs, undefined);
  const unbound = auditHeadless({ ...data, creationEvidence: [], frames: [frame(15, '42%')] });
  assert.equal(unbound.observations[0].missingReason, 'manual-review'); assert.deepEqual(unbound.audit.bindings, {});
  const invalid = auditHeadless({ ...data, creationEvidence: [{ ...data.creationEvidence[0], afterSource: data.source.replace('Overview.', 'Wrong.') }], frames: [frame(15, '42%')] });
  assert.equal(invalid.audit.rejectedCreationEvidence.length, 1); assert.equal(invalid.observations[0].firstCorrectVisibleAtMs, undefined);
});

test('absence/correction requires verified settled DOM; animated or historical unverified samples stay manual', () => {
  const data = scenario();
  for (const extra of [{ trigger: 'painted' as const, domEquivalent: false }, { domEquivalent: undefined }, { visibilityVerified: false }, { visibilityVerified: undefined }]) {
    const audit = auditHeadless({ ...data, frames: [frame(30, '40.2%', extra)] });
    assert.equal(audit.observations[1].firstCorrectVisibleAtMs, undefined); assert.equal(audit.observations[1].missingReason, 'manual-review');
  }
});

test('creation evidence validates exact source chain and create-input association without route answer leakage', () => {
  const data = scenario(), initial = createDeck();
  const first = ingestCandidate(initial.source, { id: 'u1', slideId: 'n10', text: data.fixture.events[0].text, deliveredAtMs: 10 }).source;
  const commits = [{ beforeSourceSha: lineHash(initial.source), afterSourceSha: lineHash(first), source: first }];
  const operations = [{ kind: 'input', input: { id: 'u1', slideId: 'n10', text: data.fixture.events[0].text }, sourceSha256: lineHash(first) }];
  assert.equal(buildCreationEvidence(initial, commits, operations)[0].kind, 'seed');
  assert.throws(() => buildCreationEvidence(initial, [{ ...commits[0], afterSourceSha: '0'.repeat(64) }], operations), /source\/hash chain/);
  assert.equal(buildCreationEvidence(initial, commits, [{ ...operations[0], input: { ...operations[0].input, slideId: 'wrong' } }]).length, 0);
  const created = first.replace('</Deck>', '<Slide id="n100" version={1} freeForm={{reason:"test"}}><Transcript id="n101"/><SpeakerNotes id="n102"/></Slide></Deck>');
  const text = 'New slide titled Second. Add facts.';
  const retained = ingestCandidate(created, { id: 'u3', slideId: 'n100', text, deliveredAtMs: 30 }).source;
  const allCommits = [...commits, { beforeSourceSha: lineHash(first), afterSourceSha: lineHash(created), source: created }, { beforeSourceSha: lineHash(created), afterSourceSha: lineHash(retained), source: retained }];
  const input = { kind: 'input', input: { id: 'u3', slideId: 'n100', text }, sourceSha256: lineHash(retained) };
  assert.equal(buildCreationEvidence(initial, allCommits, [...operations, input]).length, 1);
  const evidence = buildCreationEvidence(initial, allCommits, [...operations, { kind: 'create', slideId: 'n100', sourceSha256: lineHash(created) }, input]);
  assert.equal(evidence.length, 2); assert.equal(evidence[1].kind, 'created'); assert.equal(evidence[1].beforeSource, first);
});


test('removal requires prior verified visible presence; blanks and private input do not prove deletion', () => {
  const data = scenario();
  data.fixture.expectations = fixtureSchema.parse({ ...data.fixture, expectations: [
    { id: 'remove', triggerEventId: 'u2', targetAlias: 'overview', kind: 'visible_absent', texts: ['42%'], match: 'exact' },
  ] }).expectations;
  // The canonical Prompt already contains 42%; even an explicit private notes
  // value must not substitute for prior visible native content.
  data.source = data.source.replace('</SpeakerNotes>', '42%</SpeakerNotes>');
  const blank = frame(30, '', { content: [] });
  const neverVisible = auditHeadless({ ...data, frames: [frame(15, '', { content: [] }), blank] });
  assert.equal(neverVisible.observations[0].firstCorrectVisibleAtMs, undefined);
  assert.equal(neverVisible.observations[0].missingReason, 'manual-review');
  assert.match(neverVisible.audit.checks[0].result.reason, /never observed.*before the trigger/);
  const removed = auditHeadless({ ...data, frames: [frame(15, '42%'), blank] });
  assert.equal(removed.observations[0].firstCorrectVisibleAtMs, 30);
  assert.deepEqual(removed.observations[0].evidence, ['viewer/frame-15.png', 'viewer/frame-30.png']);
  const invalidPriorFrames = [frame(15, '42%', { slideId: 'other' }), frame(15, '42%', { visibilityVerified: undefined }),
    frame(15, '42%', { visibilityVerified: false }), frame(15, '42%', { domEquivalent: false }),
    frame(15, '42%', { painted: false }), frame(15, '42%', { coherent: false }), frame(15, '42%', { pending: true }),
    frame(15, '42%', { trigger: 'painted' }), frame(20, '42%'), frame(25, '42%'), frame(15, '42%', { captureFinishedAtMs: 21 }),
    frame(15, '', { content: [{ nodeId: 'private', kind: 'Prompt', text: '42%' }] }),
    frame(15, '', { content: [{ nodeId: 'private', kind: 'SpeakerNotes', text: '42%' }] })];
  for (const prior of invalidPriorFrames) {
    const audited = auditHeadless({ ...data, frames: [prior, blank] });
    assert.equal(audited.observations[0].firstCorrectVisibleAtMs, undefined);
    assert.equal(audited.observations[0].missingReason, 'manual-review');
  }
  data.fixture.expectations = fixtureSchema.parse({ ...data.fixture, expectations: [
    { id: 'remove', triggerEventId: 'u2', targetAlias: 'overview', kind: 'visible_absent', texts: ['42%', 'Draft'] },
  ] }).expectations;
  assert.equal(auditHeadless({ ...data, frames: [frame(15, '42%'), blank] }).observations[0].firstCorrectVisibleAtMs, undefined);
});
