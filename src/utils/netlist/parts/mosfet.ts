import type { PartEmitter } from '../part';
import { resolveMosfetParams } from '../../deviceModels';

const mosfet = (polarity: 'nmos' | 'pmos'): PartEmitter => ({
  emit: (node, { net }) => {
    const model = `${polarity.toUpperCase()}_MODEL_${node.id}`;
    const nd = net('d');
    const ng = net('g');
    const ns = net('s');
    const { vto, kp, lambda, rd, rs, cgs, cgd } = resolveMosfetParams(polarity, node.data);
    const cgsStr = cgs && cgs !== '0' ? ` CGS=${cgs}` : '';
    const cgdStr = cgd && cgd !== '0' ? ` CGD=${cgd}` : '';
    return `M_${node.id} ${nd} ${ng} ${ns} ${ns} ${model}\n`
      + `.model ${model} ${polarity.toUpperCase()}(LEVEL=1 VTO=${vto} KP=${kp} GAMMA=0.5 PHI=0.6 LAMBDA=${lambda} RD=${rd} RS=${rs}${cgsStr}${cgdStr})\n`;
  },
});

export const nmos = mosfet('nmos');
export const pmos = mosfet('pmos');
