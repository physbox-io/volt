import type { PartEmitter } from '../part';

export const scope: PartEmitter = {
  emit: (node, { net }) => {
    const ch1 = net('ch1');
    const ch2 = net('ch2');
    const gnd = net('gnd');
    return `R_scope_ch1_${node.id} ${ch1} ${gnd} 1G\n`
      + `R_scope_ch2_${node.id} ${ch2} ${gnd} 1G\n`;
  },
};
