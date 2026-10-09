import type { PartEmitter } from '../part';
import { sinePhase } from '../values';

export const acvoltage: PartEmitter = {
  emit: (node, { net, acDrive, time }) => {
    const amp = node.data.amplitude !== undefined ? Number(node.data.amplitude) : 10;
    const freq = node.data.frequency !== undefined ? Number(node.data.frequency) : 60;
    return `V_${node.id} ${net('pos')} ${net('neg')} SINE(0 ${amp} ${freq}${sinePhase(freq, time)})${acDrive}\n`;
  },
  timeVarying: () => true,
};
