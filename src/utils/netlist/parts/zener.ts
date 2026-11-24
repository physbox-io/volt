import type { PartEmitter } from '../part';
import { parseEngValue } from '../../engValue';

export const zener: PartEmitter = {
  emit: (node, { net }) => {
    const parsed = parseEngValue(String(node.data.label || '5.1V'));
    const bv = parsed !== null && parsed > 0 ? parsed : 5.1;
    return `D_${node.id} ${net('anode')} ${net('cathode')} ZENER_MODEL_${node.id}\n`
      + `.model ZENER_MODEL_${node.id} D(IS=1e-11 BV=${bv} IBV=1e-3)\n`;
  },
};
