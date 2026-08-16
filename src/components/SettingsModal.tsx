import { useState } from 'react';
import { X, Settings, Trash2, Key } from 'lucide-react';
import type { CircuitPreset } from '../utils/storage';

interface SettingsModalProps {
  onClose: () => void;
  showAura: boolean;
  setShowAura: (v: boolean) => void;
  userPresets: Record<string, CircuitPreset>;
  onDeleteUserPreset: (key: string) => void;
}

export function SettingsModal({ onClose, showAura, setShowAura, userPresets, onDeleteUserPreset }: SettingsModalProps) {
  const [tab, setTab] = useState<'general' | 'presets'>('general');
  const [geminiApiKey, setGeminiApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const userPresetKeys = Object.keys(userPresets);

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

            <div className="pt-3.5 border-t border-slate-100 dark:border-slate-800/60">
              <label htmlFor="geminiApiKey" className="block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                <Key size={12} className="text-slate-500 dark:text-slate-400" />
                Gemini API Key
              </label>
              <input
                type="password"
                id="geminiApiKey"
                value={geminiApiKey}
                onChange={(e) => {
                  setGeminiApiKey(e.target.value);
                  localStorage.setItem('gemini_api_key', e.target.value);
                }}
                placeholder="Paste API key here"
                className="w-full px-2 py-1.5 text-xs border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-200 shadow-inner focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
              />
              <p className="mt-1 text-[9px] text-slate-400 dark:text-slate-500 leading-normal">
                Saved locally. Direct communication with Gemini endpoint.
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
