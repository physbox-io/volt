import type { PartEmitter } from '../part';
import { spiceValue } from '../values';
import { numParam } from '../params';
import { inductorIc } from '../../simState';

export const transformer: PartEmitter = {
  emit: (node, { net, initialConditions }) => {
    const lpri = spiceValue(node.data.l_pri, node.data.l_pri_label, '10mH');
    const lsec = spiceValue(node.data.l_sec, node.data.l_sec_label, '10mH');
    const rawK = numParam(node.data, 'k', 0.99);
    const k = Math.max(0.001, Math.min(0.9999, rawK));
    const p1 = net('p1');
    const p2 = net('p2');
    const s1 = net('s1');
    const s2 = net('s2');
    // Small winding resistance prevents DC voltage-source/inductor singular matrix
    // when an ideal voltage or AC source is connected directly across the primary.
    return `R_pri_${node.id} ${p1} int_pri_${node.id} 0.1\n`
      + `L_pri_${node.id} int_pri_${node.id} ${p2} ${lpri}${inductorIc(initialConditions, `L_pri_${node.id}`)}\n`
      + `R_sec_${node.id} ${s1} int_sec_${node.id} 0.1\n`
      + `L_sec_${node.id} int_sec_${node.id} ${s2} ${lsec}${inductorIc(initialConditions, `L_sec_${node.id}`)}\n`
      + `K_${node.id} L_pri_${node.id} L_sec_${node.id} ${k}\n`;
  },
};
