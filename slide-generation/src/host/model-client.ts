/** Environment-only, bounded Responses transport. No retries or credential persistence. */
export class BoundedResponsesClient {
  calls = 0;
  constructor(private readonly credential: string, readonly model: string,
    readonly maxCalls = 8, readonly maxOutputTokens = 8000, private readonly transport: typeof fetch = fetch) {
    if (!credential) throw new Error('Set OPENAI_API_KEY or OPENAI_KEY in the environment');
    if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 8 || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 8000)
      throw new Error('Live smoke budget exceeds eight requests or 8000 output tokens per request');
  }
  requestBody(instructions: string, input: unknown[], tools: unknown[]) {
    return JSON.stringify({ model: this.model, service_tier: 'fast', instructions, input, tools, parallel_tool_calls: false,
      reasoning: { effort: 'none' }, store: false, include: ['reasoning.encrypted_content'], max_output_tokens: this.maxOutputTokens });
  }
  async respond(requestBody: string) {
    if (this.calls >= this.maxCalls) throw new Error('Live smoke inference cap reached');
    const body = JSON.parse(requestBody);
    if (body.model !== this.model || body.max_output_tokens !== this.maxOutputTokens) throw new Error('Request changed the configured model or token cap');
    if (body.service_tier !== 'fast') throw new Error('Live inference requests must use Fast mode');
    this.calls++;
    const response = await this.transport('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${this.credential}`, 'Content-Type': 'application/json' },
      body: requestBody, signal: AbortSignal.timeout(120_000),
    });
    const raw = await response.text();
    // Authentication responses can echo credential fragments. They are not replayable model responses.
    const responseBody = [401, 403].includes(response.status)
      ? JSON.stringify({ error: { type: 'authentication_response_redacted', status: response.status } }) : raw;
    return { status: response.status, ok: response.ok, providerRequestId: response.headers.get('x-request-id') ?? undefined, responseBody };
  }
}
