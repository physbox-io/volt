import type { SpiceResult } from '../types/simulation';

/**
 * What one transient run hands the next, so the second starts where the first
 * stopped.
 *
 * Node voltages alone are not enough: an inductor's state is its current, and
 * a run seeded with voltages only starts every coil from 0A — a buck converter
 * restarts its ramp and an LC tank loses half its energy at every slice.
 *
 * Keyed the way ngspice names its vectors, lower case, without the `v()`
 * around a net (so the keys double as `.ic` targets): `out` is the voltage on
 * net `out`, and `i(l_l1)` the current through inductor `L_l1`.
 */
export type SimState = Record<string, number>;

const BRANCH = /^i\((.+)\)$/;

/** The state at the last sample of a transient run. */
export function readEndState(result: SpiceResult | null | undefined): SimState {
  const state: SimState = {};
  if (!result?.variableNames || !result.data) return state;
  result.variableNames.forEach((varName, idx) => {
    const name = varName.toLowerCase();
    const vals = result.data[idx]?.values as number[] | undefined;
    if (!vals || vals.length === 0) return;
    const last = vals[vals.length - 1];
    if (name.startsWith('v(') && name.endsWith(')')) {
      state[name.slice(2, -1)] = last;
    } else if (BRANCH.test(name) && name.startsWith('i(l')) {
      // Voltage sources report a branch current too; only a coil's is state.
      state[name] = last;
    }
  });
  return state;
}

/** The net voltages in a state, for the `.ic` card. */
export function nodeVoltages(state: SimState | undefined): [string, number][] {
  return Object.entries(state ?? {}).filter(([key]) => !BRANCH.test(key));
}

/** The ` IC=…` an inductor card carries to start at the current it ended on, or ''. */
export function inductorIc(state: SimState | undefined, element: string): string {
  const amps = state?.[`i(${element.toLowerCase()})`];
  return amps === undefined ? '' : ` IC=${amps.toExponential(6)}`;
}
