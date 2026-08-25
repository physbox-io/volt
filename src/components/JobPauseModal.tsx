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
  /**
   * Spindle speed the job resumes at. Shown because the bit going in is what
   * that speed has to suit: a 0.8mm drill and a 1.5mm end mill do not want the
   * same RPM, and the number is otherwise buried in a tab behind this dialog at
   * the one moment the operator has their hands on the machine.
   */
  spindleRpm: number;
  /**
   * How far the two stabs of the last Z zeroing probe disagreed, in mm — shown
   * here because this is the moment the operator zeroes, and a probe that
   * cannot agree with itself is worth knowing about before the next operation
   * cuts against it rather than after.
   */
  zeroScatterMm?: number;
  /** Non-empty while some machine action is in flight; buttons lock. */
  busy: string;
  /**
   * True while work Z0 still describes the bit that came *out*. Resuming on it
   * cuts as deep as the two bits differ in length, so Resume stays locked until
   * Z has been re-zeroed.
   */
  needsZero: boolean;
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
  spindleRpm,
  zeroScatterMm,
  busy,
  needsZero,
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
            <div className="flex items-center justify-between gap-2 bg-slate-900/5 dark:bg-slate-950/50 border border-amber-500/30 rounded-lg px-2.5 py-1.5">
              <span className="text-[11px] font-semibold">Spindle speed on resume</span>
              <span className="font-mono text-sm font-bold tabular-nums">
                {spindleRpm.toLocaleString()} <span className="text-[10px] font-semibold opacity-70">RPM</span>
              </span>
            </div>

            <p className="text-[11px] leading-relaxed">
              A new bit is a different length, so work Z0 no longer matches the tool. Resume
              unlocks once Z has been re-zeroed. The tool is parked clear of the board and the
              spindle is stopped, so it is safe to change the bit now.
            </p>

            {zeroScatterMm !== undefined && (
              <div className="flex items-center justify-between gap-2 bg-slate-900/5 dark:bg-slate-950/50 border border-amber-500/30 rounded-lg px-2.5 py-1.5">
                <span className="text-[11px] font-semibold">Last zero, two stabs agreed to</span>
                <span className="font-mono text-sm font-bold tabular-nums">
                  {zeroScatterMm.toFixed(3)}<span className="text-[10px] font-semibold opacity-70">mm</span>
                </span>
              </div>
            )}

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
                the job's own next move. Z used to be the one that did not fix
                itself — re-zeroing redefines it, and on a warped board it
                redefined it to whatever the copper does under wherever the bit
                was parked. The height map now supplies that difference, so the
                zero lands back on the job's own plane from any spot. */}
            <p className="text-[11px] leading-relaxed opacity-90">
              <span className="font-semibold">Jog anywhere you like.</span> The job repositions
              itself with an absolute move before it cuts again, and with a surface map probed the
              re-zero is corrected for the board's warp at whatever spot you stop over. Just do not
              park the tool where it cannot travel back — the first move is a rapid.
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
            disabled={locked || needsZero}
            title={needsZero ? 'Re-zero Z before resuming' : undefined}
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
