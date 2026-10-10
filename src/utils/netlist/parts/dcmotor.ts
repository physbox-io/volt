import type { PartEmitter } from '../part';
import { numParam } from '../params';
import { emitTransducer, type LinkedShaft, type TransducerSpec } from '../../transducer';

/** A small brushed DC motor, unloaded: about 6000rpm at 6V. */
export const DC_MOTOR_DEFAULTS = {
  windingR: 2,
  windingL: 0.5e-3,
  kt: 0.01,
  inertia: 5e-6,
  friction: 1e-6,
  loadTorque: 0,
};

/**
 * A permanent-magnet DC motor: one phase whose coupling is the torque
 * constant. In SI units the back-EMF constant is the same number.
 */
export function dcMotorSpec(data: Record<string, unknown>): TransducerSpec {
  const p = (key: keyof typeof DC_MOTOR_DEFAULTS) => numParam(data, key, DC_MOTOR_DEFAULTS[key]);
  return {
    phases: [{ a: 'a', b: 'b', r: p('windingR'), l: p('windingL'), k: [{ w: 0, cos: p('kt'), sin: 0 }] }],
    shaft: { j: p('inertia'), b: p('friction'), load: p('loadTorque') },
  };
}

export const dcmotor: PartEmitter = {
  emit: (node, { net, initialConditions }) =>
    emitTransducer(node.id, dcMotorSpec(node.data), net, initialConditions, node.data.linkedShaft as LinkedShaft | undefined),
};
