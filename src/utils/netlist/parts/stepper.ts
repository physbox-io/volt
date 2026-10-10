import type { PartEmitter } from '../part';
import { numParam } from '../params';
import { emitTransducer, type LinkedShaft, type TransducerSpec } from '../../transducer';

/** A NEMA 17 like the ones in 3D printers (17HS4401): 1.8° a step, 0.4N·m at 1.7A. */
export const STEPPER_DEFAULTS = {
  windingR: 1.5,
  windingL: 2.8e-3,
  holdingTorque: 0.4,
  ratedCurrent: 1.7,
  detentTorque: 0.015,
  inertia: 5.4e-6,
  friction: 2e-4,
  loadTorque: 0,
  rotorTeeth: 50,
};

/**
 * A two-phase hybrid stepper. Phase A couples as −Kt·sin(N·x) and phase B as
 * Kt·cos(N·x), with N rotor teeth, so current in A alone holds the rotor at
 * x = 0 and in B alone a quarter of a tooth on: 90° electrical, 360°/4N
 * mechanical, 1.8° for 50 teeth. The detent pulls toward every quarter tooth
 * with no current at all.
 */
export function stepperSpec(data: Record<string, unknown>): TransducerSpec {
  const p = (key: keyof typeof STEPPER_DEFAULTS) => numParam(data, key, STEPPER_DEFAULTS[key]);
  const kt = p('holdingTorque') / Math.max(p('ratedCurrent'), 1e-6);
  const teeth = Math.max(1, Math.round(p('rotorTeeth')));
  const td = p('detentTorque');
  return {
    phases: [
      { a: 'a1', b: 'a2', r: p('windingR'), l: p('windingL'), k: [{ w: teeth, cos: 0, sin: -kt }] },
      { a: 'b1', b: 'b2', r: p('windingR'), l: p('windingL'), k: [{ w: teeth, cos: kt, sin: 0 }] },
    ],
    shaft: {
      j: p('inertia'), b: p('friction'), load: p('loadTorque'),
      detent: td > 0 ? [{ w: 4 * teeth, cos: 0, sin: td }] : undefined,
    },
  };
}

export const stepper: PartEmitter = {
  emit: (node, { net, initialConditions }) =>
    emitTransducer(node.id, stepperSpec(node.data), net, initialConditions, node.data.linkedShaft as LinkedShaft | undefined),
};
