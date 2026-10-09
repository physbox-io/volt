import type { PartEmitter } from '../part';

// Native B-sources: no XSPICE `.model` is needed.
const gate = (expr: (in1: string, in2: string) => string): PartEmitter => ({
  emit: (node, { net }) => {
    const in1 = net('in1');
    const in2 = net('in2');
    const out = net('out');
    return `B_gate_${node.id} ${out} 0 V = ${expr(in1, in2)}\n`;
  },
});

export const and = gate((a, b) => `V(${a}) > 2.5 ? (V(${b}) > 2.5 ? 5 : 0) : 0`);
export const or = gate((a, b) => `V(${a}) > 2.5 ? 5 : (V(${b}) > 2.5 ? 5 : 0)`);
export const nand = gate((a, b) => `V(${a}) > 2.5 ? (V(${b}) > 2.5 ? 0 : 5) : 5`);
export const nor = gate((a, b) => `V(${a}) > 2.5 ? 0 : (V(${b}) > 2.5 ? 0 : 5)`);
export const xor = gate((a, b) => `V(${a}) > 2.5 ? (V(${b}) > 2.5 ? 0 : 5) : (V(${b}) > 2.5 ? 5 : 0)`);

export const not: PartEmitter = {
  emit: (node, { net }) => {
    const in1 = net('in1');
    const out = net('out');
    return `B_gate_${node.id} ${out} 0 V = V(${in1}) > 2.5 ? 0 : 5\n`;
  },
};
