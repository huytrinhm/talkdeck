import test from 'node:test';
import assert from 'node:assert/strict';
import { BoundedResponsesClient } from '../src/host/model-client.js';

test('live Responses transport enforces caps before requests, does not retry, and preserves literal bodies', async () => {
  const bodies: string[] = [];
  const fetcher: typeof fetch = async (_url, init) => { bodies.push(String(init?.body)); return new Response('{"error":{"message":"rate limited"}}', { status: 429 }); };
  const client = new BoundedResponsesClient('test-secret', 'configured-model', 1, 120, fetcher);
  const body = client.requestBody('instructions', [{ role: 'user', content: 'exact words' }], []);
  assert.equal(body.includes('test-secret'), false);
  assert.equal(JSON.parse(body).service_tier, 'fast');
  assert.equal((await client.respond(body)).status, 429);
  await assert.rejects(client.respond(body), /cap reached/);
  assert.deepEqual(bodies, [body]);
  assert.equal(client.calls, 1);
  assert.throws(() => new BoundedResponsesClient('x', 'm', 9), /budget/);
  assert.throws(() => new BoundedResponsesClient('x', 'm', 8, 8001), /budget/);
});

test('transport refuses missing or changed Fast mode before dispatch', async () => {
  let dispatched = false;
  const client = new BoundedResponsesClient('test-secret', 'configured-model', 1, 120,
    async () => { dispatched = true; throw new Error('should not dispatch'); });
  const body = JSON.parse(client.requestBody('instructions', [], []));
  for (const service_tier of [undefined, 'auto', 'default', 'flex']) {
    await assert.rejects(client.respond(JSON.stringify({ ...body, service_tier })), /Fast mode/);
  }
  assert.equal(dispatched, false);
  assert.equal(client.calls, 0);
});

test('transport refuses changed model and token limit before dispatch', async () => {
  const client = new BoundedResponsesClient('test-secret', 'configured-model', 1, 120, async () => { throw new Error('should not dispatch'); });
  await assert.rejects(client.respond(JSON.stringify({ model: 'other', max_output_tokens: 120 })), /configured model/);
  assert.equal(client.calls, 0);
});

test('authentication error bodies cannot persist echoed credential fragments', async () => {
  const client = new BoundedResponsesClient('test-secret', 'configured-model', 1, 120,
    async () => new Response('{"error":{"message":"Incorrect key: test-sec***"}}', { status: 401 }));
  const result = await client.respond(client.requestBody('instructions', [], []));
  assert.equal(result.status, 401);
  assert.equal(result.responseBody.includes('test-sec'), false);
  assert.equal(JSON.parse(result.responseBody).error.type, 'authentication_response_redacted');
});
