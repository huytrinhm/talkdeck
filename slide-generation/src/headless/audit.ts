import type { TalkFixture } from '../evaluation/fixtures.js';
import type { TalkRun } from '../evaluation/driver.js';
import { observationSchema, type Observation } from '../evaluation/metrics.js';
import type { CapturedFrame } from './viewer.js';
import { childNodes } from '../schema.js';
import { nodes, parseSource, textContent } from '../parser.js';
import { lineHash } from '../hashline.js';

export interface InputRoute { utteranceId: string; slideId: string; retainedAtMs?: number }
export interface CreationEvidence { utteranceId: string; slideId: string; beforeSource: string; afterSource: string; kind: 'created' | 'seed' }
export interface AuditHeadlessInput {
  fixture: TalkFixture; run: TalkRun; frames: readonly CapturedFrame[]; routes: readonly InputRoute[]; source: string;
  readiness: { complete: boolean; ready: boolean; revision?: string };
  readinessAtMs?: number; readinessEvidence?: string; creationEvidence?: readonly CreationEvidence[];
}
export interface CheckResult { outcome: 'pass' | 'fail' | 'manual-review'; reason: string; evidence: string[] }
type Expectation = { id: string; triggerEventId: string; targetAlias: string; kind: string; [field: string]: unknown };
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
const same = (a: string | undefined, b: string | undefined) => a !== undefined && b !== undefined && normalize(a) === normalize(b);
const token = (text: string, value: string) => {
  const boundary = /[0-9]/.test(value) ? '[^\\p{L}\\p{N}.,]' : '[^\\p{L}\\p{N}]';
  return new RegExp(`(^|${boundary})${normalize(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|${boundary})`, 'u').test(normalize(text));
};
const visibleStrings = (frame: CapturedFrame) => frame.content.flatMap(c => [c.text, c.label, c.by].filter((text): text is string => text !== undefined)).map(normalize);
const strings = (e: Expectation) => 'texts' in e ? e.texts as string[] : [];
const result = (outcome: CheckResult['outcome'], reason: string, evidence: string[] = []): CheckResult => ({ outcome, reason, evidence });

function inspect(e: Expectation, frame: CapturedFrame): CheckResult {
  if (frame.visibilityVerified === undefined) return result('manual-review', 'Historical frame lacks full text visibility measurement; review original video without upgrading its evidence', [frame.evidence]);
  if ((e.kind === 'visible_absent' || e.kind === 'correction') && (frame.trigger !== 'settled' || frame.domEquivalent !== true || frame.visibilityVerified !== true))
    return result('manual-review', 'Absence/correction requires a settled exact DOM and verified full text visibility; exit ghosts may still be visible', [frame.evidence]);
  const content = frame.content, texts = visibleStrings(frame);
  const exact = (text: string) => texts.includes(normalize(text));
  let passed: boolean;
  switch (e.kind) {
    case 'visible_exact': passed = strings(e).every(exact); break;
    case 'visible_absent': passed = strings(e).every(value => !texts.some(text => e.match === 'standalone-numeric-token' ? token(text, value) : same(text, value))); break;
    case 'ordered_text': {
      let index = -1; passed = strings(e).every(value => { index = texts.indexOf(normalize(value), index + 1); return index >= 0; }); break;
    }
    case 'number_exact': passed = content.some(c => c.kind === 'Stat' && same(c.text, e.value as string) && same(c.label, e.label as string)); break;
    case 'quote_exact': passed = content.some(c => c.kind === 'Quote' && same(c.text, e.text as string) && same(c.by, e.by as string)); break;
    case 'quote_role': passed = content.some(c => c.kind === 'Quote' && same(c.text, e.text as string) && c.role !== e.notRole); break;
    case 'correction': {
      const old = e.old as string, updated = e.new as string, label = e.label as string | undefined;
      const oldVisible = texts.some(text => same(text, old) || token(text, old));
      if (oldVisible) { passed = false; break; }
      if (!label) passed = exact(updated);
      else if (label === 'slide title') passed = content.some(c => c.role === 'title' && same(c.text, updated));
      else if (label === 'list item') passed = content.some(c => c.kind === 'Text' && same(c.text, updated));
      else {
        const associated = content.filter(c => c.kind === 'Stat' && same(c.label, label));
        if (!associated.length) return result('manual-review', 'Correction label/value association is not represented by a native Stat', [frame.evidence]);
        passed = associated.some(c => same(c.text, updated));
      }
      break;
    }
    case 'must_preserve_qualifier': {
      const label = e.label as string, qualifier = e.qualifier as string;
      // Both must occur in the same native text node or the same Stat label. Merely
      // appearing elsewhere on the slide does not prove association.
      passed = content.some(c => {
        const associatedText = c.kind === 'Stat' ? c.label ?? '' : c.text;
        return token(associatedText, label) && token(associatedText, qualifier);
      }); break;
    }
    default: return result('manual-review', `No automatic semantic/design audit for ${e.kind}`);
  }
  return result(passed ? 'pass' : 'fail', passed ? 'Observed exact requested native content' : 'Requested content or association was absent/different', [frame.evidence]);
}
function supersedes(previous: Expectation, next: Expectation) {
  if (previous.targetAlias !== next.targetAlias || previous.triggerEventId === next.triggerEventId) return false;
  const priorValues = previous.kind === 'number_exact' ? [previous.value as string] : previous.kind === 'correction' ? [previous.new as string] : strings(previous);
  if (next.kind === 'correction' && priorValues.some(value => same(value, next.old as string))) return true;
  if (next.kind === 'visible_absent' && strings(next).some(value => priorValues.some(prior => same(value, prior)))) return true;
  if (previous.kind === 'ordered_text' && next.kind === 'ordered_text') return true;
  return previous.kind === 'number_exact' && next.kind === 'number_exact' && same(previous.label as string, next.label as string) && !same(previous.value as string, next.value as string);
}

