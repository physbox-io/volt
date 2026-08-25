import {
  isClaudeModel,
  readAnthropicKey,
  readGeminiKey,
  readMaxTokens,
} from './llmSettings';

/**
 * Browser-side client for the Anthropic and Google model APIs.
 *
 * Raw `fetch` rather than a provider SDK: this is a static build with no
 * backend, so the request goes from the page to the provider, and Anthropic
 * requires an explicit opt-in header for that (`anthropic-dangerous-direct-
 * browser-access`) which a bundled Node SDK would only wrap.
 *
 * Every call tries the dev-server proxy first and falls back to the provider's
 * own origin. In `npm run dev` the proxy exists and keeps the key off a
 * cross-origin request; in the hosted static build the proxy path 404s and the
 * direct call is what runs. The same code therefore works in both.
 */

export type LLMResult = {
  text: string;
  /**
   * True when the reply hit the token ceiling. A truncated reply is the single
   * most common way a copilot request fails without looking like one: the prose
   * arrives intact and only the trailing JSON is cut off, so callers must refuse
   * to report success rather than apply half a schematic.
   */
  truncated: boolean;
};

export class LLMError extends Error {}

/** Only the fields these two APIs' replies are read for. */
type ContentBlock = { type?: string; text?: string };
type GeminiPart = { text?: string };
type AnthropicModel = { id?: string; display_name?: string };
type GeminiModel = { name?: string; displayName?: string; supportedGenerationMethods?: string[] };

const ANTHROPIC_VERSION = '2023-06-01';

/** POSTs to the proxy path, retrying against the provider when it isn't there. */
async function postWithFallback(
  proxyUrl: string,
  directUrl: string,
  init: RequestInit,
  directInit?: RequestInit
): Promise<Response> {
  try {
    const viaProxy = await fetch(proxyUrl, init);
    // 404 means no proxy (the static build); anything else is a real answer.
    if (viaProxy.status !== 404) return viaProxy;
  } catch {
    // Network error against our own origin — fall through to the provider.
  }
  return fetch(directUrl, directInit ?? init);
}

async function callClaude(system: string, user: string, model: string): Promise<LLMResult> {
  const key = readAnthropicKey();
  if (!key) throw new LLMError('Add your Anthropic API key in Settings to use this model.');

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': ANTHROPIC_VERSION,
  };
  // Required for a call made straight from a browser page.
  const directHeaders = { ...headers, 'anthropic-dangerous-direct-browser-access': 'true' };

  // No temperature/top_p: current Claude models reject them outright, and the
  // request is steered by the system prompt instead.
  const body = JSON.stringify({
    model,
    max_tokens: readMaxTokens(),
    system,
    messages: [{ role: 'user', content: user }],
  });

  const response = await postWithFallback(
    '/api/anthropic/v1/messages',
    'https://api.anthropic.com/v1/messages',
    { method: 'POST', headers, body },
    { method: 'POST', headers: directHeaders, body }
  );

  const json = await response.json().catch(() => null);
  if (!json) throw new LLMError(`Claude returned an unreadable response (HTTP ${response.status}).`);
  if (json.error) throw new LLMError(json.error.message || json.error.type || 'Claude API error.');

  if (json.stop_reason === 'refusal') {
    throw new LLMError('The model declined this request.');
  }

  // Thinking blocks come back alongside text on current models; only the text
  // blocks are the answer, and taking content[0] blindly would return nothing.
  const text: string = Array.isArray(json.content)
    ? json.content
        .filter((b: ContentBlock) => b?.type === 'text' && typeof b.text === 'string')
        .map((b: ContentBlock) => b.text)
        .join('\n')
    : '';

  if (!text.trim()) throw new LLMError('The model returned an empty response.');
  return { text, truncated: json.stop_reason === 'max_tokens' };
}

async function callGemini(system: string, user: string, model: string): Promise<LLMResult> {
  const key = readGeminiKey();
  if (!key) throw new LLMError('Add your Google Gemini API key in Settings to use this model.');

  const path = `/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `${system}\n\nUser request: ${user}` }] }],
      generationConfig: { maxOutputTokens: readMaxTokens() },
    }),
  };

  const response = await postWithFallback(
    `/api/gemini${path}`,
    `https://generativelanguage.googleapis.com${path}`,
    init
  );

  const json = await response.json().catch(() => null);
  if (!json) throw new LLMError(`Gemini returned an unreadable response (HTTP ${response.status}).`);
  if (json.error) throw new LLMError(json.error.message || 'Gemini API error.');

  const candidate = json.candidates?.[0];
  // Every text part, not just the first: thinking models split a reply across
  // parts, and the trailing JSON is usually in a later one.
  const text: string = Array.isArray(candidate?.content?.parts)
    ? candidate.content.parts
        .filter((p: GeminiPart) => typeof p?.text === 'string' && p.text)
        .map((p: GeminiPart) => p.text)
        .join('\n')
    : '';

  if (!text.trim()) {
    const reason = json.promptFeedback?.blockReason || candidate?.finishReason;
    throw new LLMError(
      reason ? `The model returned no content (${reason}).` : 'The model returned an empty response.'
    );
  }
  return { text, truncated: candidate?.finishReason === 'MAX_TOKENS' };
}

export function callLLM(system: string, user: string, model: string): Promise<LLMResult> {
  return isClaudeModel(model) ? callClaude(system, user, model) : callGemini(system, user, model);
}

/** Models the key can actually use, for the picker. Failure is not fatal. */
export async function listClaudeModels(): Promise<{ id: string; name: string }[]> {
  const key = readAnthropicKey();
  if (!key) return [];
  const headers: Record<string, string> = { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION };
  try {
    let res = await fetch('/api/anthropic/v1/models', { headers });
    if (res.status === 404) {
      res = await fetch('https://api.anthropic.com/v1/models', {
        headers: { ...headers, 'anthropic-dangerous-direct-browser-access': 'true' },
      });
    }
    if (!res.ok) return [];
    const json = await res.json();
    return (json.data || []).map((m: AnthropicModel) => ({ id: String(m.id), name: m.display_name || String(m.id) }));
  } catch {
    return [];
  }
}

export async function listGeminiModels(): Promise<{ id: string; name: string }[]> {
  const key = readGeminiKey();
  if (!key) return [];
  const path = `/v1beta/models?key=${encodeURIComponent(key)}`;
  try {
    let res = await fetch(`/api/gemini${path}`);
    if (res.status === 404) res = await fetch(`https://generativelanguage.googleapis.com${path}`);
    if (!res.ok) return [];
    const json = await res.json();
    return (json.models || [])
      .filter((m: GeminiModel) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
      .map((m: GeminiModel) => ({
        id: String(m.name).replace(/^models\//, ''),
        name: m.displayName || String(m.name).replace(/^models\//, ''),
      }));
  } catch {
    return [];
  }
}
