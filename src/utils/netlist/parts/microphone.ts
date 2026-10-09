import type { Node } from '@xyflow/react';
import type { PartEmitter } from '../part';
import { pwlSource } from '../values';

const recording = (node: Node) => node.data.pwlData as { t: number; v: number }[] | undefined;

export const microphone: PartEmitter = {
  emit: (node, { net }) => {
    const n1 = net('out');
    const n2 = net('gnd');
    const pwlData = recording(node);
    const gain = Number(node.data.amplification ?? 100);
    // Raw audio values are normalized -1..+1
    // Apply gain as a voltage multiplier: gain=100 → raw * 0.05 * 100 = ±5V peak
    const voltageScale = 0.05 * gain; // 0.05V base (electret mic level) × gain
    if (pwlData && pwlData.length > 0) {
      return pwlSource(`V_${node.id} ${n1} ${n2}`, pwlData.map(p => ({ t: p.t, v: p.v * voltageScale })));
    }
    return `V_${node.id} ${n1} ${n2} DC 0\n`;
  },
  audio: node => (recording(node)?.length ?? 0) > 0,
};
