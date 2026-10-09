import type { SpiceResult } from '../types/simulation';

/**
 * What one transient run hands the next, so the second starts where the first
 * stopped.
 *
 * Node voltages alone are not enough: an inductor's state is its current, and
 * a run seeded with voltages only starts every coil from 0A — a buck converter
 * restarts its ramp and an LC tank loses half its energy at every slice.
 *
 * Nor is the circuit's state alone: a signal generator, an AC source or a
 * recording is a function of time, and a run that starts its sources at t=0
 * again snaps every one of them back to phase zero — a 50Hz sine sliced every
 * 5ms becomes a quarter-wave sawtooth. So the state carries the time it was
 * taken at too, and every source emits from there.
 *
 * Keyed the way ngspice names its vectors, lower case, without the `v()`
 * around a net (so the keys double as `.ic` targets): `out` is the voltage on
 * net `out`, and `i(l_l1)` the current through inductor `L_l1`. `@t` is the
 * simulated time in seconds, and is not a net.
 */
export type SimState = Record<string, number>;

/** The key under which a state carries its simulated time, seconds. */
export const SIM_TIME = '@t';

const BRANCH = /^i\((.+)\)$/;

/** The simulated time a state was taken at, seconds; 0 for none. */
export function simTime(state: SimState | undefined): number {
  const t = state?.[SIM_TIME];
  return typeof t === 'number' && Number.isFinite(t) ? t : 0;
}

/**
 * The state at the last sample of a transient run that began from `from`:
 * its time is `from`'s plus the run's length.
 */
export function readEndState(result: SpiceResult | null | undefined, from?: SimState): SimState {
  const state: SimState = {};
  if (!result?.variableNames || !result.data) return state;
  result.variableNames.forEach((varName, idx) => {
    const name = varName.toLowerCase();
    const vals = result.data[idx]?.values as number[] | undefined;
    if (!vals || vals.length === 0) return;
    const last = vals[vals.length - 1];
    if (name === 'time') {
      state[SIM_TIME] = simTime(from) + last;
    } else if (name.startsWith('v(') && name.endsWith(')')) {
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
  return Object.entries(state ?? {}).filter(([key]) => !BRANCH.test(key) && key !== SIM_TIME);
}

/** A state without its time: what the circuit is doing, for comparing two states. */
export function withoutTime(state: SimState): SimState {
  if (!(SIM_TIME in state)) return state;
  const { [SIM_TIME]: _t, ...rest } = state;
  return rest;
}

/** The ` IC=…` an inductor card carries to start at the current it ended on, or ''. */
export function inductorIc(state: SimState | undefined, element: string): string {
  const amps = state?.[`i(${element.toLowerCase()})`];
  return amps === undefined ? '' : ` IC=${amps.toExponential(6)}`;
}
