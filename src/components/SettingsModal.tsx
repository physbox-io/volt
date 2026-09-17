import { useEffect, useState } from 'react';
import { X, Settings, Key } from 'lucide-react';
import { listClaudeModels, listGeminiModels, type ModelListing } from '../utils/llmClient';
import {
  FALLBACK_MODELS,
  MAX_MAX_TOKENS,
  MIN_MAX_TOKENS,
  isClaudeModel,
  readAnthropicKey,
  readGeminiKey,
  readMaxTokens,
  readModel,
  writeAnthropicKey,
  writeGeminiKey,
  writeMaxTokens,
  writeModel,
} from '../utils/llmSettings';

interface SettingsModalProps {
  onClose: () => void;
  showAura: boolean;
  setShowAura: (v: boolean) => void;
}

export function SettingsModal({ onClose, showAura, setShowAura }: SettingsModalProps) {
  const [geminiApiKey, setGeminiApiKey] = useState(readGeminiKey);
  const [anthropicApiKey, setAnthropicApiKey] = useState(readAnthropicKey);
  const [model, setModel] = useState(readModel);
  const [maxTokens, setMaxTokens] = useState(readMaxTokens);
  const [claudeListing, setClaudeListing] = useState<ModelListing>({ models: [] });
  const [geminiListing, setGeminiListing] = useState<ModelListing>({ models: [] });

  // The copilot panel reads these from localStorage, so it has to be told when
  // they change; a same-tab write does not fire 'storage' on its own.
  const announce = () => window.dispatchEvent(new Event('storage'));

  // The picker lists what the configured keys can actually reach, refetched
  // whenever a key changes, so a newly released model shows up without a
  // release of this app. Without a key each group falls back to the built-in
  // list rather than showing nothing.
  useEffect(() => {
    let cancelled = false;
    // Delayed, because the keys are re-read as they are typed: without this
    // every keystroke in a key field starts a paged fetch that can only fail.
    const timer = setTimeout(() => {
      void (async () => {
        const [claude, gemini] = await Promise.all([listClaudeModels(), listGeminiModels()]);
        if (cancelled) return;
        setClaudeListing(claude);
        setGeminiListing(gemini);
      })();
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [anthropicApiKey, geminiApiKey]);

  const claudeOptions = claudeListing.models.length
    ? claudeListing.models
    : FALLBACK_MODELS.filter((m) => isClaudeModel(m.id));
  const geminiOptions = geminiListing.models.length
    ? geminiListing.models
    : FALLBACK_MODELS.filter((m) => !isClaudeModel(m.id));
  // Named so the picker never looks merely out of date when it is actually
  // showing the built-in list because a key was missing or rejected.
  const listingProblems = [claudeListing.error, geminiListing.error].filter(Boolean) as string[];
  const isKnownModel = [...claudeOptions, ...geminiOptions].some((m) => m.id === model);

  const fieldClass =
    'w-full px-2 py-1.5 text-xs border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 shadow-inner focus:outline-none focus:ring-1 focus:ring-emerald-500';
  const labelClass =
    'block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1';

  return (
    <div className="absolute top-4 right-6 w-64 md:w-72 glass-panel rounded-lg p-4 z-30 shadow-lg text-slate-800 dark:text-slate-100 flex flex-col gap-3 animate-in fade-in zoom-in-95 duration-200 pointer-events-auto">
      {/* Header */}
      <h3 className="font-semibold text-sm flex items-center justify-between text-slate-800 dark:text-slate-100">
        <span className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          Preferences
        </span>
        <button onClick={onClose} className="cursor-pointer">
          <X className="w-4 h-4 text-slate-400 dark:text-slate-500 hover:text-slate-655 dark:hover:text-slate-300" />
        </button>
      </h3>

      {/* Body */}
      <div className="flex flex-col gap-3.5 text-xs">
        <div className="flex items-center justify-between py-0.5">
          <div className="flex flex-col">
            <span className="font-semibold text-slate-800 dark:text-slate-200">Electric Aura</span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">Visualize wire current flow</span>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={showAura}
              onChange={(e) => setShowAura(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-slate-200 dark:bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 dark:border-slate-600 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500" />
          </label>
        </div>

        <div className="pt-3.5 border-t border-slate-100 dark:border-slate-800/60 flex flex-col gap-3">
          <div>
            <label htmlFor="anthropicApiKey" className={labelClass}>
              <Key size={12} className="text-slate-500 dark:text-slate-400" />
              Anthropic API Key
            </label>
            <input
              type="password"
              id="anthropicApiKey"
              value={anthropicApiKey}
              onChange={(e) => {
                setAnthropicApiKey(e.target.value);
                writeAnthropicKey(e.target.value);
                announce();
              }}
              placeholder="Paste sk-ant-... here"
              className={`${fieldClass} font-mono`}
            />
          </div>

          <div>
            <label htmlFor="geminiApiKey" className={labelClass}>
              <Key size={12} className="text-slate-500 dark:text-slate-400" />
              Gemini API Key
            </label>
            <input
              type="password"
              id="geminiApiKey"
              value={geminiApiKey}
              onChange={(e) => {
                setGeminiApiKey(e.target.value);
                writeGeminiKey(e.target.value);
                announce();
              }}
              placeholder="Paste AIzaSy... here"
              className={`${fieldClass} font-mono`}
            />
          </div>

          <div>
            <label htmlFor="copilotModel" className={labelClass}>
              Copilot Model
            </label>
            <select
              id="copilotModel"
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                writeModel(e.target.value);
                announce();
              }}
              className={`${fieldClass} cursor-pointer`}
            >
              {/* A model saved before the key that lists it still shows,
                  rather than the select silently snapping to its first entry. */}
              {isKnownModel ? null : <option value={model}>{model}</option>}
              <optgroup label="Anthropic Claude">
                {claudeOptions.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </optgroup>
              <optgroup label="Google Gemini">
                {geminiOptions.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </optgroup>
            </select>
            {listingProblems.length > 0 && (
              <p className="text-[9px] text-slate-400 dark:text-slate-500 leading-normal mt-1">
                Showing the built-in list: {listingProblems.join(' ')}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="copilotMaxTokens" className={`${labelClass} justify-between`}>
              <span>Max Response Tokens</span>
              <span className="font-mono normal-case tracking-normal text-slate-600 dark:text-slate-300">
                {maxTokens.toLocaleString()}
              </span>
            </label>
            <input
              type="range"
              id="copilotMaxTokens"
              min={MIN_MAX_TOKENS}
              max={MAX_MAX_TOKENS}
              step={1000}
              value={maxTokens}
              onChange={(e) => {
                setMaxTokens(writeMaxTokens(parseInt(e.target.value, 10)));
                announce();
              }}
              className="w-full accent-blue-500 cursor-pointer"
            />
            <p className="text-[9px] text-slate-400 dark:text-slate-500 leading-normal">
              Output budget for one copilot reply. Raise it if a generated schematic comes back
              cut off; lower it to cut cost and latency.
            </p>
          </div>

          <p className="text-[9px] text-amber-700 dark:text-amber-400 leading-normal">
            Keys are stored in this browser and sent straight to the provider. When you are
            signed in they also sync to your PhysBox account, so the other Physbox apps can use
            them — clear them on a shared machine.
          </p>
        </div>
      </div>
    </div>
  );
}
