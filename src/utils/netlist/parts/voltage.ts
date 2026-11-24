import type { PartEmitter } from '../part';
import { spiceValue } from '../values';

export const voltage: PartEmitter = {
  emit: (node, { net, acDrive }) => {
    const val = spiceValue(node.data.voltage, node.data.label, '5');
    return `V_${node.id} ${net('pos')} ${net('neg')} DC ${val}${acDrive}\n`;
  },
};
