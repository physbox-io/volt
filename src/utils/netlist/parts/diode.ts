import type { PartEmitter } from '../part';

export const diode: PartEmitter = {
  emit: (node, { net }) => {
    const v_drop = Number(node.data.v_drop || 0.7);
    const n_coeff = v_drop / 0.7;
    return `D_${node.id} ${net('anode')} ${net('cathode')} DIODE_MODEL_${node.id}\n`
      + `.model DIODE_MODEL_${node.id} D(IS=1e-14 RS=0.1 N=${n_coeff})\n`;
  },
};
