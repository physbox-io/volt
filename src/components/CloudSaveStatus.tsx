import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { Cloud, CloudOff, Check, Loader2, AlertTriangle, History, X } from 'lucide-react';
import { cloudAutosave, type AutosaveStatus } from '../utils/cloudDocuments';
import { PRESET_KEPT_BOTH_EVENT } from '../utils/presetSync';

/**
 * What cloud auto-save is doing, when there is something worth saying.
 *
 * Mostly there is not, and then this renders nothing at all: a permanent "saved"
 * badge is noise, and a free or signed-out session should see no trace of a
 * feature it does not have.
 *
 * The case it really exists for is the conflict. Two browsers open on one document
 * would otherwise take turns overwriting each other, so the server refuses a write
 * built on a stale revision and the engine stops writing — and stopping silently
 * would be the worst of the three outcomes. This is where the person gets asked.
 *
 * A fixed-position portal rather than a slot in the layout: three apps have three
 * different chromes, and a corner is somewhere all of them have.
 */

const AUTO_HIDE_MS = 2500;
const KEPT_BOTH_HIDE_MS = 8000;

/** How long ago, as something to put in a sentence. */
function timeAgo(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export const CloudSaveStatus: React.FC = () => {
  const [status, setStatus] = useState<AutosaveStatus>(cloudAutosave.getStatus());
  const [busy, setBusy] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  /** Two saves could not share a name, so one has a new one: worth a sentence, not a question. */
  const [keptBoth, setKeptBoth] = useState<string | null>(null);

  useEffect(() => {
    const show = (event: Event) => {
      const { name, copy } = (event as CustomEvent<{ name: string; copy: string }>).detail;
      setKeptBoth(`“${name}” was also saved elsewhere. That version is “${copy}”.`);
    };
    window.addEventListener(PRESET_KEPT_BOTH_EVENT, show);
    return () => window.removeEventListener(PRESET_KEPT_BOTH_EVENT, show);
  }, []);
  useEffect(() => {
    if (!keptBoth) return;
    const timer = setTimeout(() => setKeptBoth(null), KEPT_BOTH_HIDE_MS);
    return () => clearTimeout(timer);
  }, [keptBoth]);
  /** Whether the "saved" badge is still within its welcome. */
  const [showSaved, setShowSaved] = useState(false);

  /*
   * Subscribing to an external store, which is the one thing an effect is
   * unambiguously for. Raising the badge here rather than in an effect body keeps
   * it out of the render path: it is a reaction to something happening outside
   * React, not state derived from a render.
   */
  useEffect(
    () =>
      cloudAutosave.subscribe((next) => {
        setStatus(next);
        if (next.state === 'saved') setShowSaved(true);
      }),
    []
  );

  // "Saved" is worth a glance, then worth getting out of the way.
  useEffect(() => {
    if (!showSaved) return;
    const timer = setTimeout(() => setShowSaved(false), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [showSaved, status.savedAt]);

  const conflict = status.state === 'conflict';
  const visible =
    conflict ||
    status.state === 'saving' ||
    status.state === 'offline' ||
    (status.state === 'saved' && showSaved);

  const { draft } = status;
  if (!visible && !draft && !keptBoth) return null;

  /**
   * Both choices keep both versions of the work.
   *
   * There is deliberately no "take theirs" here: it would throw away what is on
   * screen from a badge in the corner. Forking is the honest form of the same
   * wish: both survive, under different ids.
   */
  const resolve = (action: 'keep' | 'fork') => {
    if (action === 'fork') {
      cloudAutosave.forkDocument();
      return;
    }
    setBusy(true);
    void cloudAutosave.keepLocalCopy().finally(() => setBusy(false));
  };

  const restore = () => {
    setBusy(true);
    void cloudAutosave.restoreDraft().then((restored) => {
      setRestoreFailed(!restored);
      setBusy(false);
    });
  };

  return ReactDOM.createPortal(
    <div
      className="fixed bottom-4 left-4 z-[99998] max-w-xs text-xs pointer-events-auto flex flex-col items-start gap-2"
      role="status"
      aria-live="polite"
    >
      {keptBoth && (
        <div className="px-2.5 py-1.5 rounded-xl bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-lg text-slate-600 dark:text-slate-300">
          {keptBoth}
        </div>
      )}
      {draft && (
        <div className="inline-flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 rounded-full bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-lg text-slate-600 dark:text-slate-300">
          <History className="w-3.5 h-3.5 shrink-0 text-cyan-600 dark:text-cyan-400" />
          <span className="truncate">
            {restoreFailed ? 'Could not fetch it' : `Unsaved “${draft.name}”, ${timeAgo(draft.at)}`}
          </span>
          <button
            onClick={restore}
            disabled={busy}
            className="px-2 py-0.5 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold cursor-pointer shrink-0"
          >
            {restoreFailed ? 'Retry' : 'Restore'}
          </button>
          <button
            onClick={() => cloudAutosave.dismissDraft()}
            disabled={busy}
            aria-label="Discard unsaved work"
            title="Discard"
            className="p-0.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {conflict ? (
        <div className="bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-500/40 rounded-xl shadow-2xl p-3 space-y-2 text-slate-700 dark:text-slate-200">
          <div className="flex items-start gap-2 font-bold text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Changed on another device</span>
          </div>
          <p className="leading-relaxed">
            This document was saved somewhere else since you opened it, so cloud saving has
            paused rather than overwrite it. Your work here is still saved on this device.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            <button
              onClick={() => resolve('keep')}
              disabled={busy}
              className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer"
            >
              Keep mine
            </button>
            <button
              onClick={() => resolve('fork')}
              disabled={busy}
              className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold cursor-pointer"
            >
              Save as a copy
            </button>
          </div>
        </div>
      ) : visible && (
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-lg text-slate-600 dark:text-slate-300">
          {status.state === 'saving' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {status.state === 'saved' && <Check className="w-3.5 h-3.5 text-emerald-500" />}
          {status.state === 'offline' && <CloudOff className="w-3.5 h-3.5 text-amber-500" />}
          {status.state === 'saving' && <span>Saving to your account…</span>}
          {status.state === 'saved' && <span>Saved to your account</span>}
          {status.state === 'offline' && <span>{status.message ?? 'Not synced'}</span>}
          {status.state === 'saved' && <Cloud className="w-3.5 h-3.5 opacity-40" />}
        </div>
      )}
    </div>,
    document.body
  );
};
