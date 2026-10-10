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
  /** Motor turns per output turn: 1 is a bare motor, 100 a typical small gearmotor. */
  gearRatio: 1,
};

/**
 * A permanent-magnet DC motor: one phase whose coupling is the torque
 * constant. In SI units the back-EMF constant is the same number.
 *
 * With a gearbox of ratio N the shaft this describes is the gearbox's output:
 * an ideal gearbox multiplies the coupling by N (N times the torque, and N
 * times the motor's speed for a given output speed), and reflects the rotor's
 * inertia and friction to the output as N². Kt, inertia and friction are
 * always the bare motor's, as its datasheet gives them; the load torque is
 * at the output.
 */
export function dcMotorSpec(data: Record<string, unknown>): TransducerSpec {
  const p = (key: keyof typeof DC_MOTOR_DEFAULTS) => numParam(data, key, DC_MOTOR_DEFAULTS[key]);
  const n = Math.max(p('gearRatio'), 1e-6);
  return {
    phases: [{ a: 'a', b: 'b', r: p('windingR'), l: p('windingL'), k: [{ w: 0, cos: p('kt') * n, sin: 0 }] }],
    shaft: { j: p('inertia') * n * n, b: p('friction') * n * n, load: p('loadTorque') },
  };
}

export const dcmotor: PartEmitter = {
  emit: (node, { net, initialConditions }) =>
    emitTransducer(node.id, dcMotorSpec(node.data), net, initialConditions, node.data.linkedShaft as LinkedShaft | undefined),
};
