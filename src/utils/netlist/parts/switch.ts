import type { PartEmitter } from '../part';

export const switchPart: PartEmitter = {
  emit: (node, { net }) => {
    const isOpen = node.data.isOpen !== false;
    const res = isOpen ? '1e12' : '0.01';
    return `R_${node.id} ${net('in')} ${net('out')} ${res}\n`;
  },
};
