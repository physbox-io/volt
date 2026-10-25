import type { JobInterruption, MachineStatus } from '@physbox-io/machining';

/**
 * What the Run From panel shows, decided without a DOM so it can be tested.
 *
 * A job that stopped short — an alarm, a stop, a dropped link — leaves
 * `interruption` on the machine's state: where it stopped and a line a little
 * behind that to start again from. Starting the board again from the top recuts
 * every isolation pass already done, at whatever Z0 is now, which is a second
 * set of channels beside the first. The panel is how a stopped board is picked
 * up instead.
 */
export interface RunFromView {
  stop: JobInterruption;
  /** A typed line the program cannot run from, or null. */
  lineProblem: string | null;
  /** Why the button will not run right now, or null when it will. */
  blockedReason: string | null;
  canRun: boolean;
}

/** Statuses in which a job is on the wire, paused included. */
const JOB_ACTIVE: ReadonlySet<MachineStatus> = new Set<MachineStatus>([
  'RUNNING',
  'PROBING',
  'PAUSED_TOOL',
  'PAUSED_MATERIAL',
  'PAUSED_OPERATOR',
  'PAUSED_PARKED',
]);

export interface RunFromInput {
  interruption?: JobInterruption | null;
  status: MachineStatus;
  /** The interrupted program's length, in the numbering the stop is reported in. */
  totalLines?: number;
  /** The line typed into the panel, or null when the field is empty. */
  line: number | null;
  /** The machine's own reason a job may not start — `startBlockedReason([])`. */
  machineBlockedReason: string | null;
  /** Something else this panel is waiting on — a probe, a zero, a job starting. */
  busy: boolean;
}

/**
 * Whether there is anything to show, and whether its button would work.
 *
 * Hidden while any job is on the wire: the job running *is* the answer to the
 * stop, and a Run From offered over a running job would start a second stream
 * on top of it.
 */
export function runFromView(input: RunFromInput): RunFromView | null {
  const stop = input.interruption;
  if (!stop || JOB_ACTIVE.has(input.status)) return null;
  const lineProblem = runFromLineProblem(input.line, input.totalLines);
  const blockedReason = input.busy ? 'Wait for the machine to finish what it is doing.' : input.machineBlockedReason;
  return { stop, lineProblem, blockedReason, canRun: !lineProblem && !blockedReason };
}

/**
 * Why a typed line cannot be run from, or null.
 *
 * Checked here rather than left to `runFromLine`, which clamps a negative line
 * to the start — a typo of "-1200" would have recut the whole board.
 */
export function runFromLineProblem(line: number | null, totalLines?: number): string | null {
  if (line === null || !Number.isFinite(line)) return 'Enter the line to run from.';
  if (!Number.isInteger(line) || line < 0) return 'The line is a whole number from 0 up.';
  if (totalLines !== undefined && totalLines > 0 && line >= totalLines) {
    return `The program has ${totalLines.toLocaleString()} lines, so line ${line.toLocaleString()} is past its end.`;
  }
  return null;
}
