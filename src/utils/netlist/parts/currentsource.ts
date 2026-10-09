import type { PartEmitter } from '../part';
import { sanitizeSpiceValue } from '../values';

export const currentsource: PartEmitter = {
  emit: (node, { net }) => {
    const val = sanitizeSpiceValue(String(node.data.label || '10m'));
    return `I_${node.id} ${net('pos')} ${net('neg')} DC ${val}\n`;
  },
};
