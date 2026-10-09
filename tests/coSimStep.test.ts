import { describe, it, expect, beforeAll } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { Simulation } from 'eecircuit-engine';
import { coSimStep, initialCoSimState, coSimBindings, type CoSimState } from '../src/sim/coSimStep';
import type { CoSimEndpoint, Stepped } from '../src/utils/coSimLink';
import { meshSignalLevel } from '../src/utils/netlist/parts/meshsignal';
import { generateSpiceNetlist } from '../src/utils/spice';
import type { SpiceResult } from '../src/types/simulation';

/**
 * A circuit driving a scene in lock step, with Mesh stood in for by one rigid
 * joint integrated finely in JS. The motor must do linked what it does on its
 * own — the same speed, the same time constant — the joint must follow the
 * shaft, and halving the slice must barely move the answer.
 */

const node = (id: string, type: string, data: Record<string, unknown> = {}): Node => ({
  id, type, position: { x: 0, y: 0 }, data,
});
const wire = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`,
  source, sourceHandle, target, targetHandle,
});

/** One hinge: inertia, viscous damping and a constant torque from the rest of the scene. */
class FakeJoint implements CoSimEndpoint {
  pos = 0;
  vel = 0;
  t = 0;
  calls = 0;
  readonly name: string;
  readonly inertia: number;
  readonly damping: number;
  readonly extra: number;
  readonly h: number;
  constructor(name: string, inertia: number, damping: number, extra = 0, h = 1e-5) {
    this.name = name;
    this.inertia = inertia;
    this.damping = damping;
    this.extra = extra;
    this.h = h;
  }
  async stepFor(dtMs: number, inputs: Record<string, number>, outputs: string[]): Promise<Stepped> {
    this.calls++;
    const f = inputs[`joint:${this.name}.force`] ?? 0;
    const n = dtMs > 0 ? Math.max(1, Math.round(dtMs / 1000 / this.h)) : 0;
    for (let i = 0; i < n; i++) {
      const acc = (f - this.damping * this.vel + this.extra) / this.inertia;
      this.vel += acc * this.h;
      this.pos += this.vel * this.h;
      this.t += this.h;
    }
    const all: Record<string, number> = {
      [`joint:${this.name}.pos`]: this.pos,
      [`joint:${this.name}.vel`]: this.vel,
      [`joint:${this.name}.inertia`]: this.inertia,
      [`joint:${this.name}.load`]: -this.damping * this.vel + this.extra,
    };
    const out: Record<string, number> = {};
    const unknown: string[] = [];
    for (const name of outputs) {
      if (name in all) out[name] = all[name];
      else unknown.push(name);
    }
    return { t: this.t, outputs: out, unknown };
  }
}

let engine: Simulation;
const solve = async (netlist: string) => {
  engine.setNetList(netlist);
  return (await engine.runSim()) as SpiceResult;
};
beforeAll(async () => {
  engine = new Simulation();
  await engine.start();
});

async function runFor(nodes: Node[], edges: Edge[], endpoint: CoSimEndpoint, totalMs: number, sliceMs: number) {
  let state: CoSimState = initialCoSimState();
  const speeds: { t: number; w: number }[] = [];
  for (let t = 0; t < totalMs - 1e-9; t += sliceMs) {
    const out = await coSimStep(state, { nodes, edges, sliceMs }, { solve, endpoint });
    expect(out.unknown).toEqual([]);
    state = out.state;
    speeds.push({ t: t + sliceMs, w: Object.values(state.outputs).length ? state.outputs['joint:shaft.vel'] : 0 });
  }
  return { state, speeds };
}

describe('a DC motor driving a Mesh joint', () => {
  const motor = { v: 6, r: 2, kt: 0.02, jr: 5e-6, b: 1e-6 };
  const circuit = () => ({
    nodes: [
      node('V1', 'voltage', { voltage: motor.v }), node('G', 'ground'),
      node('M', 'dcmotor', { windingR: motor.r, windingL: 1e-4, kt: motor.kt, inertia: motor.jr, friction: motor.b, shaftJoint: 'shaft' }),
    ],
    edges: [wire('V1', 'pos', 'M', 'a'), wire('M', 'b', 'G', 'in'), wire('V1', 'neg', 'G', 'in')],
  });

  for (const { inertia, damping, extra } of [
    { inertia: 2e-5, damping: 1e-5, extra: 0 },
    { inertia: 1e-4, damping: 5e-5, extra: -0.03 },
  ]) {
    it(`reaches Kt·V/(Kt²+R·b) with τ = (Jr+J)·R/(Kt²+R·b), at 5ms and at 2.5ms slices: J=${inertia}, load ${extra}`, async () => {
      const { nodes, edges } = circuit();
      const bTotal = motor.b + damping;
      const denom = motor.kt * motor.kt + motor.r * bTotal;
      const wSteady = (motor.kt * motor.v + motor.r * extra) / denom;
      const tau = ((motor.jr + inertia) * motor.r) / denom;
      const totalMs = Math.ceil((tau * 5000) / 10) * 10;

      const finals: number[] = [];
      for (const sliceMs of [5, 2.5]) {
        const joint = new FakeJoint('shaft', inertia, damping, extra);
        const { state, speeds } = await runFor(nodes, edges, joint, totalMs, sliceMs);
        const w = state.outputs['joint:shaft.vel'];
        // The joint ends at the motor's steady speed (5τ: within 0.7% of it).
        expect(Math.abs(w - wSteady * (1 - Math.exp(-totalMs / 1000 / tau))) / wSteady).toBeLessThan(0.01);
        // The circuit's shaft and the joint agree.
        expect(Math.abs((state.sim['int_m_w'] ?? 0) - w) / wSteady).toBeLessThan(0.01);
        // 63% of the way after one time constant.
        const k = speeds.findIndex(s => s.w >= 0.632 * wSteady);
        expect(Math.abs(speeds[k].t / 1000 - tau) / tau).toBeLessThan(0.05);
        finals.push(w);
      }
      expect(Math.abs(finals[0] - finals[1]) / wSteady).toBeLessThan(0.01);
    });
  }
});

describe('a stepper on a step driver driving a Mesh joint', () => {
  // 100 pulses a second from a sketch, which keeps time across slices.
  const sketch = "pinMode('D0', 'OUTPUT');\nwhile(true) {\n  digitalWrite('D0', 1);\n  sleep(5);\n  digitalWrite('D0', 0);\n  sleep(5);\n}";
  const circuit = (micro: number) => ({
    nodes: [
      node('VM', 'voltage', { voltage: 12 }), node('VD', 'voltage', { voltage: 3.3 }), node('G', 'ground'),
      node('U', 'mcu', { code: sketch }),
      node('D', 'stepdriver', { microsteps: micro, currentLimit: 1 }),
      node('S', 'stepper', { detentTorque: 0, friction: 0.002, shaftJoint: 'shaft' }),
    ],
    edges: [
      wire('VM', 'pos', 'D', 'vm'), wire('VM', 'neg', 'G', 'in'), wire('D', 'gnd', 'G', 'in'), wire('U', 'GND', 'G', 'in'),
      wire('U', 'D0', 'D', 'step'), wire('VD', 'pos', 'D', 'dir'), wire('VD', 'neg', 'G', 'in'), wire('D', 'en', 'G', 'in'),
      wire('D', 'a1', 'S', 'a1'), wire('D', 'a2', 'S', 'a2'), wire('D', 'b1', 'S', 'b1'), wire('D', 'b2', 'S', 'b2'),
    ],
  });

  for (const micro of [1, 4]) {
    it(`turns the joint 1.8°/${micro} a pulse, steadily, at 5ms slices`, async () => {
      const { nodes, edges } = circuit(micro);
      const joint = new FakeJoint('shaft', 5e-5, 0.005);
      const { state } = await runFor(nodes, edges, joint, 200, 5);
      const stepRad = Math.PI / 2 / micro;
      const theta = state.sim['int_d_th'];
      // Pulses at 100Hz for 200ms: 20 of them, or 19 if the last is still rising.
      expect(Math.round(theta / stepRad)).toBeGreaterThanOrEqual(19);
      expect(Math.round(theta / stepRad)).toBeLessThanOrEqual(20);
      expect(Math.abs(theta / stepRad - Math.round(theta / stepRad))).toBeLessThan(0.01);
      // The joint, not just the circuit's rotor, is where the driver put it (from the 45° home), within a step.
      const lag = (Math.PI / 4 + theta - 50 * joint.pos) / stepRad;
      expect(Math.abs(lag)).toBeLessThan(1);
      expect(Number.isFinite(joint.vel)).toBe(true);
    });
  }
});

describe('a Mesh signal', () => {
  it('scales the reading, or switches on it with hysteresis', () => {
    expect(meshSignalLevel({ gain: 2, offset: 0.5 }, 1.25, false).volts).toBeCloseTo(3);
    const comp = { threshold: 0.5, hysteresis: 0.2, high: 3.3, low: 0 };
    const ramp = [0, 0.45, 0.55, 0.61, 0.55, 0.45, 0.39, 0.45, 0.61];
    const levels: boolean[] = [];
    let high = false;
    for (const v of ramp) {
      const out = meshSignalLevel(comp, v, high);
      high = out.high;
      levels.push(high);
      expect(out.volts).toBe(high ? 3.3 : 0);
    }
    expect(levels).toEqual([false, false, false, true, true, true, false, false, true]);
  });

  it('puts the channel it is bound to on its pin, slice by slice', async () => {
    const contacts = { value: 0 };
    const endpoint: CoSimEndpoint = {
      stepFor: async (_dt, _inputs, outputs) => ({ t: 0, outputs: Object.fromEntries(outputs.map(o => [o, contacts.value])), unknown: [] }),
    };
    const nodes = [node('SW', 'meshsignal', { channel: 'body:jaw.contacts', threshold: 0.5, high: 5, low: 0 }), node('G', 'ground'), node('R', 'resistor', { resistance: 1000 })];
    const edges = [wire('SW', 'out', 'R', 'in'), wire('R', 'out', 'G', 'in'), wire('SW', 'gnd', 'G', 'in')];
    expect(coSimBindings(nodes).outputs).toEqual(['body:jaw.contacts']);
    let state = initialCoSimState();
    const seen: number[] = [];
    for (const c of [0, 0, 2, 2, 0]) {
      contacts.value = c;
      const out = await coSimStep(state, { nodes, edges, sliceMs: 5 }, { solve, endpoint });
      const { netlist } = generateSpiceNetlist(out.nodes, edges, { analysis: { kind: 'op' } });
      seen.push(Number(/V_SW \S+ \S+ DC (\S+)/.exec(netlist)![1]));
      state = out.state;
    }
    // Each slice drives what the scene reported at the end of the one before.
    expect(seen).toEqual([0, 0, 0, 5, 5]);
  });
});
