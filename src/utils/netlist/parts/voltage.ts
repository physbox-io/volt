import type { PartEmitter } from '../part';
import { sanitizeSpiceValue } from '../values';

export const voltage: PartEmitter = {
  emit: (node, { net, acDrive }) => {
    const val = node.data.voltage !== undefined ? node.data.voltage : sanitizeSpiceValue(String(node.data.label || '5'));
    return `V_${node.id} ${net('pos')} ${net('neg')} DC ${val}${acDrive}\n`;
  },
};
