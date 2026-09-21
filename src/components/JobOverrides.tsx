import React from 'react';
import { Gauge, RotateCcw } from 'lucide-react';
import type { OverrideStep } from '@physbox-io/machining';
import { webSerialManager, type MachineState } from '../utils/webSerialManager';

/**
 * Trimming feed, spindle and rapids while the board is being cut.
 *
 * Without it the only answer to "this pass is running slightly too fast" is to
 * stop the job, change a number and start again — on a board that has already
 * been cut into and whose registration to the mesh is gone with it. Every GRBL
 * controller can do this live; nothing in Volt could ask it to.
 *
 * These are real-time bytes, so the controller acts on them immediately rather
 * than queueing them behind the thousands of lines already sent. That is the
 * whole point: the buffered lines are exactly what needs slowing down.
 *
 * Steps rather than a slider, because that is the protocol: GRBL takes nudges
 * and a reset, and nothing else. The percentage shown is the controller's own
 * `Ov:` report rather than a tally of what was clicked — an override survives a
 * reload, is cleared by a reset, and may be changed from a pendant, and a
 * readout that remembered its own clicks would be wrong after any of those.
 */
export const JobOverrides: React.FC<{ serialState: MachineState }> = ({ serialState }) => {
  const running =
    serialState.status === 'RUNNING' || serialState.status.startsWith('PAUSED');
  if (!serialState.connected || !running) return null;

  // Absent until the first status report carrying `Ov:` lands, which is at most
  // a quarter second into the job.
  const ov = serialState.overrides ?? { feed: 100, rapid: 100, spindle: 100 };

  const step =
    'px-1.5 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 ' +
    'text-slate-700 dark:text-slate-200 font-mono text-[10px] leading-none cursor-pointer';

  const row = (
    label: string,
    percent: number,
    nudge: (by: OverrideStep) => void,
    reset: () => void,
    hint: string
  ) => (
    <div className="flex items-center gap-1.5">
      <span className="w-14 shrink-0 text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span
        className={`w-11 shrink-0 text-right font-mono text-[11px] font-bold ${
          percent === 100 ? 'text-slate-700 dark:text-slate-200' : 'text-amber-600 dark:text-amber-400'
        }`}
        title={hint}
      >
        {percent}%
      </span>
      <div className="flex gap-1">
        <button className={step} onClick={() => nudge(-10)} title={`${hint} — down 10%`}>−10</button>
        <button className={step} onClick={() => nudge(-1)} title={`${hint} — down 1%`}>−1</button>
        <button className={step} onClick={reset} title={`${hint} — back to what the program asked for`}>
          <RotateCcw className="w-3 h-3" />
        </button>
        <button className={step} onClick={() => nudge(1)} title={`${hint} — up 1%`}>+1</button>
        <button className={step} onClick={() => nudge(10)} title={`${hint} — up 10%`}>+10</button>
      </div>
    </div>
  );

  return (
    <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-800/60 space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wide text-slate-600 dark:text-slate-300">
        <Gauge className="w-3.5 h-3.5 text-amber-500" />
        <span>Live Trim</span>
      </div>

      {row(
        'Feed',
        ov.feed,
        (by) => void webSerialManager.nudgeFeedOverride(by),
        () => void webSerialManager.resetFeedOverride(),
        'How fast the cutter moves through the copper'
      )}
      {row(
        'Spindle',
        ov.spindle,
        (by) => void webSerialManager.nudgeSpindleOverride(by),
        () => void webSerialManager.resetSpindleOverride(),
        'Spindle speed, on a machine whose controller owns the spindle'
      )}

      {/* Rapids get three fixed steps because GRBL implements exactly three.
          Worth having on a first run of an unfamiliar board: a rapid at quarter
          speed is one you can still hit the stop for. */}
      <div className="flex items-center gap-1.5">
        <span
          className="w-14 shrink-0 text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400"
          title="Travel between cuts — a quarter-speed rapid is one you stay in reach of the stop for"
        >
          Rapids
        </span>
        <span
          className={`w-11 shrink-0 text-right font-mono text-[11px] font-bold ${
            ov.rapid === 100 ? 'text-slate-700 dark:text-slate-200' : 'text-amber-600 dark:text-amber-400'
          }`}
        >
          {ov.rapid}%
        </span>
        <div className="flex gap-1">
          {([100, 50, 25] as const).map((pct) => (
            <button
              key={pct}
              className={step}
              onClick={() => void webSerialManager.setRapidOverride(pct)}
              title={`Travel between cuts at ${pct}% of the rapid speed`}
            >
              {pct}%
            </button>
          ))}
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
        Applied to the motion already in the buffer, so an isolation pass that is chattering or
        tearing the foil can be backed off without stopping the job. Find the pair that cuts
        cleanly here, then set it on the CAM tab for next time.
      </p>
    </div>
  );
};
