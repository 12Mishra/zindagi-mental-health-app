import { config } from '../config';

export type ChatMessage = { role: 'system' | 'user'; content: string };

export const insightsLlmEnabled = () =>
  Boolean(config.insightsLlmBaseUrl && config.insightsLlmModel && config.insightsLlmApiKey);

const stripFence = (raw: string) => raw.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim();

/**
 * One JSON-mode completion against an OpenAI-compatible endpoint (Groq, OpenAI, ...).
 * Returns the parsed JSON object, or null on timeout, HTTP error, empty or non-object output. Never throws.
 */
export async function completeJson(
  messages: ChatMessage[],
  options: { maxTokens?: number; signal?: AbortSignal } = {},
): Promise<Record<string, unknown> | null> {
  if (!insightsLlmEnabled()) return null;
  const base = config.insightsLlmBaseUrl;
  const url = new URL('chat/completions', base.endsWith('/') ? base : `${base}/`);
  const timeout = AbortSignal.timeout(config.insightsLlmTimeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  // gpt-oss models spend tokens "reasoning" before the answer; keep that short and leave room for the JSON.
  const reasoning = /gpt-oss/.test(config.insightsLlmModel);
  const body = JSON.stringify({
    model: config.insightsLlmModel, messages, stream: false, temperature: 0,
    max_tokens: (options.maxTokens ?? 200) + (reasoning ? 800 : 0),
    response_format: { type: 'json_object' },
    ...(reasoning ? { reasoning_effort: 'low' } : {}),
  });
  const send = () => fetch(url, {
    method: 'POST', signal, body,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.insightsLlmApiKey}` },
  });
  try {
    let response = await send();
    if (response.status === 429) { // rate limited: wait as long as the provider asks (capped), once
      const wait = Math.min(10, Math.max(1, Number(response.headers.get('retry-after')) || 3));
      await new Promise(resolve => setTimeout(resolve, wait * 1000));
      response = await send();
    }
    if (!response.ok) return null;
    const data = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) return null;
    const parsed: unknown = JSON.parse(stripFence(content));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}