const declaresCreation = (text: string) => /^(?:new|create)\s+(?:(?:a|an|the)\s+)?(?:(?:opening|closing|section|temporary)\s+)?slide\s+titled\s+\S/i.test(text);
function validateCreation(evidence: CreationEvidence, text?: string): string | undefined {
  if (!text || !declaresCreation(text)) return 'Utterance does not explicitly declare creation';
  try {
    const before = parseSource(evidence.beforeSource), after = parseSource(evidence.afterSource);
    const previous = childNodes(before).filter(node => node.tag === 'Slide'), target = childNodes(after).find(node => node.tag === 'Slide' && node.id === evidence.slideId);
    if (!target) return 'Recorded creation target is not a live slide';
    const prompts = [...nodes(target)].filter(node => node.tag === 'Prompt' && node.props.utteranceId === evidence.utteranceId);
    if (prompts.length !== 1 || textContent(prompts[0]) !== text) return 'Creation target does not retain the exact triggering Prompt once';
    if (evidence.kind === 'seed') {
      if (previous.length !== 1 || previous[0].id !== evidence.slideId || [...nodes(before)].some(node => node.tag === 'Prompt')) return 'Seed was not the untouched initial singleton';
    } else if (previous.some(node => node.id === evidence.slideId)) return 'Created target already existed before the recorded creation';
  } catch { return 'Creation source snapshot is invalid'; }
  return undefined;
}
/** Derive identity evidence from original recorded operations and a hash-verified source chain. */
export function buildCreationEvidence(initial: string | { source: string }, commits: readonly unknown[], operations: readonly unknown[]): CreationEvidence[] {
  const initialSource = typeof initial === 'string' ? initial : initial.source;
  const sources = new Map([[lineHash(initialSource), initialSource]]), introduced = new Map<string, string>();
  let previous = initialSource, previousHash = lineHash(previous);
  for (const raw of commits) {
    const commit = raw as { beforeSourceSha?: string; afterSourceSha?: string; source?: string };
    if (!commit || typeof commit.source !== 'string' || commit.beforeSourceSha !== previousHash || commit.afterSourceSha !== lineHash(commit.source))
      throw new Error('Creation evidence requires an unbroken exact recorded source/hash chain');
    const priorIds = new Set(childNodes(parseSource(previous)).filter(node => node.tag === 'Slide').map(node => node.id));
    for (const slide of childNodes(parseSource(commit.source)).filter(node => node.tag === 'Slide')) if (!priorIds.has(slide.id) && !introduced.has(slide.id!)) introduced.set(slide.id!, previous);
    sources.set(commit.afterSourceSha, commit.source); previous = commit.source; previousHash = commit.afterSourceSha;
  }
  const evidence: CreationEvidence[] = [], creates = new Set<string>();
  let inputCount = 0;
  for (const raw of operations) {
    const operation = raw as { kind?: string; slideId?: string; sourceSha256?: string; input?: { id?: string; text?: string; slideId?: string } };
    if (operation?.kind === 'create' && operation.slideId && operation.sourceSha256 && sources.has(operation.sourceSha256)) creates.add(operation.slideId);
    if (operation?.kind !== 'input') continue;
    const input = operation.input; inputCount++;
    if (!input?.id || !input.slideId || !input.text || !declaresCreation(input.text)) continue;
    const afterSource = operation.sourceSha256 ? sources.get(operation.sourceSha256) : undefined;
    const beforeSource = creates.has(input.slideId) ? introduced.get(input.slideId) : inputCount === 1 ? initialSource : undefined;
    if (!afterSource || !beforeSource) continue;
    const candidate: CreationEvidence = { utteranceId: input.id, slideId: input.slideId, beforeSource, afterSource, kind: creates.has(input.slideId) ? 'created' : 'seed' };
    if (!validateCreation(candidate, input.text)) { evidence.push(candidate); creates.delete(input.slideId); }
  }
  return evidence;
}

