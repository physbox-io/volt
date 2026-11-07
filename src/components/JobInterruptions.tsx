import React, { useEffect, useState } from 'react';
import { ToolChangeDialog, type ZeroResult } from '@physbox-io/ui';
import { setTouchPlateMm, useTouchPlateMm } from '../utils/touchPlate';
import { webSerialManager } from '../utils/webSerialManager';
import { JobPauseModal } from './JobPauseModal';

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : undefined);

/**
 * A job that stopped and needs the operator. Mounted at the top level: the mill
 * dialog can be closed mid-job and an agent can mill with it never opened, and
 * the machine waits on someone either way.
 */
export const JobInterruptions: React.FC = () => {
  const [state, setState] = useState(() => webSerialManager.getState());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const touchPlateMm = useTouchPlateMm();
  useEffect(() => webSerialManager.addListener(setState), []);

  const { status } = state;
  const toolChange = status === 'PAUSED_TOOL';
  const streamStop = toolChange || status === 'PAUSED_MATERIAL';
  if (!streamStop && status !== 'PAUSED_OPERATOR') return null;

  const spindleRpm = webSerialManager.nextSpindleRpm();

  const zero = async (action: () => Promise<void>) => {
    setBusy('zeroing');
    setError(null);
    webSerialManager.clearLastError();
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e) || 'Zeroing Z failed');
    } finally {
      setBusy('');
    }
  };
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

  return (
    <JobPauseModal
      message={state.pauseMessage || 'Job paused'}
      isStreamPaused={streamStop}
      touchPlateMm={touchPlateMm}
      spindleRpm={spindleRpm}
      zeroScatterMm={state.zeroZScatterMm}
      probeCircuit={{ active: state.probePinActive, seen: state.probeCircuitSeen }}
      busy={busy}
      needsZero={!!state.needsZeroBeforeResume}
      error={error}
      onResume={resume}
      onCancel={stop}
      onZeroOnCopper={() => void zero(zeroOnCopper)}
      onZeroOnPlate={() => void zero(() => zeroOnPlate(touchPlateMm))}
    />
  );
};
