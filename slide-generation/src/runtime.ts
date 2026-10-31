import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createDeck } from './bootstrap.js';
import { SlideEngine } from './engine.js';
import { FileDeckRepository } from './storage/repository.js';
import { EvidenceInbox } from './storage/inbox.js';
import { HonoSlideRenderer } from './render/renderer.js';
import { readIcon, searchIcons } from './render/icons.js';
import { paletteReport } from './render/theme.js';
import { BrowserValidationPipeline } from './browser/pipeline.js';
import type { BrowserPoolOptions } from './browser/pool.js';
import type { AssetResolver } from './contracts.js';
import type { ToolServices } from './tools.js';
import { ToolRegistry } from './tools.js';
import { Trace } from './telemetry/trace.js';

export interface RuntimeOptions { directory: string; assets?: AssetResolver; browser?: BrowserPoolOptions; trace?: Trace }
/** Local subsystem runtime. This is not a replacement for the orchestration actor scheduler. */
export async function createLocalRuntime(options: RuntimeOptions) {
  const packageRoot = fileURLToPath(new URL('../', import.meta.url));
  const directory = resolve(options.directory), local = relative(packageRoot, directory);
  if (local.startsWith('..') || isAbsolute(local)) throw new Error('Deck storage must remain inside slide-generation/');
  const repository = new FileDeckRepository(resolve(directory, 'deck.json'));
  const initial = await repository.initialize(createDeck());
  const renderer = new HonoSlideRenderer({ assets: options.assets });
  const browser = new BrowserValidationPipeline(renderer, options.browser);
  const inbox = new EvidenceInbox(resolve(directory, 'input'));
  const engine = new SlideEngine(initial.document, browser, options.trace, {
    repository, inbox, normalize: source => renderer.normalize(source), schema: { resolveIcon: readIcon },
  });
  // Recovery is trusted metadata ingestion. Pending evidence is never dropped on startup failure.
  await engine.flushInput();
  const services: ToolServices = {
    render: (source, slideId) => renderer.render(source, slideId),
    checkSlides: (source, slideIds) => browser.checkSlides(source, slideIds),
    screenshot: (source, slideIds) => browser.screenshot(source, slideIds),
    paletteReport, searchIcons, readIcon,
  };
  return { engine, renderer, browser, repository, inbox, services, tools: new ToolRegistry(engine, services),
    app: createApp(engine, services, { assets: typeof options.assets?.resolve === 'function' }), close: () => browser.close() };
}
