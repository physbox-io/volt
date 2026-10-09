import type { PartEmitter } from '../part';
import { sanitizeSpiceValue } from '../values';
import { inductorIc } from '../../simState';

export const transformer: PartEmitter = {
  emit: (node, { net, initialConditions }) => {
    const lpri = node.data.l_pri !== undefined ? node.data.l_pri : sanitizeSpiceValue(String(node.data.l_pri_label || '10mH'));
    const lsec = node.data.l_sec !== undefined ? node.data.l_sec : sanitizeSpiceValue(String(node.data.l_sec_label || '10mH'));
    const k = node.data.k !== undefined ? node.data.k : '0.99';
    return `L_pri_${node.id} ${net('p1')} ${net('p2')} ${lpri}${inductorIc(initialConditions, `L_pri_${node.id}`)}\n`
      + `L_sec_${node.id} ${net('s1')} ${net('s2')} ${lsec}${inductorIc(initialConditions, `L_sec_${node.id}`)}\n`
      + `K_${node.id} L_pri_${node.id} L_sec_${node.id} ${k}\n`;
  },
};
