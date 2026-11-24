import type { PartEmitter } from '../part';
import { spiceValue } from '../values';

export const capacitor: PartEmitter = {
  emit: (node, { net }) => {
    const val = spiceValue(node.data.capacitance, node.data.label, '10u');
    return `C_${node.id} ${net('in')} ${net('out')} ${val}\n`;
  },
};
