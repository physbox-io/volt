import type { PartEmitter } from '../part';
import { sanitizeSpiceValue } from '../values';

export const resistor: PartEmitter = {
  emit: (node, { net }) => {
    const val = node.data.resistance !== undefined ? node.data.resistance : sanitizeSpiceValue(String(node.data.label || '1k'));
    return `R_${node.id} ${net('in')} ${net('out')} ${val}\n`;
  },
};
