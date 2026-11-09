import React, { useEffect, useState } from 'react';
import { JobPauseDialog, ToolChangeDialog, jobPauseKind, jobStopKey, setTouchPlateMm, useTouchPlateMm, type ZeroResult } from '@physbox-io/ui';
import { jobPause } from '../utils/jobPause';
import { webSerialManager } from '../utils/webSerialManager';

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : undefined);

/**
 * A job that stopped and needs the operator. Mounted at the top level: the mill
 * dialog can be closed mid-job and an agent can mill with it never opened, and
 * the machine waits on someone either way.
 */
export const JobInterruptions: React.FC<{
  /** After a resume goes through: brings back the window that runs the job. */
  onResumed?: () => void;
}> = ({ onResumed }) => {
  const [state, setState] = useState(() => webSerialManager.getState());
  const [error, setError] = useState<string | null>(null);
  const hiddenKey = jobPause.useHiddenKey();
  const touchPlateMm = useTouchPlateMm();
  useEffect(() => webSerialManager.addListener(setState), []);

  const { status } = state;
  const toolChange = status === 'PAUSED_TOOL';
  const pauseKind = jobPauseKind(status);
  if (!toolChange && !pauseKind) return null;
  // Hide is per stop: the status bar's button brings it back, and the next stop
  // opens on its own. A feed hold's line can still tick over as the planner
  // drains, so a hold is one stop until the job runs again.
  const key = jobStopKey(status, pauseKind === 'hold' ? 0 : state.currentLine, state.pauseMessage);
  if (hiddenKey === key) return null;

  const spindleRpm = webSerialManager.nextSpindleRpm();

  const asZeroResult = async (action: () => Promise<void>, done: string): Promise<ZeroResult> => {
    setError(null);
    webSerialManager.clearLastError();
    try {
      await action();
      return { success: true, message: done };
    } catch (e) {
      return { success: false, message: errorMessage(e) || 'Zeroing Z failed' };
    }
  };
  const zeroOnCopper = () => webSerialManager.zeroZOnSurface(webSerialManager.surfaceOffsetHere());
  const zeroOnPlate = (mm: number) => webSerialManager.zeroZ(mm, webSerialManager.surfaceOffsetHere());

  const resume = async () => {
    setError(null);
    webSerialManager.clearLastError();
    try {
      await webSerialManager.resumeJob();
      onResumed?.();
    } catch (e) {
      setError(errorMessage(e) || 'Could not resume the job');
    }
  };
  const stop = () => void webSerialManager.cancelJob();

  if (toolChange) {
    return (
      <ToolChangeDialog
        machine="cnc"
        message={state.pauseMessage || 'Fit the next bit.'}
        progress={{ line: state.currentLine, total: state.totalLines }}
        position={state.wpos}
        connected={state.connected}
        onJog={(delta, feed) => webSerialManager.jog(delta, feed)}
        onJogStop={() => webSerialManager.jogCancel()}
        zero={{
          zeroed: !state.needsZeroBeforeResume,
          surface: {
            label: 'On the copper',
            hint: 'Continuity clip on the board. The zero the surface map was taken from.',
            onProbe: () => asZeroResult(zeroOnCopper, 'Z zeroed on the copper.'),
          },
          plate: {
            mm: touchPlateMm,
            onMmChange: setTouchPlateMm,
            onProbe: (mm) => asZeroResult(() => zeroOnPlate(mm), 'Z zeroed on the touch plate.'),
          },
          probeCircuit: { active: !!state.probePinActive, seen: !!state.probeCircuitSeen },
          note:
            state.zeroZScatterMm !== undefined ? (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Last zero: the two stabs agreed to{' '}
                <span className="font-mono font-semibold">{state.zeroZScatterMm.toFixed(3)} mm</span>.
              </p>
            ) : undefined,
        }}
        resumeBlockedReason={state.needsZeroBeforeResume ? 'Re-zero Z on the new bit before resuming.' : null}
        onResume={resume}
        onStop={stop}
        onHide={() => jobPause.hide(key)}
      >
        {spindleRpm !== null && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1.5">
            <span className="text-[11px] font-semibold">Spindle speed on resume</span>
            <span className="font-mono text-sm font-bold tabular-nums">
              {spindleRpm.toLocaleString()} <span className="text-[10px] opacity-70">RPM</span>
            </span>
          </div>
        )}
        {error && <p className="text-[11px] leading-snug text-red-600 dark:text-red-400">{error}</p>}
      </ToolChangeDialog>
    );
  }

  if (!pauseKind) return null;
  return (
    <JobPauseDialog
      machine="cnc"
      kind={pauseKind}
      message={state.pauseMessage}
      progress={{ line: state.currentLine, total: state.totalLines }}
      jog={{
        position: state.wpos,
        connected: state.connected,
        onJog: (delta, feed) => webSerialManager.jog(delta, feed),
        onJogStop: () => webSerialManager.jogCancel(),
      }}
      resumeBlockedReason={null}
      onResume={resume}
      onStop={stop}
      onHide={() => jobPause.hide(key)}
    >
      {error && <p className="text-[11px] leading-snug text-red-600 dark:text-red-400">{error}</p>}
    </JobPauseDialog>
  );
};
