import type { PartEmitter } from '../part';
import { numParam } from '../params';

export const FUSE_DEFAULTS = {
  /** Current it carries indefinitely, A. */
  rating: 1,
  /** Melting I²t over the rating, A²s. */
  i2t: 0.1,
  /** Resistance intact, Ω. */
  coldR: 0.05,
};

/** The node whose voltage is a fuse's accumulated I²t, A²s. */
export const fuseHeatNode = (id: string) => `int_${id}_h`;

/**
 * A fuse that melts on I²t.
 *
 * A heat node integrates the excess of i² over the rating's square, and cools
 * at the same rate when the current is below it, never below zero. When the
 * heat reaches the melting I²t the fuse opens, and from then on the heat only
 * rises — a thousand times its I²t a second, so it opens within a
 * millisecond of melting — and it stays open. The heat is a node voltage, so a blown fuse stays
 * blown across slices and continued runs; Reset puts a new one in.
 */
export const fuse: PartEmitter = {
  emit: (node, { net }) => {
    const id = node.id;
    const a = net('in');
    const b = net('out');
    const rating = Math.max(numParam(node.data, 'rating', FUSE_DEFAULTS.rating), 0);
    const i2t = Math.max(numParam(node.data, 'i2t', FUSE_DEFAULTS.i2t), 1e-9);
    const coldR = Math.max(numParam(node.data, 'coldR', FUSE_DEFAULTS.coldR), 1e-6);
    const h = fuseHeatNode(id);
    const melted = `int_${id}_m`;
    const g = `int_${id}_g`;
    const in2 = rating * rating;
    const i = `(V(${a}, ${b}) * V(${g}))`;
    return `B_${id}_m ${melted} 0 V = 1 / (1 + exp(-(V(${h}) - ${i2t}) / ${i2t * 0.001}))\n`
      + `B_${id}_g ${g} 0 V = ${1 / coldR} * (1 - V(${melted})) + 1e-9\n`
      + `B_${id} ${a} ${b} I = ${i}\n`
      + `C_${id}_h ${h} 0 1\n`
      + `R_${id}_h ${h} 0 1e12\n`
      // Heat builds only with time passing: an operating point has none, and
      // integrating there would settle the heat at leak × excess — a fuse
      // blown before the run began, by a motor that is stalled only at t=0.
      + `B_${id}_h 0 ${h} I = time <= 0 ? 0 : ((V(${h}) <= 0 && ${i} * ${i} < ${in2}) ? 0 : `
      + `(1 - V(${melted})) * (${i} * ${i} - ${in2}) + V(${melted}) * ${i2t * 1000})\n`;
  },
};
