import type { PartEmitter } from '../part';

export const speaker: PartEmitter = {
  emit: (node, { net }) => `R_${node.id} ${net('in')} ${net('gnd')} 8\n`, // 8 ohm speaker load
  audio: () => true,
};
