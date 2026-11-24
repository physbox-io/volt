import type { PartEmitter } from '../part';
import { numParam } from '../params';
import { sinePhase } from '../values';

export const acvoltage: PartEmitter = {
  emit: (node, { net, acDrive, time }) => {
    const amp = numParam(node.data, 'amplitude', 10);
    const freq = Math.max(0, numParam(node.data, 'frequency', 60));
    return `V_${node.id} ${net('pos')} ${net('neg')} SINE(0 ${amp} ${freq}${sinePhase(freq, time)})${acDrive}\n`;
  },
  timeVarying: () => true,
};
