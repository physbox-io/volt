import type { MachineState } from './webSerialManager';

type Gated = Pick<MachineState, 'connected' | 'status' | 'grblState' | 'spindleSpeed'>;

/** The controller's words for something in motion or waiting to carry on. */
const BUSY_WORD = /^(Run|Jog|Home|Hold|Door)/;

/** A job holds the machine from its first line until it ends, paused or not. */
export function jobInProgress(s: Pick<MachineState, 'status'>): boolean {
  return s.status === 'RUNNING' || s.status.startsWith('PAUSED');
}

/**
 * Which stop the operator needs, if any: the job's, or the machine's when it is
 * moving with no job or has been left with a spindle on.
 */
export function stopControl(s: Gated): 'job' | 'machine' | null {
  if (!s.connected) return null;
  if (jobInProgress(s)) return 'job';
  if (BUSY_WORD.test(s.grblState ?? '')) return 'machine';
  return (s.spindleSpeed ?? 0) > 0 ? 'machine' : null;
}
