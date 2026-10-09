import type { PartEmitter } from '../part';
import { sanitizeSpiceValue } from '../values';
import { inductorIc } from '../../simState';

export const inductor: PartEmitter = {
  emit: (node, { net, initialConditions }) => {
    const val = node.data.inductance !== undefined ? node.data.inductance : sanitizeSpiceValue(String(node.data.label || '100u'));
    return `L_${node.id} ${net('in')} ${net('out')} ${val}${inductorIc(initialConditions, `L_${node.id}`)}\n`;
  },
};
