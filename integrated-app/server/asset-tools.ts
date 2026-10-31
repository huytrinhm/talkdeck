import { z } from 'zod';
import type { GenerationPolicy } from '../../slide-generation/src/orchestration/backend.js';
import type { ProjectImages } from './images.js';

const searchSchema = z.object({
  query: z.string().max(200).default(''),
  offset: z.number().int().min(0).max(1000000).default(0),
  limit: z.number().int().min(1).max(50).default(20),
}).strict();

/** Product-owned catalog tools supplement the canonical authoring tools for every actor role. */
export function installAssetCatalog(generation: GenerationPolicy, catalog: ProjectImages,
  record: (event: Record<string, unknown>) => void,
) {
  const definitions = generation.definitions.bind(generation);
  const invoke = generation.invoke.bind(generation);
  const instructions = generation.instructions.bind(generation);
  const context = generation.context.bind(generation);

  generation.definitions = role => [...definitions(role), {
    type: 'function', name: 'search_assets', strict: false,
    description: 'Search this project’s uploaded image catalog by filename, media type, or asset ID. All whitespace-separated query terms must match. Use an empty query to browse; this is filename/metadata search, not visual similarity search. Returns {assets:[{name,mediaType,bytes,asset:{id,version}}],total,offset,nextOffset?}. Pass nextOffset with the same query for another page. Use the exact returned asset object in a canonical Image node; do not invent IDs, versions, URLs, or image contents.',
    parameters: z.toJSONSchema(searchSchema),
  }];
  generation.instructions = role => instructions(role) +
    '\n\nUploaded image catalog: use search_assets to find an existing uploaded image before requesting a replacement or generating a new one. An empty query lists available images, including when the user does not name a file. Results contain exact versioned references for <Image asset={{id:"returned-id",version:"returned-version"}} alt="description" />. Search results describe filenames and types, not verified image contents; inspect the resulting slide with screenshot. Specialists may search and pass references to their parent; only canonical editors insert them. If there are no matches, browse once or report that no suitable uploaded image was found.';
  generation.context = input => ({
    ...context(input) as Record<string, unknown>,
    assetCatalog: { searchTool: 'search_assets', imageCount: catalog.search('', 0, 1).total },
  });
  generation.invoke = async (input, name, args) => {
    if (name !== 'search_assets') return invoke(input, name, args);
    input.signal.throwIfAborted();
    const startedAt = new Date().toISOString();
    try {
      const { query, offset, limit } = searchSchema.parse(args);
      const output = catalog.search(query, offset, limit);
      record({ type: 'asset_search', startedAt, endedAt: new Date().toISOString(),
        inferenceId: input.inferenceId, agent: input.agent, role: input.role,
        query, offset, limit, result: output });
      return { output };
    } catch (error) {
      record({ type: 'asset_search_error', startedAt, endedAt: new Date().toISOString(),
        inferenceId: input.inferenceId, agent: input.agent, error: String(error) });
      throw error;
    }
  };
}
