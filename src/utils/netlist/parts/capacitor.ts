import type { PartEmitter } from '../part';
import { sanitizeSpiceValue } from '../values';

export const capacitor: PartEmitter = {
  emit: (node, { net }) => {
    const val = node.data.capacitance !== undefined ? node.data.capacitance : sanitizeSpiceValue(String(node.data.label || '10u'));
    return `C_${node.id} ${net('in')} ${net('out')} ${val}\n`;
  },
};
