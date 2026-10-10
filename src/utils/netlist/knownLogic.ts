import type { Node } from '@xyflow/react';
import type { McuDrive } from '../mcu';
import { LOGIC_THRESHOLD_V } from './logic';
import { numParam } from './params';
import { sanitizeSpiceValue } from './values';
import { railVoltage } from '../netNaming';

/**
 * A logic net's level over a run: where it starts, and every change after,
 * in seconds from the run's start.
 */
export type LogicTrace = { initial: boolean; edges: { t: number; high: boolean }[] };

const constant = (high: boolean): LogicTrace => ({ initial: high, edges: [] });

/**
 * The logic level of every net whose level is already decided before the
 * circuit is solved: ground, an unconnected pin (pulled down), a DC source or
 * power rail, a square-wave generator, an MCU output pin playing its sketch.
 *
 * A part that reacts to edges — a step driver counting STEP pulses — can then
 * be told its edges instead of resolving them in the solver, which is what a
 * real-time run cannot afford. A net with two such drivers, or a driver this
 * does not know (a gate, a 555, a transistor), is not known, and the part
 * falls back to simulating its input. Loads on a known net are assumed not to
 * pull it across the threshold, as logic loads do not.
 */
export function knownLogic(
  nodes: Node[],
  portToNet: Record<string, string>,
  mcuDrives: Record<string, McuDrive>,
  lengthS: number,
  startS: number,
): (net: string) => LogicTrace | null {
  const drivers = new Map<string, LogicTrace[]>();
  const add = (net: string | undefined, trace: LogicTrace | null) => {
    if (!net || net === '0') return;
    const list = drivers.get(net) ?? [];
    if (trace) list.push(trace);
    // An unknown driver still counts, so the net is not taken as known.
    else list.push({ initial: false, edges: [{ t: -1, high: false }] });
    drivers.set(net, list);
  };
  const isHigh = (v: number) => v > LOGIC_THRESHOLD_V;

  for (const n of nodes) {
    const at = (h: string) => portToNet[`${n.id}-${h}`];
    if (n.type === 'voltage' && at('neg') === '0') {
      const raw = n.data.voltage !== undefined ? Number(n.data.voltage) : parseFloat(sanitizeSpiceValue(String(n.data.label || '5')));
      add(at('pos'), Number.isFinite(raw) ? constant(isHigh(raw)) : null);
    } else if (n.type === 'powerrail') {
      add(at('in'), constant(isHigh(railVoltage(n.data))));
    } else if (n.type === 'signalgen' && at('gnd') === '0') {
      add(at('out'), squareTrace(n.data, lengthS, startS));
    } else if (n.type === 'mcu') {
      const drive = mcuDrives[n.id];
      for (const [pin, mode] of Object.entries(drive?.pinModes ?? {})) {
        const pwl = drive!.pwlOutputs[pin];
        if (mode === 'OUTPUT' && pwl && pwl.length > 0) add(at(pin), pwlTrace(pwl, lengthS, isHigh));
      }
    }
  }

  return (net: string) => {
    if (net === '0' || net.startsWith('NC_')) return constant(false);
    const list = drivers.get(net);
    if (!list || list.length !== 1 || list[0].edges.some(e => e.t < 0)) return null;
    return list[0];
  };
}

/** A square generator as a logic trace: high for the first `duty` of each period, from where the run left it. */
function squareTrace(data: Record<string, unknown>, lengthS: number, startS: number): LogicTrace | null {
  const freq = numParam(data, 'frequency', 0);
  const amp = numParam(data, 'amplitude', 5);
  if (!(freq > 0)) return constant(amp > LOGIC_THRESHOLD_V);
  if (data.waveform !== 'square' || !(amp > LOGIC_THRESHOLD_V)) return null;
  const period = 1 / freq;
  const pw = (numParam(data, 'dutyCycle', 50) / 100) * period;
  const phase0 = ((startS % period) + period) % period;
  const edges: LogicTrace['edges'] = [];
  // Every rise at (k·period − start) and fall a pulse width later, inside the run.
  for (let k = Math.floor(startS / period); ; k++) {
    const rise = k * period - startS;
    if (rise > lengthS) break;
    if (rise > 0) edges.push({ t: rise, high: true });
    const fall = rise + pw;
    if (fall > 0 && fall <= lengthS) edges.push({ t: fall, high: false });
  }
  return { initial: phase0 < pw, edges: edges.sort((a, b) => a.t - b.t) };
}

/** An MCU pin's PWL (ms) as a logic trace: its threshold crossings, interpolated. */
function pwlTrace(points: { t: number; v: number }[], lengthS: number, isHigh: (v: number) => boolean): LogicTrace {
  const initial = isHigh(points[0].v);
  const edges: LogicTrace['edges'] = [];
  let level = initial;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const next = isHigh(b.v);
    if (next === level) continue;
    const f = b.v === a.v ? 0 : (LOGIC_THRESHOLD_V - a.v) / (b.v - a.v);
    const t = (a.t + f * (b.t - a.t)) / 1000;
    if (t > lengthS) break;
    edges.push({ t: Math.max(t, 0), high: next });
    level = next;
  }
  return { initial, edges };
}

/** The level of `trace` at time `t`. */
export function levelAt(trace: LogicTrace, t: number): boolean {
  let level = trace.initial;
  for (const e of trace.edges) {
    if (e.t > t) break;
    level = e.high;
  }
  return level;
}
