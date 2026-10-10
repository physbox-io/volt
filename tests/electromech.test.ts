import { describe, it, expect, beforeAll } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { Simulation } from 'eecircuit-engine';
import { generateSpiceNetlist } from '../src/utils/spice';
import { readEndState, type SimState } from '../src/utils/simState';
import { runSketches } from '../src/utils/mcu';
import type { SpiceResult } from '../src/types/simulation';

/**
 * The electromechanical parts against their physics: the DC motor's speed,
 * time constant and energy balance, the stepper's holding angle and pull-out,
 * the step driver's count, the H-bridge's truth table and the fuse's I²t —
 * each over a spread of parameters, run on the real engine.
 */

const node = (id: string, type: string, data: Record<string, unknown> = {}): Node => ({
  id, type, position: { x: 0, y: 0 }, data,
});
const wire = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`,
  source, sourceHandle, target, targetHandle,
});

let engine: Simulation;
beforeAll(async () => {
  engine = new Simulation();
  await engine.start();
});

type Run = { result: SpiceResult; portToNet: Record<string, string>; v: (name: string) => number[]; t: number[] };

/** Runs from `state` (from rest with uic when it has any entry) for `lengthMs` at `stepMs`. */
async function run(nodes: Node[], edges: Edge[], lengthMs: number, stepMs: number, state: SimState): Promise<Run> {
  const { netlist, portToNet } = generateSpiceNetlist(nodes, edges, { simLength: lengthMs / 1000, initialConditions: state, hilMaxStepMs: stepMs });
  engine.setNetList(netlist);
  const result = (await engine.runSim()) as SpiceResult;
  const v = (name: string) => {
    const i = result.variableNames.findIndex(n => n.toLowerCase() === name.toLowerCase());
    expect(i, `${name} in ${result.variableNames.join(', ')}`).toBeGreaterThanOrEqual(0);
    return result.data[i].values as number[];
  };
  return { result, portToNet, v, t: v('time') };
}

const last = (a: number[]) => a[a.length - 1];

/** ∫ f dt by the trapezoid rule over the run's own samples. */
const integrate = (t: number[], f: (i: number) => number) => {
  let s = 0;
  for (let i = 1; i < t.length; i++) s += 0.5 * (f(i) + f(i - 1)) * (t[i] - t[i - 1]);
  return s;
};

describe('a DC motor', () => {
  const sets = [
    { v: 6, r: 2, kt: 0.01, j: 5e-6, b: 1e-6, load: 0 },
    { v: 12, r: 1, kt: 0.05, j: 2e-5, b: 1e-5, load: 0 },
    { v: 3, r: 5, kt: 0.005, j: 1e-6, b: 0, load: 0 },
    { v: 24, r: 0.5, kt: 0.1, j: 1e-4, b: 1e-4, load: 0.5 },
    { v: 12, r: 1, kt: 0.05, j: 2e-5, b: 1e-5, load: 0.2 },
  ];
  const circuit = (s: typeof sets[number], extra: Record<string, unknown> = {}) => ({
    nodes: [
      node('V1', 'voltage', { voltage: s.v }), node('G', 'ground'),
      node('M', 'dcmotor', { windingR: s.r, windingL: 1e-4, kt: s.kt, inertia: s.j, friction: s.b, loadTorque: s.load, ...extra }),
    ],
    edges: [wire('V1', 'pos', 'M', 'a'), wire('M', 'b', 'G', 'in'), wire('V1', 'neg', 'G', 'in')],
  });

  for (const s of sets) {
    const label = `${s.v}V, R=${s.r}, Kt=${s.kt}, J=${s.j}, b=${s.b}, load=${s.load}`;
    it(`spins up to Kt·V/(Kt²+R·b) with τ = J·R/(Kt²+R·b), and every joule is accounted for: ${label}`, async () => {
      const { nodes, edges } = circuit(s);
      const denom = s.kt * s.kt + s.r * s.b;
      const wSteady = (s.kt * s.v - s.r * s.load) / denom;
      const tau = (s.j * s.r) / denom;
      const r = await run(nodes, edges, tau * 8000, tau * 5, { 'i(l_m_p1)': 0 });
      const w = r.v('v(int_m_w)');
      const i = r.v('i(l_m_p1)');
      expect(last(w)).toBeGreaterThan(0);
      expect(Math.abs(last(w) - wSteady) / wSteady).toBeLessThan(0.01);

      // 63.2% of the way there after one time constant (the coil's own
      // L/R is a thousandth of it, and lags it a little).
      const k = w.findIndex(x => x >= 0.632 * wSteady);
      expect(Math.abs(r.t[k] - tau / 1000 * 1000) / tau).toBeLessThan(0.03);

      // Energy in = copper loss + friction + load work + what's stored in the rotor and coil.
      const ein = integrate(r.t, n => s.v * i[n]);
      const copper = integrate(r.t, n => i[n] * i[n] * s.r);
      const friction = integrate(r.t, n => s.b * w[n] * w[n]);
      const loadWork = integrate(r.t, n => s.load * w[n]);
      const stored = 0.5 * s.j * last(w) ** 2 + 0.5 * 1e-4 * last(i) ** 2;
      expect(Math.abs(ein - (copper + friction + loadWork + stored)) / ein).toBeLessThan(0.02);
    });
  }

  it('draws V/R with the rotor held', async () => {
    for (const s of sets) {
      const { nodes, edges } = circuit(s, { inertia: 1e6 });
      const r = await run(nodes, edges, 50, 0.1, { 'i(l_m_p1)': 0 });
      expect(Math.abs(last(r.v('i(l_m_p1)')) - s.v / s.r) / (s.v / s.r)).toBeLessThan(0.005);
    }
  });

  it('carries its speed across slices', async () => {
    const s = sets[0];
    const { nodes, edges } = circuit(s);
    const tau = (s.j * s.r) / (s.kt * s.kt + s.r * s.b);
    const whole = await run(nodes, edges, tau * 3000, tau * 5, { 'i(l_m_p1)': 0 });
    let state: SimState = { 'i(l_m_p1)': 0 };
    for (let k = 0; k < 6; k++) state = readEndState((await run(nodes, edges, tau * 500, tau * 5, state)).result);
    expect(Math.abs(state['int_m_w'] - last(whole.v('v(int_m_w)'))) / last(whole.v('v(int_m_w)'))).toBeLessThan(0.01);
  });
});

/** A stepper with an ideal current source through phase A, a1 → a2. */
const heldStepper = (amps: number, load: number, data: Record<string, unknown> = {}) => ({
  nodes: [
    node('I1', 'currentsource', { label: String(amps) }), node('G', 'ground'),
    node('S', 'stepper', { detentTorque: 0, friction: 0.02, loadTorque: load, ...data }),
  ],
  edges: [
    wire('I1', 'neg', 'S', 'a1'), wire('S', 'a2', 'I1', 'pos'), wire('S', 'a2', 'G', 'in'),
    wire('S', 'b1', 'G', 'in'), wire('S', 'b2', 'G', 'in'),
  ],
});

describe('a stepper with phase A held', () => {
  // 0.4N·m at 1.7A: Kt = 0.235N·m/A; 50 teeth.
  const kt = 0.4 / 1.7;
  for (const amps of [0.5, 1, 1.7]) for (const frac of [0, 0.3, 0.7, 0.95]) {
    it(`settles where Kt·I·sin(50x) balances the load: ${amps}A, ${frac * 100}% of holding torque`, async () => {
      const load = frac * kt * amps;
      const { nodes, edges } = heldStepper(amps, load);
      const r = await run(nodes, edges, 300, 0.05, { 'i(l_s_p1)': 0, 'i(l_s_p2)': 0 });
      const expected = -Math.asin(load / (kt * amps)) / 50;
      expect(Math.abs(last(r.v('v(int_s_x)')) - expected)).toBeLessThan(0.002 * Math.PI / 100 + 1e-4);
    });
  }

  it('slips when the load is past its holding torque', async () => {
    const { nodes, edges } = heldStepper(1, 1.3 * kt);
    const r = await run(nodes, edges, 300, 0.05, { 'i(l_s_p1)': 0, 'i(l_s_p2)': 0 });
    // Further back than the quarter tooth it can hold at.
    expect(last(r.v('v(int_s_x)'))).toBeLessThan(-Math.PI / 2 / 50 * 2);
  });
});

/**
 * STEP from an inverted square wave, so it starts low and rises at 0.5/f,
 * 1.5/f…; DIR and EN from fixed sources; a stepper on the outputs.
 */
const driven = (f: number, micro: number, dirHigh: boolean, opts: { enHigh?: boolean; load?: number; ilim?: number } = {}) => ({
  nodes: [
    node('VM', 'voltage', { voltage: 12 }), node('VD', 'voltage', { voltage: dirHigh ? 3.3 : 0 }),
    node('VE', 'voltage', { voltage: opts.enHigh ? 3.3 : 0 }), node('G', 'ground'),
    node('SG', 'signalgen', { waveform: 'square', frequency: f, amplitude: 3.3, dutyCycle: 50 }),
    node('N', 'not'),
    node('D', 'stepdriver', { microsteps: micro, currentLimit: opts.ilim ?? 1 }),
    node('S', 'stepper', { detentTorque: 0, friction: 0.01, loadTorque: opts.load ?? 0 }),
  ],
  edges: [
    wire('VM', 'pos', 'D', 'vm'), wire('VM', 'neg', 'G', 'in'), wire('D', 'gnd', 'G', 'in'),
    wire('SG', 'out', 'N', 'in1'), wire('N', 'out', 'D', 'step'), wire('SG', 'gnd', 'G', 'in'),
    wire('VD', 'pos', 'D', 'dir'), wire('VD', 'neg', 'G', 'in'),
    wire('VE', 'pos', 'D', 'en'), wire('VE', 'neg', 'G', 'in'),
    wire('D', 'a1', 'S', 'a1'), wire('D', 'a2', 'S', 'a2'), wire('D', 'b1', 'S', 'b1'), wire('D', 'b2', 'S', 'b2'),
  ],
});

const FROM_REST: SimState = { 'i(l_s_p1)': 0, 'i(l_s_p2)': 0 };

describe('a step driver turning a stepper', () => {
  const cases = [
    { f: 100, micro: 1, steps: 8 },
    { f: 200, micro: 2, steps: 13 },
    { f: 400, micro: 4, steps: 20 },
    { f: 800, micro: 16, steps: 40 },
  ];
  for (const { f, micro, steps } of cases) for (const dirHigh of [true, false]) {
    it(`advances 1.8°/${micro} for each of ${steps} pulses at ${f}Hz, ${dirHigh ? 'forward' : 'back'}`, async () => {
      const { nodes, edges } = driven(f, micro, dirHigh);
      // Stop half a period after the last rising edge.
      const lengthMs = (steps / f) * 1000;
      const r = await run(nodes, edges, lengthMs, 0.02, FROM_REST);
      const sign = dirHigh ? 1 : -1;
      const stepRad = (Math.PI / 2) / micro;
      // The count is exact, to a hundredth of a step over the run.
      const th = r.v('v(int_d_th)');
      expect(Math.abs(last(th) - th[0] - sign * steps * stepRad)).toBeLessThan(0.01 * stepRad);
      // The rotor follows to N·x = 45° + θ (it starts at x = 0, half a full
      // step short of the driver's home), lagging by less than a step as it
      // moves.
      const x = r.v('v(int_s_x)');
      const lagSteps = (Math.PI / 4 + last(th) - 50 * last(x)) / stepRad;
      expect(Math.abs(lagSteps)).toBeLessThan(1);
    });
  }

  it('drives no current with EN high, though it still counts', async () => {
    const { nodes, edges } = driven(200, 4, true, { enHigh: true });
    const r = await run(nodes, edges, 50, 0.02, FROM_REST);
    expect(Math.abs(last(r.v('i(v_d_sa)')))).toBeLessThan(1e-3);
    expect(Math.abs(last(r.v('i(v_d_sb)')))).toBeLessThan(1e-3);
    const x = r.v('v(int_s_x)');
    expect(Math.abs(last(x) - x[0])).toBeLessThan(1e-3);
  });

  it('holds each phase at Ilim on the sine table, and draws that power from the supply', async () => {
    for (const ilim of [0.5, 1, 1.5]) {
      const { nodes, edges } = driven(0.001, 16, true, { ilim });
      // No edge yet: θ is the 45° home.
      const r = await run(nodes, edges, 40, 0.02, FROM_REST);
      const angle = Math.PI / 4;
      // Within 1%: the regulator is proportional, and settles R/(G+R) — 0.5%
      // here — short. A real A4988 holds its current to about ±5%.
      expect(Math.abs(last(r.v('i(v_d_sa)')) / (ilim * Math.cos(angle)) - 1)).toBeLessThan(0.01);
      expect(Math.abs(last(r.v('i(v_d_sb)')) / (ilim * Math.sin(angle)) - 1)).toBeLessThan(0.01);
      // At standstill all of it is copper loss: VM·I_supply = (Ia² + Ib²)·R.
      const supply = -last(r.v('i(v_vm)'));
      expect(supply * 12).toBeCloseTo(ilim * ilim * 1.5, 1);
    }
  });

  it('loses steps against a load past what Ilim can hold', async () => {
    const kt = 0.4 / 1.7;
    const { nodes, edges } = driven(200, 1, true, { ilim: 0.5, load: 1.5 * kt * 0.5 });
    const r = await run(nodes, edges, 100, 0.02, FROM_REST);
    const stepRad = Math.PI / 2;
    const lagSteps = (Math.PI / 4 + last(r.v('v(int_d_th)')) - 50 * last(r.v('v(int_s_x)'))) / stepRad;
    expect(lagSteps).toBeGreaterThan(2);
  });
});

describe('an H-bridge', () => {
  const vm = 9;
  const rds = 0.18;
  const truth = [
    { in1: 0, in2: 0, out: 0 },
    { in1: 1, in2: 0, out: 1 },
    { in1: 0, in2: 1, out: -1 },
    { in1: 1, in2: 1, out: 0 },
  ];
  for (const rl of [4, 20, 100]) for (const row of truth) {
    it(`IN1=${row.in1} IN2=${row.in2} into ${rl}Ω`, async () => {
      const nodes = [
        node('VM', 'voltage', { voltage: vm }), node('G', 'ground'),
        node('V1', 'voltage', { voltage: row.in1 * 3.3 }), node('V2', 'voltage', { voltage: row.in2 * 3.3 }),
        node('H', 'hbridge'), node('RL', 'resistor', { resistance: rl }),
      ];
      const edges = [
        wire('VM', 'pos', 'H', 'vm'), wire('VM', 'neg', 'G', 'in'), wire('H', 'gnd', 'G', 'in'),
        wire('V1', 'pos', 'H', 'in1'), wire('V1', 'neg', 'G', 'in'), wire('V2', 'pos', 'H', 'in2'), wire('V2', 'neg', 'G', 'in'),
        wire('H', 'out1', 'RL', 'in'), wire('RL', 'out', 'H', 'out2'),
      ];
      const r = await run(nodes, edges, 1, 0.01, {});
      const across = last(r.v(`v(${r.portToNet['H-out1']})`)) - last(r.v(`v(${r.portToNet['H-out2']})`));
      expect(across).toBeCloseTo(row.out * vm * rl / (rl + 2 * rds), 2);
    });
  }

  it('lets a spinning motor coast through its body diodes without blowing up', async () => {
    const nodes = [
      node('VM', 'voltage', { voltage: 12 }), node('G', 'ground'),
      node('SG', 'signalgen', { waveform: 'square', frequency: 5, amplitude: 3.3, dutyCycle: 50 }),
      node('H', 'hbridge'), node('M', 'dcmotor'),
    ];
    const edges = [
      wire('VM', 'pos', 'H', 'vm'), wire('VM', 'neg', 'G', 'in'), wire('H', 'gnd', 'G', 'in'),
      wire('SG', 'out', 'H', 'in1'), wire('SG', 'gnd', 'G', 'in'), wire('H', 'in2', 'G', 'in'),
      wire('H', 'out1', 'M', 'a'), wire('M', 'b', 'H', 'out2'),
    ];
    const r = await run(nodes, edges, 200, 0.05, { 'i(l_m_p1)': 0 });
    const w = r.v('v(int_m_w)');
    const out1 = r.v(`v(${r.portToNet['H-out1']})`);
    // Driven for the first 100ms, coasting after: spinning down, never past the rails by more than a diode.
    expect(Math.max(...w)).toBeGreaterThan(100);
    expect(last(w)).toBeLessThan(Math.max(...w));
    expect(Math.max(...out1)).toBeLessThan(12 + 1.2);
    expect(Math.min(...out1)).toBeGreaterThan(-1.2);
  });
});

describe('a fuse', () => {
  const circuit = (volts: number, load: number, data: Record<string, unknown> = {}) => ({
    nodes: [
      node('V1', 'voltage', { voltage: volts }), node('G', 'ground'),
      node('F', 'fuse', data), node('RL', 'resistor', { resistance: load }),
    ],
    edges: [wire('V1', 'pos', 'F', 'in'), wire('F', 'out', 'RL', 'in'), wire('RL', 'out', 'G', 'in'), wire('V1', 'neg', 'G', 'in')],
  });
  const current = (r: Run, volts: number) => r.v(`v(${r.portToNet['F-out']})`).map(v => v / (volts / volts)) ;

  for (const { rating, i2t, amps } of [
    { rating: 1, i2t: 0.1, amps: 2 },
    { rating: 0.5, i2t: 0.02, amps: 1.5 },
    { rating: 3, i2t: 2, amps: 10 },
  ]) {
    it(`blows at I²t / (I² − rating²): ${amps}A through a ${rating}A, ${i2t}A²s fuse`, async () => {
      const load = 1;
      const volts = amps * (load + 0.05);
      const { nodes, edges } = circuit(volts, load, { rating, i2t, coldR: 0.05 });
      const expected = i2t / (amps * amps - rating * rating);
      const r = await run(nodes, edges, expected * 3000, expected * 2, { int_f_h: 0 });
      const iLoad = current(r, volts);
      const k = iLoad.findIndex(i => i < amps / 2);
      expect(k).toBeGreaterThan(0);
      expect(Math.abs(r.t[k] - expected) / expected).toBeLessThan(0.03);
      // And stays open.
      expect(Math.max(...iLoad.slice(k + 5))).toBeLessThan(1e-3);
    });
  }

  it('carries its rating indefinitely', async () => {
    const { nodes, edges } = circuit(0.95 * 1.05, 1, { rating: 1, i2t: 0.1, coldR: 0.05 });
    const r = await run(nodes, edges, 2000, 2, { int_f_h: 0 });
    expect(last(current(r, 1))).toBeCloseTo(0.95, 2);
  });

  it('stays blown across slices', async () => {
    const { nodes, edges } = circuit(2 * 1.05, 1, { rating: 1, i2t: 0.1, coldR: 0.05 });
    let state: SimState = { int_f_h: 0 };
    let iEnd = 0;
    for (let k = 0; k < 4; k++) {
      const r = await run(nodes, edges, 20, 0.1, state);
      state = readEndState(r.result);
      iEnd = last(current(r, 1));
    }
    expect(iEnd).toBeLessThan(1e-3);
  });
});

describe('the light step driver', () => {
  // Low for 2ms, high for 2ms: rising edges at 2, 6, 10ms… from a sketch, which a light driver is told about.
  const sketch = "pinMode('D0', 'OUTPUT');\nwhile(true) {\n  digitalWrite('D0', 0);\n  sleep(2);\n  digitalWrite('D0', 1);\n  sleep(2);\n}";
  const circuit = (model: 'light' | 'detailed', micro: number, dirHigh: boolean, viaGate = false) => ({
    nodes: [
      node('VM', 'voltage', { voltage: 12 }), node('VD', 'voltage', { voltage: dirHigh ? 3.3 : 0 }), node('G', 'ground'),
      node('U', 'mcu', { code: sketch }), node('N1', 'not'), node('N2', 'not'),
      node('D', 'stepdriver', { microsteps: micro, currentLimit: 1, driverModel: model }),
      node('S', 'stepper', { detentTorque: 0, friction: 0.01 }),
    ],
    edges: [
      wire('VM', 'pos', 'D', 'vm'), wire('VM', 'neg', 'G', 'in'), wire('D', 'gnd', 'G', 'in'), wire('U', 'GND', 'G', 'in'),
      ...(viaGate ? [wire('U', 'D0', 'N1', 'in1'), wire('N1', 'out', 'N2', 'in1'), wire('N2', 'out', 'D', 'step')] : [wire('U', 'D0', 'D', 'step')]),
      wire('VD', 'pos', 'D', 'dir'), wire('VD', 'neg', 'G', 'in'), wire('D', 'en', 'G', 'in'),
      wire('D', 'a1', 'S', 'a1'), wire('D', 'a2', 'S', 'a2'), wire('D', 'b1', 'S', 'b1'), wire('D', 'b2', 'S', 'b2'),
    ],
  });
  const runSketched = async (nodes: Node[], edges: Edge[], lengthMs: number, state: SimState, realtime = false) => {
    const { drives } = runSketches(nodes, lengthMs / 1000);
    const { netlist, portToNet } = generateSpiceNetlist(nodes, edges, { simLength: lengthMs / 1000, initialConditions: state, hilMaxStepMs: 0.02, mcuDrives: drives, realtime });
    engine.setNetList(netlist);
    const result = (await engine.runSim()) as SpiceResult;
    const v = (name: string) => result.data[result.variableNames.findIndex(n => n.toLowerCase() === name)].values as number[];
    return { netlist, result, portToNet, v };
  };

  for (const micro of [1, 4, 16]) for (const dirHigh of [true, false]) {
    it(`agrees with the detailed driver: 1/${micro} steps, ${dirHigh ? 'forward' : 'back'}`, async () => {
      const finals: Record<string, { th: number; x: number; ia: number; ib: number }> = {};
      for (const model of ['light', 'detailed'] as const) {
        const { nodes, edges } = circuit(model, micro, dirHigh);
        const r = await runSketched(nodes, edges, 41, { 'i(l_s_p1)': 0, 'i(l_s_p2)': 0 });
        if (model === 'light') expect(r.netlist).not.toMatch(/^B_D_ms /m);
        finals[model] = { th: last(r.v('v(int_d_th)')), x: last(r.v('v(int_s_x)')), ia: last(r.v('i(v_d_sa)')), ib: last(r.v('i(v_d_sb)')) };
      }
      const stepRad = Math.PI / 2 / micro;
      const sign = dirHigh ? 1 : -1;
      // Rising edges at 2, 6 … 38ms: ten. Both count them: the light driver is
      // told them, and the detailed one counts to a thousandth of a step.
      expect(finals.light.th).toBeCloseTo(sign * 10 * stepRad, 9);
      expect(Math.abs(finals.detailed.th - sign * 10 * stepRad) / stepRad).toBeLessThan(0.001);
      // The rotor ends in the same place, to a fifth of a step.
      expect(Math.abs(finals.light.x - finals.detailed.x) * 50 / stepRad).toBeLessThan(0.2);
      // And each holds both phases on the sine table at its own angle: the
      // light one exactly, the detailed one to its regulator's 1%.
      for (const [m, tol] of [['light', 1e-3], ['detailed', 0.012]] as const) {
        const a = finals[m].th + Math.PI / 4;
        expect(Math.abs(finals[m].ia - Math.cos(a)), m).toBeLessThan(tol);
        expect(Math.abs(finals[m].ib - Math.sin(a)), m).toBeLessThan(tol);
      }
    });
  }

  it('keeps counting exactly across slices', async () => {
    const { nodes, edges } = circuit('light', 8, true);
    let state: SimState = { 'i(l_s_p1)': 0, 'i(l_s_p2)': 0 };
    for (let k = 0; k < 9; k++) state = readEndState((await runSketched(nodes, edges, 5, state)).result, state);
    // 45ms: rising edges at 2, 6 … 42ms, eleven of them.
    expect(state['int_d_th']).toBeCloseTo(11 * (Math.PI / 2 / 8), 6);
  });

  it('falls back to the detailed driver when it cannot know its STEP edges', async () => {
    const { nodes, edges } = circuit('light', 4, true, true);
    const r = await runSketched(nodes, edges, 1, {}, true);
    expect(r.netlist).toMatch(/^B_D_ms /m);
  });

  it('is what a real-time run gets, and only when its inputs are known', async () => {
    const auto = circuit('light', 4, true).nodes.map(n => (n.id === 'D' ? { ...n, data: { ...n.data, driverModel: undefined } } : n));
    const { edges } = circuit('light', 4, true);
    expect((await runSketched(auto, edges, 1, {}, true)).netlist).not.toMatch(/^B_D_ms /m);
    expect((await runSketched(auto, edges, 1, {}, false)).netlist).toMatch(/^B_D_ms /m);
  });
});
