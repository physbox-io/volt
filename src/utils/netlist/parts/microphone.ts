import type { Node } from '@xyflow/react';
import type { PartEmitter } from '../part';
import { numParam } from '../params';
import { pwlFrom, pwlSource } from '../values';

const recording = (node: Node) => node.data.pwlData as { t: number; v: number }[] | undefined;

export const microphone: PartEmitter = {
  emit: (node, { net, time }) => {
    const n1 = net('out');
    const n2 = net('gnd');
    const pwlData = recording(node);
    const gain = numParam(node.data, 'amplification', 100);
    // Raw audio values are normalized -1..+1
    // Apply gain as a voltage multiplier: gain=100 → raw * 0.05 * 100 = ±5V peak
    const voltageScale = 0.05 * gain; // 0.05V base (electret mic level) × gain
    const intNet = `int_mic_${node.id}`;
    const src = pwlData && pwlData.length > 0
      ? pwlSource(`V_${node.id} ${intNet} ${n2}`, pwlFrom(pwlData, time).map(p => ({ t: p.t, v: p.v * voltageScale })))
      : `V_${node.id} ${intNet} ${n2} DC 0\n`;
    return `${src}R_${node.id}_out ${intNet} ${n1} 1k\n`;
  },
  audio: node => (recording(node)?.length ?? 0) > 0,
  timeVarying: node => (recording(node)?.length ?? 0) > 0,
};
