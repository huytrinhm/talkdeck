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
      read_source: { description: 'Read exact JSX lines and full issued hashes within a node. Convenience scopes: deck, theme, library.', parameters: z.object({ nodeId: node }).strict(), run: a => engine.readSource(a.nodeId) },
      edit_source: { description: 'Atomically edit issued JSX hashline ranges. New nodes omit IDs. All checks must complete before durable commit.', parameters: transactionSchema, run: a => engine.edit(a) },
      read_speaker_notes: { description: 'Read full cleaned notes and immutable raw transcript, including archived slides.', parameters: z.object({ slideId: node }).strict(), run: a => engine.readSpeakerNotes(a.slideId) },
      list_library: { description: 'List definitions, slot shapes, versions and transitively dependent slides.', parameters: empty, run: () => engine.listLibrary() },
      presentation_readiness: { description: 'Validate every slide, including existing errors and Pending. This checks the entire source revision.', parameters: empty, run: () => engine.readiness() },
    };
    if (services.render) this.tools.render = { description: 'Render final slide HTML/CSS. Rendering alone does not certify readiness.', parameters: z.object({ slideId: node }).strict(), run: a => services.render!(engine.readDocument().source, a.slideId) };
    if (services.checkSlides) this.tools.check = { description: 'Run structural and all mandatory browser checks on specified slides.', parameters: z.object({ slideIds: z.array(node).min(1).max(128) }).strict(), run: a => services.checkSlides!(engine.readDocument().source, a.slideIds) };
    if (services.screenshot) this.tools.screenshot = { description: 'Explicitly request up to four final 1920x1080 JPEGs. No screenshots are sent automatically after edits.', parameters: z.object({ slideIds: z.array(node).min(1).max(4) }).strict(), run: async a => (await services.screenshot!(engine.readDocument().source, a.slideIds)).map(image => ({ ...image, jpeg: Buffer.from(image.jpeg).toString('base64'), mediaType: 'image/jpeg' })) };
    if (services.paletteReport) this.tools.palette_report = { description: 'Report resolved palette foreground pairs and APCA thresholds.', parameters: empty, run: () => services.paletteReport!(engine.readDocument().source) };
    if (services.searchIcons) this.tools.search_icons = { description: 'Search the full pinned Lucide catalog by canonical name and aliases. Empty query browses with pagination.', parameters: z.object({ query: z.string().max(200), cursor: z.string().max(256).optional(), limit: z.number().int().min(1).max(100).optional() }).strict(), run: a => services.searchIcons!(a.query, a.cursor, a.limit) };
    if (services.readIcon) this.tools.read_icon = { description: 'Inspect an exact canonical Lucide name/catalogVersion and trusted SVG preview. No stroke customization.', parameters: z.object({ name: z.string().min(1).max(200), catalogVersion: z.string().min(1).max(100) }).strict(), run: a => services.readIcon!(a.name, a.catalogVersion) };
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
