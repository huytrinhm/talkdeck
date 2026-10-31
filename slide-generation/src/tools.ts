import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { SourceError, transactionSchema, type RenderResult, type ValidationReport } from './contracts.js';
import type { SlideEngine } from './engine.js';

export interface ToolServices {
  render?(source: string, slideId: string): Promise<RenderResult>;
  checkSlides?(source: string, slideIds: string[]): Promise<ValidationReport>;
  screenshot?(source: string, slideIds: string[]): Promise<{ slideId: string; jpeg: Uint8Array; artifactDigest: string; sourceDigest: string }[]>;
  paletteReport?(source: string): unknown;
  searchIcons?(query: string, cursor?: string, limit?: number): unknown;
  readIcon?(name: string, version: string): unknown;
}
export interface ToolObservation { id: string; name: string; arguments: unknown; result?: unknown; error?: { code: string; message: string }; startedAtMs: number; finishedAtMs: number }
interface Tool { description: string; parameters: z.ZodType; run(args: any): unknown | Promise<unknown> }
const node = z.string().min(1).max(4096), empty = z.object({}).strict();
export class ToolRegistry {
  readonly version = 'hashline-tools-v1';
  recordingFailures = 0;
  private readonly tools: Record<string, Tool>;
  constructor(engine: SlideEngine, services: ToolServices = {}, private observe: (event: ToolObservation) => void = () => {}) {
    this.tools = {
      read_source: { description: 'Read node-scoped JSX. nodeId accepts an actual node ID or deck/theme/library aliases; use the returned nodeId for edits. Returns {snapshotId,nodeId,revision,sourceRange,lines:[{number,hash,text}]}; line numbers are 1-based within this node and sourceRange is a JavaScript string-offset range in the full source. Copy issued hashes exactly. Unchanged unique anchors can survive unrelated edits; reread on stale, ambiguous or expired snapshot errors.', parameters: z.object({ nodeId: node }).strict(), run: a => engine.readSource(a.nodeId) },
      edit_source: { description: 'Atomically edit literal JSX within issued node snapshots. startLine is node-local and hashes lists EVERY consecutive anchor line. replace replaces those complete lines; empty text deletes them. insert_before/insert_after insert outside the anchored range but inside its node and add a separating newline automatically. All edits resolve against the same pre-edit source; ranges/boundaries cannot overlap. To remove a node, target its parent. New nodes omit IDs; retain existing IDs. Success returns accepted:true, noOp, transactionId, revision, assignedIds, affectedIds, versions, normalized full-deck source (a fresh read_source snapshot), warning findings and pendingNodeIds. Inspect that source; your role scope does not expand. accepted:false returns findings and unchanged revision; correct the findings. Tool errors may report stale anchors, schema or unavailable validation: reread affected nodes as needed. durability_uncertain means replacement may already be visible: reread before retrying. Acceptance completes mandatory edit checks. Existing errors and Pending placeholders may remain; presentation_readiness checks the entire deck before presenting.', parameters: transactionSchema, run: a => engine.edit(a) },
      read_speaker_notes: { description: 'Read complete notes/evidence for a live or archived slide ID. Returns {slideId,version,archived,notes,transcript}; version belongs to the slide, notes is cleaned text, transcript is immutable JSX containing Prompt utteranceId/mode/correctionOf when present. Supplied current notes/transcript already satisfy the reading requirement; call when missing, stale or auditing omissions.', parameters: z.object({ slideId: node }).strict(), run: a => engine.readSpeakerNotes(a.slideId) },
      list_library: { description: 'Return library entries {id,name,category,description,version,shape,dependentSlides}; shape is a serialized slot kind/count signature. Read an entry id with read_source before authoring its instance or changing its definition. dependentSlides includes transitive dependents.', parameters: empty, run: () => engine.listLibrary() },
      presentation_readiness: { description: 'Read-only complete-deck presentation gate. Returns {complete,findings,pendingNodeIds,revision,ready}. Only ready:true certifies that revision: every mandatory check completed, no blocking errors or Pending placeholders remain, and source did not change during validation. Use this gate before presenting.', parameters: empty, run: () => engine.readiness() },
    };
    if (services.render) this.tools.render = { description: 'Render the requested current slide for HTML/CSS inspection. Returns {slideId,html,css}. Use read_source/edit_source for JSX edits and screenshot for pixels.', parameters: z.object({ slideId: node }).strict(), run: a => services.render!(engine.readDocument().source, a.slideId) };
    if (services.checkSlides) this.tools.check = { description: 'Read-only structural and mandatory browser checks for slideIds. Returns {complete,findings,pendingNodeIds}; findings identify check,slideId,nodeId,severity,magnitude,message and optional suggestion. complete records whether all checks ran; severity identifies blocking findings. Use this for targeted diagnosis. Accepted edits already run mandatory validation.', parameters: z.object({ slideIds: z.array(node).min(1).max(128) }).strict(), run: a => services.checkSlides!(engine.readDocument().source, a.slideIds) };
    if (services.screenshot) this.tools.screenshot = { description: 'Explicitly request current 1920x1080 JPEGs for one to four slides. Results identify slideId, sourceDigest and artifactDigest; the host attaches images for visual inspection. A current observation image may also be attached by the host; use this tool for a fresh capture or another slide. Inspect the image alongside its captured source.', parameters: z.object({ slideIds: z.array(node).min(1).max(4) }).strict(), run: async a => (await services.screenshot!(engine.readDocument().source, a.slideIds)).map(image => ({ ...image, jpeg: Buffer.from(image.jpeg).toString('base64'), mediaType: 'image/jpeg' })) };
    if (services.paletteReport) this.tools.palette_report = { description: 'Read-only resolved palette report: {policy,colors,derived,surfaces:[{fill,foreground,lc,largeTextReadable,bodyReadable}]}. colors maps theme token suffixes to hex; foreground is the resolved foreground hex. Readability thresholds are absolute APCA Lc >=45 for large text and >=60 for body. Use the report to assess the listed theme surfaces.', parameters: empty, run: () => services.paletteReport!(engine.readDocument().source) };
    if (services.searchIcons) this.tools.search_icons = { description: 'Search the pinned Lucide catalog by canonical name and aliases; empty query browses. Returns {icons:[{name,catalogVersion,aliases}],total,cursor?}. Copy cursor with the same query for the next page; absent cursor means complete. Read a returned exact name/catalogVersion before insertion.', parameters: z.object({ query: z.string().max(200), cursor: z.string().max(256).optional(), limit: z.number().int().min(1).max(100).optional() }).strict(), run: a => services.searchIcons!(a.query, a.cursor, a.limit) };
    if (services.readIcon) this.tools.read_icon = { description: 'Read a resolved canonical icon name/catalogVersion. Returns metadata including name,catalogVersion,aliases,size,node,svg,viewBox,digest. svg provides a trusted icon preview. Insert <Icon name="returned-name" catalogVersion="returned-version" alt="meaning" /> via edit_source. Never copy SVG paths into canonical source or customize stroke.', parameters: z.object({ name: z.string().min(1).max(200), catalogVersion: z.string().min(1).max(100) }).strict(), run: a => services.readIcon!(a.name, a.catalogVersion) };
  }
  definitions() { return Object.entries(this.tools).map(([name, tool]) => ({ name, description: tool.description, parameters: z.toJSONSchema(tool.parameters) })); }
  async invoke(name: string, args: unknown) {
    const event: ToolObservation = { id: randomUUID(), name, arguments: args, startedAtMs: performance.now(), finishedAtMs: 0 };
    try {
      const tool = Object.hasOwn(this.tools, name) ? this.tools[name] : undefined;
      if (!tool) throw new SourceError('tool_unavailable', `Unknown or unavailable tool ${name}`);
      const result = await tool.run(tool.parameters.parse(args));
      event.result = result;
      return result;
    } catch (error) {
      event.error = { code: error instanceof SourceError ? error.code : error instanceof z.ZodError ? 'request' : 'internal', message: String(error) };
      throw error;
    } finally {
      event.finishedAtMs = performance.now();
      // A recording failure must not turn an already committed edit into an apparent refusal.
      try { Promise.resolve(this.observe(event)).catch(() => { this.recordingFailures++; }); } catch { this.recordingFailures++; }
    }
  }
}
