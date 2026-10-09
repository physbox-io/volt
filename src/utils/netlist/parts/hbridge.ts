import type { PartEmitter } from '../part';
import { numParam } from '../params';
import { logicHigh } from '../logic';

export const HBRIDGE_DEFAULTS = {
  /** Per switch, Ω: half the DRV8833's 360mΩ high side plus low side. */
  rdsOn: 0.18,
};

/**
 * One H-bridge of a DRV8833: IN1/IN2 set OUT1/OUT2.
 *
 * | IN1 | IN2 | OUT1 | OUT2 |
 * |  0  |  0  |  Z   |  Z   | coast
 * |  1  |  0  |  H   |  L   | forward
 * |  0  |  1  |  L   |  H   | reverse
 * |  1  |  1  |  L   |  L   | brake
 *
 * Each switch is a conductance of 1/Rds(on) when on. A body diode across each
 * one carries a motor's current when the bridge coasts, as on the real part —
 * without them an inductive load would have nowhere to go.
 */
export const hbridge: PartEmitter = {
  emit: (node, { net }) => {
    const id = node.id;
    const vm = net('vm');
    const gnd = net('gnd');
    const in1 = net('in1');
    const in2 = net('in2');
    const out1 = net('out1');
    const out2 = net('out2');
    const g = 1 / Math.max(numParam(node.data, 'rdsOn', HBRIDGE_DEFAULTS.rdsOn), 1e-6);
    const s1 = logicHigh(in1, gnd);
    const s2 = logicHigh(in2, gnd);
    const sw = (name: string, from: string, to: string, on: string) =>
      `B_${id}_${name} ${from} ${to} I = V(${from}, ${to}) * (${g} * ${on} + 1e-9)\n`;
    const model = `HB_DIODE_${id}`;
    return sw('h1', vm, out1, `${s1} * (1 - ${s2})`)
      + sw('l1', out1, gnd, s2)
      + sw('h2', vm, out2, `${s2} * (1 - ${s1})`)
      + sw('l2', out2, gnd, s1)
      + `D_${id}_h1 ${out1} ${vm} ${model}\n`
      + `D_${id}_l1 ${gnd} ${out1} ${model}\n`
      + `D_${id}_h2 ${out2} ${vm} ${model}\n`
      + `D_${id}_l2 ${gnd} ${out2} ${model}\n`
      + `.model ${model} D(IS=1e-12 RS=0.05 N=1)\n`;
  },
};
