import type { PartEmitter } from '../part';
import { logicHigh } from '../logic';

const GATE_THRESHOLD_V = 2.5;
const hi = (pin: string) => logicHigh(pin, '0', GATE_THRESHOLD_V);

// Smooth native B-sources with finite output impedance (50Ω + 10pF) so
// capacitive loads and combinational feedback loops converge cleanly.
const gate = (expr: (a: string, b: string) => string): PartEmitter => ({
  emit: (node, { net }) => {
    const in1 = net('in1');
    const in2 = net('in2');
    const out = net('out');
    const drv = `int_gate_${node.id}`;
    return `B_gate_${node.id} ${drv} 0 V = ${expr(hi(in1), hi(in2))}\n`
      + `R_gate_${node.id}_out ${drv} ${out} 50\n`
      + `C_gate_${node.id}_out ${out} 0 10p\n`;
  },
});

export const and = gate((a, b) => `5 * (${a}) * (${b})`);
export const or = gate((a, b) => `5 * (1 - (1 - ${a}) * (1 - ${b}))`);
export const nand = gate((a, b) => `5 * (1 - (${a}) * (${b}))`);
export const nor = gate((a, b) => `5 * (1 - ${a}) * (1 - ${b})`);
export const xor = gate((a, b) => `5 * ((${a}) * (1 - ${b}) + (1 - ${a}) * (${b}))`);

export const not: PartEmitter = {
  emit: (node, { net }) => {
    const in1 = net('in1');
    const out = net('out');
    const drv = `int_gate_${node.id}`;
    return `B_gate_${node.id} ${drv} 0 V = 5 * (1 - ${hi(in1)})\n`
      + `R_gate_${node.id}_out ${drv} ${out} 50\n`
      + `C_gate_${node.id}_out ${out} 0 10p\n`;
  },
};
