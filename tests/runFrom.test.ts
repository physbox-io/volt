/**
 * What the Run From panel offers after a job stopped short.
 *
 * The panel is the only way to pick a stopped board up without recutting the
 * passes already done, so the cases worth pinning are when it hides (a job on
 * the wire), when its button refuses and says why, and which typed lines it
 * will not hand to `runFromLine` — which clamps a negative line to the start
 * and would mill the whole board again.
 */
import { describe, it, expect } from 'vitest';
import { runFromLineProblem, runFromView, type RunFromInput } from '../src/utils/runFrom';

const stop = { stoppedAtLine: 1200, suggestedLine: 1150, reason: 'ALARM:1 — hard limit', at: 1 };
const base: RunFromInput = {
  interruption: stop,
  status: 'IDLE',
  totalLines: 3000,
  line: 1150,
  machineBlockedReason: null,
  busy: false,
};

describe('runFromView', () => {
  it('shows nothing when no job stopped short', () => {
    expect(runFromView({ ...base, interruption: null })).toBeNull();
    expect(runFromView({ ...base, interruption: undefined })).toBeNull();
  });

  it('hides while any job is on the wire, paused included', () => {
    for (const status of ['RUNNING', 'PROBING', 'PAUSED_TOOL', 'PAUSED_MATERIAL', 'PAUSED_OPERATOR'] as const) {
      expect(runFromView({ ...base, status })).toBeNull();
    }
  });

  it('offers the stop and runs when the machine would start', () => {
    const view = runFromView(base)!;
    expect(view.stop.suggestedLine).toBe(1150);
    expect(view.canRun).toBe(true);
    expect(view.blockedReason).toBeNull();
  });

  it('still shows the stop in alarm, with the machine\'s own refusal', () => {
    const reason = 'The machine lost its position… Home it, or jog back to the origin and zero X and Y again.';
    const view = runFromView({ ...base, status: 'ALARM', machineBlockedReason: reason })!;
    expect(view).not.toBeNull();
    expect(view.canRun).toBe(false);
    expect(view.blockedReason).toBe(reason);
  });

  it('waits on the panel\'s own work', () => {
    const view = runFromView({ ...base, busy: true })!;
    expect(view.canRun).toBe(false);
    expect(view.blockedReason).toMatch(/Wait/);
  });

  it('refuses a line the program cannot run from', () => {
    expect(runFromView({ ...base, line: null })!.canRun).toBe(false);
    expect(runFromView({ ...base, line: 3000 })!.lineProblem).toMatch(/past its end/);
  });
});

describe('runFromLineProblem', () => {
  it('accepts the first through the last line', () => {
    expect(runFromLineProblem(0, 3000)).toBeNull();
    expect(runFromLineProblem(2999, 3000)).toBeNull();
  });

  it('refuses empty, negative and fractional lines', () => {
    expect(runFromLineProblem(null, 3000)).not.toBeNull();
    expect(runFromLineProblem(-1200, 3000)).not.toBeNull();
    expect(runFromLineProblem(12.5, 3000)).not.toBeNull();
  });

  it('does not invent an end it does not know', () => {
    expect(runFromLineProblem(5000, undefined)).toBeNull();
  });
});
