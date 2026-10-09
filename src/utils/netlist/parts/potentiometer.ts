import type { PartEmitter } from '../part';
import { parseEngValue } from '../../engValue';

export const potentiometer: PartEmitter = {
  emit: (node, { net }) => {
    // Read like every other part: "m" is milli, "M" and "meg" are mega. It
    // used to read its own "m" as mega; see upgradeLegacyLabels.
    const totalR = parseEngValue(String(node.data.label || '10k')) || 10000;
    // position is a percentage, 0-100. `|| 50` here would turn a wiper deliberately
    // set to 0 into a half-turn, so fall back only when it is genuinely absent.
    const rawPos = Number(node.data.position);
    const posPct = Number.isFinite(rawPos) ? rawPos : 50;
    const pos = Math.max(0.001, Math.min(0.999, posPct / 100));
    const nIn = net('in');
    const nOut = net('out');
    const nWiper = net('wiper');
    const rTop = totalR * (1 - pos);
    const rBot = totalR * pos;
    return `R_${node.id}_top ${nIn} ${nWiper} ${rTop}\n`
      + `R_${node.id}_bot ${nWiper} ${nOut} ${rBot}\n`;
  },
};
