import test from "node:test";
import assert from "node:assert/strict";
import type OpenAI from "openai";
import { OpenAIModel } from "../src/openai.js";

test("Fast uses Luna/fast/none; Slow uses Sol/fast/medium; specialists keep Sol/default/low", async () => {
  const requests: Record<string, any>[] = [];
  const client = {
    responses: {
      async create(body: Record<string, any>) {
        requests.push(body);
        return {
          status: "completed",
          output: [],
          service_tier: body.service_tier ?? "default",
        };
      },
    },
  } as unknown as OpenAI;
  const model = new OpenAIModel(client, {
    fast: "gpt-6-luna",
    slow: "gpt-6-sol",
    specialist: "gpt-6-sol",
  });
  for (const role of ["fast", "slow", "specialist"] as const)
    await model.infer({
      agent: role,
      role,
      input: [],
      tools: [],
      signal: new AbortController().signal,
    });
  assert.equal(requests[0].model, "gpt-6-luna");
  assert.equal(requests[0].service_tier, "fast");
  assert.equal(requests[0].reasoning.effort, "none");
  assert.equal(requests[1].model, "gpt-6-sol");
  assert.equal(requests[1].service_tier, "fast");
  assert.equal(requests[1].reasoning.effort, "medium");
  assert.equal(requests[2].model, "gpt-6-sol");
  assert.equal(requests[2].service_tier, undefined);
  assert.equal(requests[2].reasoning.effort, "low");
});
