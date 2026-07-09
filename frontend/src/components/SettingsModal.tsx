import { useState } from 'react';
import { X, Settings, Trash2, BookOpen, Inbox, Key } from 'lucide-react';
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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <Settings size={20} />
            <h2 className="text-lg font-bold tracking-tight">Preferences</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/20 rounded-full text-white transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
          <button
            onClick={() => setTab('general')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-semibold transition-colors cursor-pointer ${
              tab === 'general'
                ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 bg-white dark:bg-slate-900'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            <BookOpen size={15} />
            General
          </button>
          <button
            onClick={() => setTab('presets')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-semibold transition-colors cursor-pointer ${
              tab === 'presets'
                ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 bg-white dark:bg-slate-900'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            <Inbox size={15} />
            Saved Presets
            {userPresetKeys.length > 0 && (
              <span className="ml-1 bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {userPresetKeys.length}
              </span>
            )}
          </button>
        </div>

        {/* Body */}
        <div className="p-6 animate-in fade-in duration-150" style={{ minHeight: 200 }}>
          {tab === 'general' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between group">
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-200">Electric Aura</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Visualize current flow in wires</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showAura}
                    onChange={(e) => setShowAura(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 dark:bg-slate-800 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-900 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 dark:border-slate-600 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-650" />
                </label>
              </div>

              <div className="pt-4 border-t border-slate-100 dark:border-slate-800/60">
                <label htmlFor="geminiApiKey" className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-widest mb-2">
                  <Key size={14} className="text-slate-500 dark:text-slate-400" />
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
                  placeholder="Paste AIzaSy... here"
                  className="w-full px-3.5 py-2 text-xs border border-slate-200 dark:border-slate-800 rounded-xl shadow-inner focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100"
                />
                <p className="mt-1.5 text-[10px] text-slate-400 dark:text-slate-500 leading-normal">
                  Your API key is saved locally in your browser and used only to communicate directly with Google's Gemini endpoints.
                </p>
              </div>

              <div className="pt-4 border-t border-slate-100 dark:border-slate-800/60">
                <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-widest font-bold mb-2">Simulation Engine</p>
                <div className="bg-slate-50 dark:bg-slate-950/60 rounded-lg p-3 text-xs text-slate-650 dark:text-slate-300 border border-slate-100 dark:border-slate-800/60">
                  Running on <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">ngspice-wasm</span>
                </div>
              </div>
            </div>
          )}

          {tab === 'presets' && (
            <div>
              {userPresetKeys.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-10 text-slate-400 dark:text-slate-500">
                  <Inbox size={36} strokeWidth={1.2} />
                  <p className="text-sm font-medium text-center text-slate-500 dark:text-slate-450">No saved presets yet.<br />Use the 💾 button to save your circuit.</p>
                </div>
              ) : (
                <ul className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {userPresetKeys.map((key) => (
                    <li
                      key={key}
                      className="flex items-center justify-between bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 group hover:border-indigo-200 dark:hover:border-indigo-850 transition-colors"
                    >
                      <div>
                        <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{userPresets[key].name}</div>
                        <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">{key}</div>
                      </div>
                      <button
                        onClick={() => onDeleteUserPreset(key)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-650 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                        title="Delete preset"
                      >
                        <Trash2 size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="bg-slate-50 dark:bg-slate-950/60 px-6 py-4 flex justify-end border-t border-slate-100 dark:border-slate-850">
          <button
            onClick={onClose}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-xl font-bold text-sm shadow-lg shadow-indigo-200 dark:shadow-none transition-all active:scale-95 cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
