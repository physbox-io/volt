import type { PartEmitter } from '../part';
import { sanitizeSpiceValue } from '../values';

export const zener: PartEmitter = {
  emit: (node, { net }) => {
    const bv = sanitizeSpiceValue(String(node.data.label || '5.1V')).replace(/[Vv]$/, '');
    return `D_${node.id} ${net('anode')} ${net('cathode')} ZENER_MODEL_${node.id}\n`
      + `.model ZENER_MODEL_${node.id} D(IS=1e-11 BV=${bv} IBV=1e-3)\n`;
  },
};
