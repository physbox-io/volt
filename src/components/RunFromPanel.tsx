import React from 'react';
import { AlertTriangle, Play, RefreshCw } from 'lucide-react';
import { NumberInput } from '@physbox-io/ui';
import type { RunFromView } from '../utils/runFrom';

/**
 * A job that stopped short: what stopped it, where, and a way to pick it up.
 *
 * The line offered is behind the stop on purpose — acknowledged is not cut, so
 * the restart rewinds to the start of the pass it was in — and can be changed
 * before running. Starting the board again from the top re-isolates every
 * trace already done, and a re-zeroed Z0 puts the second set of channels
 * beside the first rather than in them.
 *
 * The button names its refusal rather than greying out silently: the usual
 * reason is a position lost to the very alarm that stopped the job, and the
 * fix (home, or re-zero) is the next thing the operator needs to be told.
 */
export const RunFromPanel: React.FC<{
  view: RunFromView;
  jobName?: string;
  line: number | null;
  onLineChange: (line: number | null) => void;
  onRun: () => void;
  running: boolean;
}> = ({ view, jobName, line, onLineChange, onRun, running }) => {
  const { stop, lineProblem, blockedReason, canRun } = view;
  const why = blockedReason ?? lineProblem;
  return (
    <div className="p-2.5 rounded-lg border border-red-500/30 bg-red-500/10 space-y-1.5 text-[11px]">
      <p className="font-semibold text-red-700 dark:text-red-300 leading-snug flex items-start gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
        <span>
          {jobName ? `“${jobName}” stopped` : 'The last job stopped'} at line{' '}
          {stop.stoppedAtLine.toLocaleString()}.
        </span>
      </p>
      <p className="text-red-700 dark:text-red-300/90 leading-snug">{stop.reason}</p>
      <p className="text-slate-600 dark:text-slate-300 leading-snug">
        Suggested restart: line{' '}
        <span className="font-mono font-semibold">{stop.suggestedLine.toLocaleString()}</span> — a little
        before the stop, at the start of the pass it was in, so no trace is left half-isolated. The
        replay uses the same levelled program the job ran.
      </p>
      <div className="flex items-center gap-2">
        <label
          className="text-slate-600 dark:text-slate-300 font-semibold whitespace-nowrap"
          htmlFor="volt-run-from-line"
        >
          Run from line
        </label>
        <NumberInput
          id="volt-run-from-line"
          min={0}
          integer
          allowEmpty
          value={line}
          onChange={v => onLineChange(v ?? null)}
          className="w-24 px-1.5 py-1 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded font-mono text-[11px]"
        />
        <button
          type="button"
          onClick={onRun}
          disabled={!canRun || running}
          title={why ?? 'Rebuild the machine state for that line and carry on milling from there'}
          className="flex-1 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded font-bold cursor-pointer text-xs flex items-center justify-center gap-1.5"
        >
          {running ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
          Run From
        </button>
      </div>
      {why && <p className="text-amber-700 dark:text-amber-300 leading-snug">{why}</p>}
    </div>
  );
};
