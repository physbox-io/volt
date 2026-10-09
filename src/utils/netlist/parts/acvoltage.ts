import type { PartEmitter } from '../part';

export const acvoltage: PartEmitter = {
  emit: (node, { net, acDrive }) => {
    const amp = node.data.amplitude !== undefined ? Number(node.data.amplitude) : 10;
    const freq = node.data.frequency !== undefined ? Number(node.data.frequency) : 60;
    return `V_${node.id} ${net('pos')} ${net('neg')} SINE(0 ${amp} ${freq})${acDrive}\n`;
  },
};
