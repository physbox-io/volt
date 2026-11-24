import type { PartEmitter } from '../part';
import { spiceValue } from '../values';
import { inductorIc } from '../../simState';

export const inductor: PartEmitter = {
  emit: (node, { net, initialConditions }) => {
    const val = spiceValue(node.data.inductance, node.data.label, '100u');
    return `L_${node.id} ${net('in')} ${net('out')} ${val}${inductorIc(initialConditions, `L_${node.id}`)}\n`;
  },
};