/** Runs only after generation. Aliases/expectations never reach the host/model. */
export function auditHeadless(input: AuditHeadlessInput) {
  const { fixture, run, frames, routes, source, readiness } = input;
  if (run.fixtureId !== fixture.id) throw new Error('Run and fixture identities differ');
  const routeMap = new Map<string, Set<string>>();
  for (const route of routes) {
    if (!fixture.events.some(event => event.id === route.utteranceId)) throw new Error('Route contains an unknown utterance');
    const targets = routeMap.get(route.utteranceId) ?? new Set<string>(); targets.add(route.slideId); routeMap.set(route.utteranceId, targets);
  }
  const aliases = new Map<string, Set<string>>(), rejectedCreationEvidence: { utteranceId: string; reason: string }[] = [];
  for (const evidence of input.creationEvidence ?? []) {
    const event = fixture.events.find(event => event.id === evidence.utteranceId);
    const failure = validateCreation(evidence, event?.text);
    if (!event || failure) { rejectedCreationEvidence.push({ utteranceId: evidence.utteranceId, reason: failure ?? 'Unknown creation utterance' }); continue; }
    const targets = aliases.get(event.targetAlias) ?? new Set<string>(); targets.add(evidence.slideId); aliases.set(event.targetAlias, targets);
  }
  const bindings = Object.fromEntries([...aliases].filter(([, ids]) => ids.size === 1).map(([alias, ids]) => [alias, [...ids][0]]));
  const ambiguousAliases = [...aliases].filter(([, ids]) => ids.size > 1).map(([alias, ids]) => ({ alias, slideIds: [...ids] }));
  const wrongTargetRoutes = fixture.events.flatMap(event => {
    const expectedSlideId = bindings[event.targetAlias];
    return expectedSlideId ? [...(routeMap.get(event.id) ?? [])].filter(actualSlideId => actualSlideId !== expectedSlideId)
      .map(actualSlideId => ({ utteranceId: event.id, expectedSlideId, actualSlideId })) : [];
  });
  const delivered = new Map(run.inputs.map(entry => [entry.id, entry]));
  const scheduled = new Map(fixture.events.map(event => [event.id, run.startMs + event.endMs]));
  const sortedFrames = [...frames].sort((a, b) => a.atMs - b.atMs);
  const checks: { expectationId: string; targetSlideId?: string; windowEndMs: number; result: CheckResult; obsoleteObservedAtMs?: number[] }[] = [];
  const observations: Observation[] = fixture.expectations.map((e: Expectation) => {
    const inputRecord = delivered.get(e.triggerEventId), start = inputRecord?.deliveredAtMs ?? scheduled.get(e.triggerEventId)!;
    const next = fixture.expectations.filter(candidate => supersedes(e, candidate)).map(candidate => delivered.get(candidate.triggerEventId)?.deliveredAtMs)
      .filter((time): time is number => time !== undefined && time > start).sort((a, b) => a - b)[0];
    const end = Math.max(start, Math.min(run.finishedAtMs, next ?? run.finishedAtMs));
    const observation: Observation = { expectationId: e.id, utteranceId: e.triggerEventId, effect: e.kind === 'presentation_ready' ? 'ready' : 'visible',
      scheduledEndMs: scheduled.get(e.triggerEventId)!, actualUtteranceEndMs: start, deadlineMs: end, evidence: [] };
    const targetSlideId = bindings[e.targetAlias];
    let outcome = result('fail', 'No eligible on-screen frame was observed');
    if (!inputRecord) { observation.missingReason = 'not-observed'; outcome = result('fail', 'Trigger input was never delivered'); }
    else if (e.kind === 'presentation_ready') {
      const time = input.readinessAtMs;
      if (readiness.complete && readiness.ready && readiness.revision === lineHash(source) && time !== undefined && time >= start && time <= end && input.readinessEvidence) {
        observation.readyAtMs = time; observation.evidence = [input.readinessEvidence]; outcome = result('pass', 'Complete-deck readiness verified at a recorded time', observation.evidence);
      } else { observation.missingReason = 'check-unavailable'; outcome = result('fail', 'No timed same-revision complete readiness evidence'); }
    } else if (!targetSlideId || e.targetAlias === 'deck') {
      observation.missingReason = 'manual-review'; outcome = result('manual-review', 'Target alias is unresolved, ambiguous or deck-wide');
    } else {
      const candidates = sortedFrames.filter(frame => frame.atMs >= start && frame.atMs <= end && (next === undefined || frame.atMs < next)
        && frame.slideId === targetSlideId && frame.coherent && frame.painted && !frame.pending);
      const results = candidates.map(frame => ({ frame, check: inspect(e, frame) }));
      const success = results.find(r => r.check.outcome === 'pass');
      if (success) {
        observation.firstVisibleAtMs = success.frame.atMs; observation.firstCorrectVisibleAtMs = success.frame.atMs;
        observation.evidence = success.check.evidence;
        const settled = candidates.find(frame => frame.trigger === 'settled' && frame.atMs >= success.frame.atMs && inspect(e, frame).outcome === 'pass');
        if (settled) observation.settledAtMs = settled.atMs;
        outcome = success.check;
      } else {
        const manual = results.find(r => r.check.outcome === 'manual-review');
        // Unsupported expectations remain explicit misses even if there were no frames.
        const supported = ['visible_exact', 'visible_absent', 'ordered_text', 'number_exact', 'quote_exact', 'quote_role', 'correction', 'must_preserve_qualifier'].includes(e.kind);
        observation.missingReason = manual || !supported ? 'manual-review' : next !== undefined ? 'superseded-before-display' : candidates.length ? 'not-observed' : 'offscreen';
        outcome = manual?.check ?? (!supported ? result('manual-review', `No automatic semantic/design audit for ${e.kind}`) : results.at(-1)?.check ?? outcome);
        observation.evidence = outcome.evidence;
      }
    }
    checks.push({ expectationId: e.id, targetSlideId, windowEndMs: end, result: outcome,
      ...(e.kind === 'correction' ? { obsoleteObservedAtMs: sortedFrames.filter(frame => frame.slideId === targetSlideId && frame.coherent && frame.painted && frame.atMs >= start && frame.atMs <= end
        && visibleStrings(frame).some(text => same(text, e.old as string) || token(text, e.old as string))).map(frame => frame.atMs) } : {}) });
    return observationSchema.parse(observation);
  });
  const root = parseSource(source), prompts = [...nodes(root)].filter(node => node.tag === 'Prompt');
  const retainedInputs = fixture.events.map(event => {
    const matches = prompts.filter(node => node.props.utteranceId === event.id);
    return { utteranceId: event.id, retainedExactlyOnce: matches.length === 1 && textContent(matches[0]) === event.text, occurrences: matches.length };
  });
  const finalChecks: Record<string, CheckResult> = {
    slideCount: result(childNodes(root).filter(node => node.tag === 'Slide').length === fixture.finalExpectations.slideCount ? 'pass' : 'fail', `Expected ${fixture.finalExpectations.slideCount}; observed ${childNodes(root).filter(node => node.tag === 'Slide').length}`),
    allUserSourceRetained: result(retainedInputs.every(entry => entry.retainedExactlyOnce) ? 'pass' : 'fail', 'Exact Prompt text checked by utterance ID across live and archived source'),
    presentationReady: result(readiness.complete && readiness.ready && readiness.revision === lineHash(source) ? 'pass' : 'fail', 'Final complete-deck readiness must match the exact canonical source revision'),
  };
  for (const key of Object.keys(fixture.finalExpectations)) if (!(key in finalChecks)) finalChecks[key] = result('manual-review', 'Requires semantic, design, history or full-video review');
  return { observations, audit: { schemaVersion: 1, fixtureId: fixture.id, qualificationComplete: false, bindings, ambiguousAliases, rejectedCreationEvidence, wrongTargetRoutes, checks, finalChecks, retainedInputs,
    sourceSha256: lineHash(source), framesObserved: frames.length,
    limitations: ['Native DOM samples are not screenshot timestamps; inspect capture intervals and video.', 'Exit ghosts and unsampled intermediate digits require full-video review.', 'Final source/readiness checks do not establish earlier visible success.', 'Unsupported semantic/design expectations remain misses and require review.'] } };
}
export type HeadlessAudit = ReturnType<typeof auditHeadless>['audit'];
