import type { Node } from '@xyflow/react';
import type { TransducerSpec } from '../transducer';
import { dcMotorSpec } from './parts/dcmotor';
import { stepperSpec } from './parts/stepper';

/** Every part type that is a transducer, and how to describe one from its data. */
const SPECS: Record<string, (data: Record<string, unknown>) => TransducerSpec> = {
  dcmotor: dcMotorSpec,
  stepper: stepperSpec,
};

/** The device a node is, if it is a transducer. */
export function transducerSpec(node: Node): TransducerSpec | null {
  const spec = SPECS[node.type ?? ''];
  return spec ? spec(node.data) : null;
}
