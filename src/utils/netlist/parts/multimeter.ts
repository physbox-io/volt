import type { PartEmitter } from '../part';

export const multimeter: PartEmitter = {
  emit: (node, { net }) => node.data.mode === 'current'
    ? `V_ammeter_${node.id} ${net('pos')} ${net('neg')} DC 0\n`
    : `R_${node.id} ${net('pos')} ${net('neg')} 1G\n`,
};
