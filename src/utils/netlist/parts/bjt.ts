import type { PartEmitter } from '../part';
import { resolveBjtParams } from '../../deviceModels';

const bjt = (polarity: 'npn' | 'pnp'): PartEmitter => ({
  emit: (node, { net }) => {
    const model = `${polarity.toUpperCase()}_MODEL_${node.id}`;
    const { bf, is, vaf, ikf, rb, cjc, cje } = resolveBjtParams(polarity, node.data);
    // CJC/CJE/TR/TF intentionally non-zero (small-signal-BJT scale, picofarads/nanoseconds):
    // at all zero, transistor switching has no physical timescale at all, which is fine for
    // simple stages but makes regenerative/astable circuits mathematically discontinuous —
    // ngspice's adaptive timestep shrinks toward zero trying to resolve an infinitely sharp
    // edge ("Timestep too small... trouble with node X"). These values are many orders of
    // magnitude faster than any RC time constant a UI-built circuit will realistically have,
    // so they don't change simulated behavior, only give the solver something finite to grab.
    return `Q_${node.id} ${net('c')} ${net('b')} ${net('e')} ${model}\n`
      + `.model ${model} ${polarity.toUpperCase()}(IS=${is} VAF=${vaf} BF=${bf} IKF=${ikf} XTB=1.5 BR=3 CJC=${cjc} CJE=${cje} TR=40n TF=0.4n RB=${rb})\n`;
  },
});

export const npn = bjt('npn');
export const pnp = bjt('pnp');
