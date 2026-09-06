/**
 * Copilot settings, stored in localStorage under the same key names `etch` and
 * `physics` use, so a key entered in one Physbox app works in the others on the
 * same browser — and, when signed in, on the others' browsers too.
 *
 * Keys live in the browser and are sent straight from it to the provider when
 * making a request. They are *also* synced to your PhysBox account under the
 * `global` app id when you are signed in, which means the key is stored on the
 * PhysBox server as well as locally: anything with access to either this
 * origin's localStorage or that account can read it. Use a key scoped to this
 * purpose.
 */

import { syncCloudParameters, fetchCloudParameters } from './apiClient';

export const GEMINI_KEY = 'gemini_api_key';
export const ANTHROPIC_KEY = 'anthropic_api_key';
export const MODEL_KEY = 'gemini_model';
export const MAX_TOKENS_KEY = 'copilot_max_tokens';

export const DEFAULT_MODEL = 'claude-opus-5';

export const DEFAULT_MAX_TOKENS = 16000;
export const MIN_MAX_TOKENS = 2000;
export const MAX_MAX_TOKENS = 64000;

/** Shown until the provider's own model list arrives. */
export const FALLBACK_MODELS: { id: string; name: string }[] = [
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1' },
  { id: 'claude-opus-5', name: 'Claude Opus 5' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
];

export const isClaudeModel = (model: string) => model.startsWith('claude');

/** A display name for a model id, for the copilot header. */
export const modelDisplayName = (id: string) =>
  FALLBACK_MODELS.find((m) => m.id === id)?.name ?? id;

/**
 * The copilot settings that follow the account, under the `global` app id.
 *
 * An allowlist rather than "whatever is in localStorage": what comes back from
 * the server is only ever written to these keys, never to whatever key name the
 * response happens to carry. The names are identical to the ones `etch` and
 * `physics` sync — `global` is one shared namespace, so renaming a key here
 * silently unpairs the apps.
 */
export const SYNCED_LLM_PARAMETER_KEYS: readonly string[] = [
  GEMINI_KEY,
  ANTHROPIC_KEY,
  MODEL_KEY,
  MAX_TOKENS_KEY,
];

const read = (key: string): string => {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    // localStorage throws in private-mode / sandboxed contexts.
    return '';
  }
};

const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Non-fatal: the setting just won't survive a reload.
  }
  // Fire-and-forget, and a no-op when signed out: a failed upload must never be
  // the reason a setting does not stick locally.
  void syncCloudParameters('global', { [key]: value });
};

export const readGeminiKey = () => read(GEMINI_KEY);
export const readAnthropicKey = () => read(ANTHROPIC_KEY);
export const writeGeminiKey = (v: string) => write(GEMINI_KEY, v.trim());
export const writeAnthropicKey = (v: string) => write(ANTHROPIC_KEY, v.trim());

export const readModel = () => read(MODEL_KEY) || DEFAULT_MODEL;
export const writeModel = (v: string) => write(MODEL_KEY, v);

export const clampMaxTokens = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_MAX_TOKENS;
  return Math.min(MAX_MAX_TOKENS, Math.max(MIN_MAX_TOKENS, Math.round(value)));
};

/**
 * The output budget. This is user-visible because the failure it controls is
 * silent and expensive: when the circuit JSON doesn't fit in the reply, it is
 * cut off mid-structure, parsing fails, and nothing is applied.
 */
export const readMaxTokens = (): number => {
  const raw = read(MAX_TOKENS_KEY);
  if (!raw) return DEFAULT_MAX_TOKENS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? clampMaxTokens(parsed) : DEFAULT_MAX_TOKENS;
};

export const writeMaxTokens = (value: number): number => {
  const clamped = clampMaxTokens(value);
  write(MAX_TOKENS_KEY, String(clamped));
  return clamped;
};

/**
 * Pulls the account's copilot settings down into this browser, so a key entered
 * in `etch` or `physics` is already there when the copilot is first opened here.
 *
 * Local values win: the sign-in that triggers this may well have happened *after*
 * a key was typed into this browser, and overwriting it would lose the newer of
 * the two. Only keys with nothing local are filled in.
 */
export const restoreLlmSettingsFromCloud = async (): Promise<void> => {
  let params: Record<string, unknown>;
  try {
    params = await fetchCloudParameters('global');
  } catch {
    return; // Signed out, offline, or the server said no — keep what's local.
  }
  for (const key of SYNCED_LLM_PARAMETER_KEYS) {
    const value = params?.[key];
    if (value === undefined || value === null || value === '') continue;
    if (read(key)) continue;
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // Nothing to do — the setting simply stays unset in this browser.
    }
  }
  // Panels read localStorage on mount and on 'storage'; this write is same-tab,
  // which does not fire that event on its own.
  window.dispatchEvent(new Event('storage'));
};
