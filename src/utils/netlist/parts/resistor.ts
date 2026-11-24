import type { PartEmitter } from '../part';
import { spiceValue } from '../values';

export const resistor: PartEmitter = {
  emit: (node, { net }) => {
    const val = spiceValue(node.data.resistance, node.data.label, '1k');
    return `R_${node.id} ${net('in')} ${net('out')} ${val}\n`;
  },
};
