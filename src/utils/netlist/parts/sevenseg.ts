import type { PartEmitter } from '../part';

export const sevenseg: PartEmitter = {
  emit: (node, { net }) => {
    const nCommon = net('common');
    return ['a', 'b', 'c', 'd', 'e', 'f', 'g']
      .map(s => `R_${node.id}_${s} ${net(s)} ${nCommon} 1G\n`)
      .join('');
  },
};
