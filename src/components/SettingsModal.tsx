import { useEffect, useState } from 'react';
import { X, Settings, Trash2, Key } from 'lucide-react';
import type { CircuitPreset } from '../utils/storage';
import { listClaudeModels, listGeminiModels } from '../utils/llmClient';
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
  userPresets: Record<string, CircuitPreset>;
  onDeleteUserPreset: (key: string) => void;
}

export function SettingsModal({ onClose, showAura, setShowAura, userPresets, onDeleteUserPreset }: SettingsModalProps) {
  const [tab, setTab] = useState<'general' | 'presets'>('general');
  const [geminiApiKey, setGeminiApiKey] = useState(readGeminiKey);
  const [anthropicApiKey, setAnthropicApiKey] = useState(readAnthropicKey);
  const [model, setModel] = useState(readModel);
  const [maxTokens, setMaxTokens] = useState(readMaxTokens);
  const [claudeModels, setClaudeModels] = useState<{ id: string; name: string }[]>([]);
  const [geminiModels, setGeminiModels] = useState<{ id: string; name: string }[]>([]);
  const userPresetKeys = Object.keys(userPresets);

  // The copilot panel reads these from localStorage, so it has to be told when
  // they change; a same-tab write does not fire 'storage' on its own.
  const announce = () => window.dispatchEvent(new Event('storage'));

  // The picker lists what the configured keys can actually reach, refetched
  // whenever a key changes, so a newly released model shows up without a
  // release of this app. Without a key each group falls back to the built-in
  // list rather than showing nothing.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [claude, gemini] = await Promise.all([listClaudeModels(), listGeminiModels()]);
      if (cancelled) return;
      setClaudeModels(claude);
      setGeminiModels(gemini);
    })();
    return () => {
      cancelled = true;
    };
  }, [anthropicApiKey, geminiApiKey]);

  const claudeOptions = claudeModels.length ? claudeModels : FALLBACK_MODELS.filter((m) => isClaudeModel(m.id));
  const geminiOptions = geminiModels.length ? geminiModels : FALLBACK_MODELS.filter((m) => !isClaudeModel(m.id));
  const isKnownModel = [...claudeOptions, ...geminiOptions].some((m) => m.id === model);

  const fieldClass =
    'w-full px-2 py-1.5 text-xs border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 shadow-inner focus:outline-none focus:ring-1 focus:ring-blue-500';
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

      {/* Tab Bar */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 text-xs">
        <button
          onClick={() => setTab('general')}
          className={`pb-2 pr-4 font-semibold transition-colors cursor-pointer ${
            tab === 'general'
              ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-500'
              : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
          }`}
        >
          General
        </button>
        <button
          onClick={() => setTab('presets')}
          className={`pb-2 px-4 font-semibold transition-colors cursor-pointer flex items-center gap-1 ${
            tab === 'presets'
              ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-500'
              : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
          }`}
        >
          Presets
          {userPresetKeys.length > 0 && (
            <span className="bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-400 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
              {userPresetKeys.length}
            </span>
          )}
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-3.5 text-xs">
        {tab === 'general' && (
          <>
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
                <div className="w-9 h-5 bg-slate-200 dark:bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 dark:border-slate-600 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500" />
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

            <div className="pt-3.5 border-t border-slate-100 dark:border-slate-800/60">
              <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-bold mb-1.5">Simulation Engine</p>
              <div className="bg-slate-50 dark:bg-slate-950/60 rounded px-2.5 py-1.5 text-[11px] text-slate-600 dark:text-slate-350 border border-slate-100 dark:border-slate-800/60">
                Running on <span className="font-mono font-bold text-blue-600 dark:text-blue-400">ngspice-wasm</span>
              </div>
            </div>
          </>
        )}

        {tab === 'presets' && (
          <div className="max-h-52 overflow-y-auto space-y-1.5 pr-0.5">
            {userPresetKeys.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-6">No saved presets yet.</p>
            ) : (
              userPresetKeys.map((key) => (
                <div key={key} className="flex items-center justify-between bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded px-2.5 py-2 group hover:border-blue-200 dark:hover:border-blue-900/60 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{userPresets[key].name}</div>
                    <div className="text-[9px] text-slate-400 dark:text-slate-500 font-mono truncate">{key}</div>
                  </div>
                  <button
                    onClick={() => onDeleteUserPreset(key)}
                    className="p-1 rounded text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-55 dark:hover:bg-red-950/20 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                    title="Delete preset"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
