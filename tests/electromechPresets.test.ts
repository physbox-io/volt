import { describe, it, expect, beforeAll } from 'vitest';
import type { Node } from '@xyflow/react';
import { Simulation } from 'eecircuit-engine';
import { generateSpiceNetlist } from '../src/utils/spice';
import { runSketches } from '../src/utils/mcu';
import { presets } from '../src/utils/presets';
import { coSimStep, initialCoSimState } from '../src/sim/coSimStep';
import type { CoSimEndpoint, Stepped } from '../src/utils/coSimLink';
import type { SpiceResult } from '../src/types/simulation';

/**
 * The electromechanical presets do what their note cards say they do.
 */

let engine: Simulation;
const solve = async (netlist: string) => {
  engine.setNetList(netlist);
  return (await engine.runSim()) as SpiceResult;
};
beforeAll(async () => {
  engine = new Simulation();
  await engine.start();
});

/** One Run of a preset, as the app does it (sketch first, then the solve). */
async function runPreset(key: string, edit: (nodes: Node[]) => void = () => {}) {
  const p = presets[key];
  const nodes = structuredClone(p.nodes) as Node[];
  edit(nodes);
  const length = p.recommendedSimLength ?? 1;
  const { drives } = runSketches(nodes, length);
  const { netlist } = generateSpiceNetlist(nodes, p.edges, { simLength: length, mcuDrives: drives });
  const r = await solve(netlist);
  const col = (n: string) => r.data[r.variableNames.findIndex(v => v.toLowerCase() === n)].values as number[];
  const t = col('time');
  const at = (name: string, ts: number) => col(name)[t.findIndex(x => x >= ts)];
  return { col, t, at };
}

describe('Gearmotor Overcurrent Trip', () => {
  it('runs at ~115rpm on ~25mA, and blows the fuse when thrown into reverse', async () => {
    const r = await runPreset('gearmotorTrip');
    const w = r.at('v(int_m1_w)', 0.39);
    expect(w * 60 / (2 * Math.PI)).toBeGreaterThan(105);
    expect(w * 60 / (2 * Math.PI)).toBeLessThan(120);
    expect(Math.abs(r.at('i(l_m1_p1)', 0.39))).toBeLessThan(0.05);
    expect(r.at('v(int_f1_h)', 0.39)).toBeLessThan(0.02);
    // The reversal at 0.4s: blown well before 0.5s, and the motor has lost its drive.
    expect(r.at('v(int_f1_h)', 0.45)).toBeGreaterThanOrEqual(0.02);
    expect(Math.abs(r.at('i(l_m1_p1)', 0.9))).toBeLessThan(1e-3);
  });

  it('survives the same reversal when the sketch brakes first', async () => {
    const r = await runPreset('gearmotorTrip', nodes => {
      const mcu = nodes.find(n => n.id === 'mcu1')!;
      mcu.data.code = String(mcu.data.code).replace("//   digitalWrite('D1', 1); sleep(200);", "digitalWrite('D1', 1); sleep(200);");
    });
    expect(Math.max(...r.col('v(int_f1_h)'))).toBeLessThan(0.02);
    // And ends up running backwards.
    expect(r.at('v(int_m1_w)', 0.95)).toBeLessThan(-10);
  });
});

describe('NEMA 17 Stepper', () => {
  it('turns 45° (100 quarter steps) one way in the first half-second, and back', async () => {
    const r = await runPreset('nema17Stepper');
    const quarter = Math.PI / 2 / 4;
    const th = (ts: number) => r.at('v(int_d1_th)', ts);
    expect(th(0.499) / quarter).toBeCloseTo(100, 0);
    expect(Math.abs(th(0.999) / quarter)).toBeLessThan(1.5);
    // The rotor follows: N·x = 45° + θ, to within half a full step. Not
    // tighter: a current-regulated driver leaves the rotor undamped, so it
    // rings at ~240Hz about each microstep, and the detent pulls it toward
    // the full-step positions in between.
    const lag = (Math.PI / 4 + th(0.499) - 50 * r.at('v(int_s1_x)', 0.499)) / quarter;
    expect(Math.abs(lag)).toBeLessThan(2);
  });
});

/**
 * The jaw, stood in for the way Mesh steps a joint: the force law at the
 * joint's position each step, the motor's rotor as armature; a hard stop at
 * `blockAt` when the block is in the way, and at the joint's 1.4 rad limit.
 */
function jaw(blockAt: number | null): CoSimEndpoint & { pos: number } {
  const state = { pos: 0, vel: 0 };
  const inertia = 1e-4;
  const h = 1e-4;
  const stop = Math.min(blockAt ?? Infinity, 1.4);
  return {
    get pos() { return state.pos; },
    async stepFor(dtMs, inputs, outputs): Promise<Stepped> {
      const torque = inputs['joint:jaw_hinge.force'] ?? 0;
      const j = inertia + (inputs['joint:jaw_hinge.armature'] ?? 0);
      const b = inputs['joint:jaw_hinge.damping'] ?? 0;
      for (let i = 0; i < Math.round(dtMs / 1000 / h); i++) {
        state.vel += ((torque - b * state.vel) / j) * h;
        state.pos += state.vel * h;
        if (state.pos >= stop) { state.pos = stop; state.vel = Math.min(state.vel, 0); }
      }
      const all: Record<string, number> = { 'joint:jaw_hinge.pos': state.pos, 'joint:jaw_hinge.vel': state.vel };
      return { t: 0, outputs: Object.fromEntries(outputs.map(o => [o, all[o] ?? 0])), unknown: outputs.filter(o => !(o in all)) };
    },
  };
}

async function runGripper(endpoint: CoSimEndpoint, ms: number) {
  const p = presets.gripperLimitSwitch;
  const nodes = structuredClone(p.nodes) as Node[];
  let state = initialCoSimState();
  let logs: string[] = [];
  for (let t = 0; t < ms; t += 10) {
    const out = await coSimStep(state, { nodes, edges: p.edges, sliceMs: 10 }, { solve, endpoint });
    expect(out.unknown).toEqual([]);
    state = out.state;
    logs = logs.concat(out.logs.mcu1 ?? []);
  }
  return { state, logs };
}

describe('Gripper with Limit Switch, linked', () => {
  it('closes until the switch, then brakes, with the fuse intact', async () => {
    const j = jaw(null);
    const { state, logs } = await runGripper(j, 600);
    expect(logs.some(l => l.startsWith('jaw shut at'))).toBe(true);
    // Braked just past the 1.15 rad switch, short of the 1.4 rad hard stop.
    expect(j.pos).toBeGreaterThan(1.15);
    expect(j.pos).toBeLessThan(1.4);
    expect(state.sim['int_f1_h'] ?? 0).toBeLessThan(0.02);
  });

  it('blows the fuse when the jaw is wedged on the block before the switch', async () => {
    const j = jaw(0.7);
    const { state, logs } = await runGripper(j, 400);
    expect(j.pos).toBeCloseTo(0.7, 6);
    expect(logs.some(l => l.startsWith('jaw shut at'))).toBe(false);
    expect(state.sim['int_f1_h']).toBeGreaterThanOrEqual(0.02);
  });
});
