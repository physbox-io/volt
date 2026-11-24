import type { PartEmitter } from '../part';
import { resolveMosfetParams } from '../../deviceModels';
import { sanitizeSpiceValue } from '../values';

const mosfet = (polarity: 'nmos' | 'pmos'): PartEmitter => ({
  emit: (node, { net }) => {
    const model = `${polarity.toUpperCase()}_MODEL_${node.id}`;
    const nd = net('d');
    const ng = net('g');
    const ns = net('s');
    const { vto, kp, lambda, rd, rs, cgs, cgd } = resolveMosfetParams(polarity, node.data);
    const cgsVal = cgs && cgs !== '0' ? sanitizeSpiceValue(cgs) : '';
    const cgdVal = cgd && cgd !== '0' ? sanitizeSpiceValue(cgd) : '';
    // SPICE3/ngspice MOSFET LEVEL=1 has no CGS/CGD .model parameters (only CGSO/CGDO
    // per unit width), so emit explicit gate-source / gate-drain capacitors when non-zero.
    let cards = `M_${node.id} ${nd} ${ng} ${ns} ${ns} ${model}\n`
      + `.model ${model} ${polarity.toUpperCase()}(LEVEL=1 VTO=${vto} KP=${kp} GAMMA=0.5 PHI=0.6 LAMBDA=${lambda} RD=${rd} RS=${rs})\n`;
    if (cgsVal && cgsVal !== '0') cards += `C_gs_${node.id} ${ng} ${ns} ${cgsVal}\n`;
    if (cgdVal && cgdVal !== '0') cards += `C_gd_${node.id} ${ng} ${nd} ${cgdVal}\n`;
    return cards;
  },
});

export const nmos = mosfet('nmos');
export const pmos = mosfet('pmos');
