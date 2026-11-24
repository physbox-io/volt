import type { PartEmitter } from '../part';
import { numParam } from '../params';

export const diode: PartEmitter = {
  emit: (node, { net }) => {
    const rawDrop = numParam(node.data, 'v_drop', 0.7);
    const v_drop = rawDrop > 0 ? Math.max(0.05, rawDrop) : 0.7;
    const n_coeff = v_drop / 0.7;
    return `D_${node.id} ${net('anode')} ${net('cathode')} DIODE_MODEL_${node.id}\n`
      + `.model DIODE_MODEL_${node.id} D(IS=1e-14 RS=0.1 N=${n_coeff})\n`;
  },
};
