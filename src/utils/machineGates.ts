import type { MachineState } from './webSerialManager';

/** Which stop the operator needs: the suite's one rule, shared with Etch and Mesh. */
export { stopControl } from '@physbox-io/ui/suite';

/** A job holds the machine from its first line until it ends, paused or not. */
export function jobInProgress(s: Pick<MachineState, 'status'>): boolean {
  return s.status === 'RUNNING' || s.status.startsWith('PAUSED');
}
