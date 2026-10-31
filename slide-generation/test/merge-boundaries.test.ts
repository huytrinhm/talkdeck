import test from 'node:test';
import assert from 'node:assert/strict';
import type OpenAI from 'openai';
import { loadGenerationInstructions } from '../src/host/instructions.js';
import { OpenAIPracticeReviewer } from '../src/practice/openai.js';
import type { ReviewContext } from '../src/practice/contracts.js';

const context: ReviewContext = {
  version: 1, practiceId: 'merge-review', instructions: 'Be conservative', brief: {},
  baseline: { source: '<Slide />', revision: 'r', reads: [] },
  slides: [], speech: [], speechHistory: [], events: [], visits: [], priorDecks: [],
  measurements: { id: 'timing', durationMs: 0, pausedMs: 0, wordCount: 0, approximateWordsPerMinute: 0, caveat: 'No audio' },
  evidence: [], images: [],
};

test('shared integrated/headless instructions preserve the role boundary without implementation SPEC', async () => {
  const prompt = await loadGenerationInstructions();
  assert.match(prompt.instructions, /# Slide editing agent instructions/);
  assert.doesNotMatch(prompt.instructions, /# Slide generation, manipulation, and rendering specification/);
  assert.equal(prompt.version, 2);
});

test('explicit change survives the compact review adapter and enforces one private proposal', async () => {
  const requests: any[] = [];
  const proposal = { id: 'change', title: 'Spacing', rationale: 'Explicit request', evidenceIds: [], feedbackIds: [], alternativeTo: [],
    edits: [{ snapshotId: 'read', nodeId: 'n10', op: 'replace', startLine: 1, hashes: ['a'.repeat(64)], text: '<Text>Exact words</Text>' }] };
  let proposals = [proposal];
  const client = { responses: { async create(body: unknown) {
    requests.push(body);
    return { status: 'completed', output_text: JSON.stringify({ summary: 'Requested spacing', feedback: [], proposals }) };
  } } } as unknown as OpenAI;
  const reviewer = new OpenAIPracticeReviewer(client);
  const change = { slideId: 'n10', prompt: 'Improve spacing on this slide only' };
  const review = () => reviewer.review({ context, change, signal: new AbortController().signal });
  assert.equal((await review()).proposals.length, 1);
  const request = requests[0];
  assert.deepEqual(JSON.parse(request.input[0].content[0].text).change, change);
  assert.match(request.instructions, /change\.slideId/);
  assert.match(request.instructions, /user reviews the prepared preview before acceptance/);
  assert.equal(request.text.format.schema.properties.proposals.minItems, 1);
  assert.equal(request.text.format.schema.properties.proposals.maxItems, 1);
  proposals = []; await assert.rejects(review());
  proposals = [proposal, { ...proposal, id: 'unrelated' }]; await assert.rejects(review());
});
