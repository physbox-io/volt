import type { PartEmitter } from '../part';
import { spiceValue } from '../values';

export const currentsource: PartEmitter = {
  emit: (node, { net, acDrive }) => {
    const val = spiceValue(node.data.current, node.data.label, '10m');
    // In SPICE, `I n+ n- DC val` forces positive current internally from n+ to n-.
    // Passing (neg, pos) makes positive current exit `pos` and enter `neg`,
    // matching the arrow drawn on the symbol pointing toward `pos`.
    return `I_${node.id} ${net('neg')} ${net('pos')} DC ${val}${acDrive}\n`;
  },
};
