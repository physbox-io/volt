import type { PartEmitter } from '../part';
import { numParam } from '../params';

export const MESH_SIGNAL_DEFAULTS = {
  gain: 1,
  offset: 0,
  /** Output when thresholded, V. */
  high: 5,
  low: 0,
  /** Width of the band between switching high and switching low, in the scaled units. */
  hysteresis: 0,
};

/**
 * What a Mesh signal outputs for `value`, the channel's latest reading.
 *
 * Scaled to `gain·value + offset`. With a threshold set it is a comparator
 * with hysteresis instead: high above threshold + band/2, low below
 * threshold − band/2, and in between whatever it was (`wasHigh`). That one
 * part is a limit switch on a body's contact count, a pot on a joint's angle
 * or a tachometer on its speed.
 */
export function meshSignalLevel(data: Record<string, unknown>, value: number, wasHigh: boolean): { volts: number; high: boolean } {
  const p = (key: keyof typeof MESH_SIGNAL_DEFAULTS) => numParam(data, key, MESH_SIGNAL_DEFAULTS[key]);
  const scaled = p('gain') * value + p('offset');
  const raw = data.threshold;
  if (raw === undefined || raw === null || raw === '') return { volts: scaled, high: scaled > 0 };
  const threshold = numParam(data, 'threshold', 0);
  const half = Math.abs(p('hysteresis')) / 2;
  const high = scaled > threshold + half ? true : scaled < threshold - half ? false : wasHigh;
  return { volts: high ? p('high') : p('low'), high };
}

/**
 * A voltage source driven by a channel of a linked Mesh scene. Between links,
 * and before the first reading, the channel reads 0.
 */
export const meshsignal: PartEmitter = {
  emit: (node, { net, acDrive }) => {
    const value = typeof node.data.signalValue === 'number' ? node.data.signalValue : 0;
    const { volts } = meshSignalLevel(node.data, value, node.data.latchedHigh === true);
    return `V_${node.id} ${net('out')} ${net('gnd')} DC ${Number.isFinite(volts) ? volts : 0}${acDrive}\n`;
  },
};
