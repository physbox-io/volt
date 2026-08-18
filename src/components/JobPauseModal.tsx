import React from 'react';
import { AlertCircle, Play, RefreshCw } from 'lucide-react';

export interface JobPauseModalProps {
  /** Text from the controller: which tool, or why the stream stopped. */
  message: string;
  /**
   * True at an M0 / M6 stream pause, where the buffer has drained and the
   * machine will accept commands. False during an operator feed hold, where
   * GRBL is in Hold and only Resume or Cancel are meaningful.
   */
  isStreamPaused: boolean;
  /** Thickness of the touch plate, so the button can name what it assumes. */
  touchPlateMm: number;
  /** Non-empty while some machine action is in flight; buttons lock. */
  busy: string;
  error?: string | null;
  onResume: () => void;
  onCancel: () => void;
  onZeroOnCopper: () => void;
  onZeroOnPlate: () => void;
}

/**
 * A tool change stops the machine mid-job and needs the operator's hands. As a
 * panel inside one tab of the CAM dialog it was easy to miss — and everything
 * it offers is only reachable while the pause is live. So it takes over the
 * screen instead.
 *
 * The amber card, the "Action Required" framing and the pulsing alert are
 * lifted from the relief-carve pause panel in the physics app, which sets the
 * house style for "the machine is waiting on you".
 *
 * Deliberately not dismissable by clicking away: the job is stopped with the
 * tool parked over the stock, and every way out of that is a decision the
 * operator has to make on purpose.
 */
export const JobPauseModal: React.FC<JobPauseModalProps> = ({
  message,
  isStreamPaused,
  touchPlateMm,
  busy,
  error,
  onResume,
  onCancel,
  onZeroOnCopper,
  onZeroOnPlate,
}) => {
  const locked = !!busy;
  const secondary =
    'px-3 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 ' +
    'disabled:opacity-40 disabled:cursor-not-allowed text-slate-800 dark:text-slate-100 ' +
    'text-xs font-semibold rounded-lg cursor-pointer flex items-center justify-center gap-1.5';

  return (
    <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg p-4 rounded-xl bg-amber-50 dark:bg-slate-900 border-2 border-amber-500 shadow-2xl flex flex-col space-y-3 text-amber-800 dark:text-amber-300">
        <div className="flex items-center space-x-3">
          {/* Only the icon pulses. Physics pulses the whole card, which reads
              well as a small inline panel but makes a full-screen dialog hard
              to actually read. */}
          <AlertCircle className="w-6 h-6 text-amber-500 flex-shrink-0 animate-pulse" />
          <div>
            <h4 className="font-bold text-sm">Action Required: Machine Paused</h4>
            <p className="text-xs leading-relaxed font-semibold">{message}</p>
          </div>
        </div>

        {isStreamPaused && (
          <div className="space-y-2 pt-2 border-t border-amber-500/30">
            <p className="text-[11px] leading-relaxed">
              A new bit is a different length, so work Z0 no longer matches the tool. Re-zero
              before resuming, or this operation cuts at the wrong depth.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={onZeroOnCopper} disabled={locked} className={secondary}>
                {busy === 'zeroing' && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                Auto-Zero Z (Copper)
              </button>
              <button onClick={onZeroOnPlate} disabled={locked} className={secondary}>
                Auto-Zero Z ({touchPlateMm}mm Touch Plate)
              </button>
            </div>

            {/* XY needs no such care: every operation opens with an absolute
                `G0 X.. Y..` before it plunges, so jogging here is undone by
                the job's own next move. Z is the one that does not fix itself,
                because re-zeroing is what redefines it. */}
            <p className="text-[11px] leading-relaxed opacity-90">
              <span className="font-semibold">XY is safe to jog.</span> The job repositions itself
              with an absolute move before it cuts again, so it returns to its own coordinates
              without help. Just do not park the tool where it cannot travel back — the first move
              is a rapid.
            </p>

          </div>
        )}

        {error && (
          <div className="text-[11px] text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-950/40 border border-red-300 dark:border-red-800 rounded-lg p-2 leading-relaxed">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end space-x-3 pt-2 border-t border-amber-500/30">
          <button
            onClick={onCancel}
            disabled={locked}
            className="px-3 py-1.5 text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold rounded-lg cursor-pointer"
          >
            Cancel job
          </button>
          <button
            onClick={onResume}
            disabled={locked}
            className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold text-xs rounded-lg flex items-center space-x-1.5 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Resume Job (Cycle Start)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
