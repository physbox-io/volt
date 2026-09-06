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

/**
 * Whether a reply to a proxy path actually came from the provider.
 *
 * A 404 is the obvious "no proxy here", but a static host is just as likely to
 * answer an unknown /api/... path with 200 and the SPA's index.html. That looks
 * like success and then fails as JSON, which is how a live model list silently
 * degrades to the built-in one — so anything that isn't JSON counts as no proxy.
 */
const proxyAnswered = (res: Response): boolean =>
  res.status !== 404 && (res.headers.get('content-type') || '').includes('json');

/** Calls the proxy path, retrying against the provider when it isn't there. */
async function requestWithFallback(
  proxyUrl: string,
  directUrl: string,
  init: RequestInit,
  directInit?: RequestInit
): Promise<Response> {
  try {
    const viaProxy = await fetch(proxyUrl, init);
    if (proxyAnswered(viaProxy)) return viaProxy;
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

  const response = await requestWithFallback(
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

  const response = await requestWithFallback(
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

export type ModelOption = { id: string; name: string };

/**
 * What the picker got back: the models, and — when the list is empty — why.
 *
 * The reason matters because the alternative to a live list is the built-in
 * one, which goes stale the moment a provider ships a model. Without a visible
 * reason a missing key, a rejected key and a firewalled request all look
 * identical to "the provider has not released anything new".
 */
export type ModelListing = { models: ModelOption[]; error?: string };

/** How many pages of a provider's list to walk before giving up. */
const MAX_MODEL_PAGES = 10;

/**
 * Models the key can actually use, for the picker.
 *
 * Paged to the end rather than taking the first response: `/v1/models` defaults
 * to 20 per page, so a truncated read is a picker that quietly lags the API.
 */
export async function listClaudeModels(): Promise<ModelListing> {
  const key = readAnthropicKey();
  if (!key) return { models: [], error: 'Add an Anthropic key to list Claude models.' };
  const headers: Record<string, string> = { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION };
  const directHeaders = { ...headers, 'anthropic-dangerous-direct-browser-access': 'true' };

  const models: ModelOption[] = [];
  let afterId: string | undefined;
  try {
    for (let page = 0; page < MAX_MODEL_PAGES; page++) {
      const query = `?limit=1000${afterId ? `&after_id=${encodeURIComponent(afterId)}` : ''}`;
      const res = await requestWithFallback(
        `/api/anthropic/v1/models${query}`,
        `https://api.anthropic.com/v1/models${query}`,
        { headers },
        { headers: directHeaders }
      );
      if (!res.ok) return { models: [], error: await describeFailure(res) };
      const json = await res.json();
      for (const m of json.data || []) {
        models.push({ id: String(m.id), name: (m as AnthropicModel).display_name || String(m.id) });
      }
      if (!json.has_more) break;
      afterId = json.last_id;
      if (!afterId) break;
    }
  } catch {
    return { models: [], error: 'Could not reach the Anthropic API.' };
  }
  return { models };
}

/**
 * The Gemini list is neither newest-first nor short — the default page holds 50
 * of a list well past that — so a new model can sit on page two indefinitely.
 */
export async function listGeminiModels(): Promise<ModelListing> {
  const key = readGeminiKey();
  if (!key) return { models: [], error: 'Add a Gemini key to list Gemini models.' };

  const models: ModelOption[] = [];
  let pageToken: string | undefined;
  try {
    for (let page = 0; page < MAX_MODEL_PAGES; page++) {
      const path =
        `/v1beta/models?pageSize=1000&key=${encodeURIComponent(key)}` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
      const res = await requestWithFallback(
        `/api/gemini${path}`,
        `https://generativelanguage.googleapis.com${path}`,
        {}
      );
      if (!res.ok) return { models: [], error: await describeFailure(res) };
      const json = await res.json();
      for (const m of (json.models || []) as GeminiModel[]) {
        if (m.supportedGenerationMethods && !m.supportedGenerationMethods.includes('generateContent')) continue;
        const id = String(m.name).replace(/^models\//, '');
        models.push({ id, name: m.displayName || id });
      }
      pageToken = json.nextPageToken;
      if (!pageToken) break;
    }
  } catch {
    return { models: [], error: 'Could not reach the Gemini API.' };
  }
  return { models };
}

/** The provider's own message where there is one — 401 vs 403 vs quota matters. */
async function describeFailure(res: Response): Promise<string> {
  try {
    const json = await res.json();
    const message = json?.error?.message;
    if (message) return String(message);
  } catch {
    // Not JSON, or already consumed — the status is all we have.
  }
  return `The provider returned ${res.status}.`;
}
