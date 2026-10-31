import { readFile } from 'node:fs/promises';
import { z } from 'zod';
const id = z.string().min(1), texts = z.array(id).min(1), ms = z.number().int().nonnegative();
const common = { id, triggerEventId: id, targetAlias: id };
const kinds = {
  visible_exact: { texts }, ordered_text: { texts }, source_retained: { texts }, build_order: { texts },
  visible_absent: { texts, match: z.enum(['exact', 'standalone-numeric-token']).optional() },
  correction: { old: id, new: id, label: id.optional() },
  number_exact: { value: id, label: id }, must_preserve_qualifier: { label: id, qualifier: id },
  quote_exact: { text: id, by: id }, quote_role: { text: id, notRole: id },
  layout_family: { family: id }, consistent_pair: { aliases: texts },
  sparse_design: { noEmptyPanels: z.boolean(), intentionalHierarchy: z.boolean() },
  slide_order: { aliases: texts }, unchanged_except: { allowed: texts },
  style_target: { text: id, change: id }, relative_position: { text: id, relation: id, other: id },
  slide_deleted_archived: { text: id }, build_groups: { groups: z.array(texts).min(1) },
  no_churn: { scope: id }, no_derived_numbers: { scope: id },
  theme: { description: id, scope: id.optional() }, no_stale_theme: { description: id },
  frame: { left: z.string(), right: z.string(), page: z.boolean() },
  no_duplicate_layouts: {}, presentation_ready: {},
};
const expectation = z.union(Object.entries(kinds).map(([kind, shape]) => z.object({ ...common, kind: z.literal(kind), ...shape }).strict()));
export const fixtureSchema = z.object({
  schemaVersion: z.literal(1), id, title: id, purpose: id, initialContext: id,
  timing: z.object({ mode: z.literal('utterance-end'), speed: z.literal(1), wordsPerSecond: z.number().positive(),
    postTalkObservationMs: ms, maxDrainMs: ms.positive() }).strict(),
  events: z.array(z.object({ id, startMs: ms, endMs: ms, kind: z.literal('utterance'), text: id,
    targetAlias: id, silenceAfterMs: ms }).strict()).min(1),
  expectations: z.array(expectation),
  finalExpectations: z.object({
    slideCount: z.number().int().positive(), allUserSourceRetained: z.literal(true), presentationReady: z.literal(true),
    slideOrder: texts.optional(), archivedSlideAliases: texts.optional(), onlyRequestedChanges: z.boolean().optional(),
    requiredLayoutFamilies: texts.optional(), sameFamilyConsistent: z.boolean().optional(), noDuplicateSlotShapes: z.boolean().optional(),
    quotesVerbatim: z.boolean().optional(), noInventedMetrics: z.boolean().optional(), noUnrequestedChangesDuringPauses: z.boolean().optional(),
    noInventedOrDuplicatedClaims: z.boolean().optional(), correctedValuesOnlyVisible: z.boolean().optional(), latestThemeEverywhere: z.boolean().optional(),
    frame: z.object({ left: z.string(), right: z.string(), page: z.boolean() }).strict().optional(),
  }).strict(),
}).strict().superRefine((fixture, ctx) => {
  const ids = new Set<string>();
  let earliestStart = 0;
  for (const [i, event] of fixture.events.entries()) {
    if (ids.has(event.id) || event.startMs < earliestStart || event.endMs <= event.startMs)
      ctx.addIssue({ code: 'custom', path: ['events', i], message: 'Duplicate ID or invalid/unsorted timing' });
    ids.add(event.id); earliestStart = event.endMs + event.silenceAfterMs;
  }
  const assertionIds = new Set<string>();
  for (const [i, check] of fixture.expectations.entries()) {
    if (assertionIds.has(check.id) || ids.has(check.id) || !ids.has(check.triggerEventId))
      ctx.addIssue({ code: 'custom', path: ['expectations', i], message: 'Duplicate ID or unknown trigger event' });
    assertionIds.add(check.id);
  }
});
export type TalkFixture = z.infer<typeof fixtureSchema>;
export async function loadFixture(path: string) { return fixtureSchema.parse(JSON.parse(await readFile(path, 'utf8'))); }
/** Only this projection may be fed to the host. Evaluation targets/answers stay private. */
export function spokenInput(event: TalkFixture['events'][number]) {
  return { id: event.id, text: event.text, scheduledEndMs: event.endMs };
}
