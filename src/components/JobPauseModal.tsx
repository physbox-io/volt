import React from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';

export interface JobPauseModalProps {
  /** Text from the controller: which tool, or why the stream stopped. */
  message: string;
  /**
   * True at an M0 / M6 stream pause, where the buffer has drained and the
   * machine will accept commands. False during an operator feed hold, where
   * GRBL is in Hold and only Resume or Cancel are meaningful.
   */
  isStreamPaused: boolean;
  /** Name of the operation that "restart layer" would re-run, if known. */
  layerLabel?: string | null;
  /** Non-empty while some machine action is in flight; buttons lock. */
  busy: string;
  error?: string | null;
  onResume: () => void;
  onCancel: () => void;
  onZeroOnCopper: () => void;
  onZeroOnPlate: () => void;
  onRestartLayer: () => void;
}

/**
 * A tool change stops the machine mid-job and needs the operator's hands and
 * attention. As a panel inside one tab of the CAM dialog it was easy to miss —
 * and everything it offers (re-zero, restart the layer, resume) is only
 * reachable while the pause is live. So it takes over the screen instead.
 *
 * Deliberately not dismissable by clicking away: the job is stopped with the
 * spindle parked over the stock, and every exit from that state is a decision
 * the operator has to make explicitly.
 */
export const JobPauseModal: React.FC<JobPauseModalProps> = ({
  message,
  isStreamPaused,
  layerLabel,
  busy,
  error,
  onResume,
  onCancel,
  onZeroOnCopper,
  onZeroOnPlate,
  onRestartLayer,
}) => {
  const locked = !!busy;

  return (
    <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-amber-400 dark:border-amber-600/70 rounded-xl shadow-2xl overflow-hidden">
        <div className="px-5 py-3.5 bg-amber-100 dark:bg-amber-950/50 border-b border-amber-300 dark:border-amber-700/60 flex items-start gap-2.5">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-amber-700 dark:text-amber-300" />
          <div>
            <div className="font-bold text-amber-900 dark:text-amber-200">Job paused</div>
            <div className="text-[12px] text-amber-800 dark:text-amber-300/90 leading-relaxed">
              {message}
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {isStreamPaused && (
            <div className="space-y-2">
              <div className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                A new bit is a different length, so work Z0 no longer matches the tool. Re-zero
                before resuming, or this operation cuts at the wrong depth.
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onZeroOnCopper}
                  disabled={locked}
                  className="flex-1 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-800 dark:text-slate-200 rounded font-semibold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {busy === 'zeroing' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  Re-zero Z on copper
                </button>
                <button
                  onClick={onZeroOnPlate}
                  disabled={locked}
                  className="flex-1 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-800 dark:text-slate-200 rounded font-semibold text-[11px] cursor-pointer"
                >
                  Re-zero Z on plate
                </button>
              </div>
            </div>
          )}

          {/* The recovery for a layer already cut at the wrong depth — a bit
              swapped without re-zeroing is exactly when this is wanted, and by
              then Resume would only carry the mistake forward. */}
          {isStreamPaused && layerLabel && (
            <button
              onClick={onRestartLayer}
              disabled={locked}
              className="w-full py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-800 dark:text-slate-200 rounded font-semibold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer"
              title="Rewind to the start of this operation and cut it again"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Restart layer — {layerLabel}
            </button>
          )}

          {error && (
            <div className="text-[11px] text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-950/40 border border-red-300 dark:border-red-800 rounded p-2 leading-relaxed">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={onResume}
              disabled={locked}
              className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded font-semibold cursor-pointer"
            >
              Resume job
            </button>
            <button
              onClick={onCancel}
              disabled={locked}
              className="px-4 py-2.5 bg-slate-200 dark:bg-slate-800 hover:bg-red-100 dark:hover:bg-red-900/60 disabled:opacity-40 disabled:cursor-not-allowed text-slate-800 dark:text-slate-200 rounded font-semibold cursor-pointer"
            >
              Cancel job
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
