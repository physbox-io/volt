import type { PartEmitter } from '../part';
import { numParam } from '../params';
import { emitTransducer, type LinkedShaft } from '../../transducer';

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
export const dcmotor: PartEmitter = {
  emit: (node, { net, initialConditions }) => {
    const d = node.data;
    const p = (key: keyof typeof DC_MOTOR_DEFAULTS) => numParam(d, key, DC_MOTOR_DEFAULTS[key]);
    const kt = p('kt');
    return emitTransducer(
      node.id,
      [{ a: net('a'), b: net('b'), r: p('windingR'), l: p('windingL'), k: () => String(kt) }],
      { j: p('inertia'), b: p('friction'), load: p('loadTorque') },
      initialConditions,
      false,
      node.data.linkedShaft as LinkedShaft | undefined,
    );
  },
};
