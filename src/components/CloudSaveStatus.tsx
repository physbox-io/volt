import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { Cloud, CloudOff, Check, Loader2, AlertTriangle } from 'lucide-react';
import { cloudAutosave, type AutosaveStatus } from '../utils/cloudDocuments';

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

export const CloudSaveStatus: React.FC = () => {
  const [status, setStatus] = useState<AutosaveStatus>(cloudAutosave.getStatus());
  const [busy, setBusy] = useState(false);
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

  if (!visible) return null;

  /**
   * Both choices keep both versions of the work.
   *
   * There is deliberately no "take theirs" here. Nothing in this app loads a
   * document *from* the account — the local copy is always what is on screen — so
   * a button offering the other version could fetch it and then have nowhere to put
   * it. Forking is the honest form of the same wish: both survive, under different
   * ids, and neither is thrown away by a badge in the corner.
   */
  const resolve = (action: 'keep' | 'fork') => {
    if (action === 'fork') {
      cloudAutosave.forkDocument();
      return;
    }
    setBusy(true);
    void cloudAutosave.keepLocalCopy().finally(() => setBusy(false));
  };

  return ReactDOM.createPortal(
    <div
      className="fixed bottom-4 left-4 z-[99998] max-w-xs text-xs pointer-events-auto"
      role="status"
      aria-live="polite"
    >
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
      ) : (
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
