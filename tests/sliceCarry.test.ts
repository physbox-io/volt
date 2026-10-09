import { describe, it, expect, beforeAll } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { Simulation } from 'eecircuit-engine';
import { generateSpiceNetlist } from '../src/utils/spice';
import { readEndState, type SimState } from '../src/utils/simState';
import type { SpiceResult } from '../src/types/simulation';

/**
 * A transient run cut into slices, each seeded with the state the last one
 * ended on, follows the run made in one go.
 *
 * This is what HIL does every 40ms and what "continue" does between runs. The
 * circuits are the ones where the state is mostly current in a coil — a
 * circuit of resistors and capacitors would pass on voltages alone.
 */

const node = (id: string, type: string, data: Record<string, unknown> = {}): Node => ({
  id, type, position: { x: 0, y: 0 }, data,
});
const wire = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`,
  source, sourceHandle, target, targetHandle,
});

/** 5V into R then L to ground; OUT is the coil's top end. τ = L/R. */
const rl = (r: number, l: number) => ({
  nodes: [
    node('V1', 'voltage', { voltage: 5 }), node('R1', 'resistor', { resistance: r }),
    node('L1', 'inductor', { inductance: l }), node('OUT', 'netlabel', { net: 'OUT' }), node('GND1', 'ground'),
  ],
  edges: [
    wire('V1', 'pos', 'R1', 'in'), wire('R1', 'out', 'OUT', 'in'), wire('OUT', 'in', 'L1', 'in'),
    wire('L1', 'out', 'GND1', 'in'), wire('V1', 'neg', 'GND1', 'in'),
  ],
});

/** 5V stepped into a lightly damped series R-L-C; OUT is across the capacitor. */
const rlc = (r: number, l: number, c: number) => ({
  nodes: [
    node('V1', 'voltage', { voltage: 5 }), node('R1', 'resistor', { resistance: r }),
    node('L1', 'inductor', { inductance: l }), node('C1', 'capacitor', { capacitance: c }),
    node('OUT', 'netlabel', { net: 'OUT' }), node('GND1', 'ground'),
  ],
  edges: [
    wire('V1', 'pos', 'R1', 'in'), wire('R1', 'out', 'L1', 'in'), wire('L1', 'out', 'OUT', 'in'),
    wire('OUT', 'in', 'C1', 'in'), wire('C1', 'out', 'GND1', 'in'), wire('V1', 'neg', 'GND1', 'in'),
  ],
});

/** 5V stepped through R into a transformer primary; OUT is across the secondary's load. */
const transformer = (r: number, load: number) => ({
  nodes: [
    node('V1', 'voltage', { voltage: 5 }), node('R1', 'resistor', { resistance: r }),
    node('T1', 'transformer', { l_pri: 0.01, l_sec: 0.01, k: 0.95 }),
    node('R2', 'resistor', { resistance: load }), node('OUT', 'netlabel', { net: 'OUT' }), node('GND1', 'ground'),
  ],
  edges: [
    wire('V1', 'pos', 'R1', 'in'), wire('R1', 'out', 'T1', 'p1'), wire('T1', 'p2', 'GND1', 'in'),
    wire('T1', 's1', 'OUT', 'in'), wire('OUT', 'in', 'R2', 'in'), wire('R2', 'out', 'GND1', 'in'),
    wire('T1', 's2', 'GND1', 'in'), wire('V1', 'neg', 'GND1', 'in'),
  ],
});

const STEP_MS = 0.005;

let engine: Simulation | null = null;
beforeAll(async () => {
  engine = new Simulation();
  await engine.start();
});

async function run(nodes: Node[], edges: Edge[], lengthMs: number, state: SimState) {
  const { netlist, portToNet } = generateSpiceNetlist(nodes, edges, lengthMs / 1000, 'normal', {}, state, STEP_MS);
  engine!.setNetList(netlist);
  return { result: (await engine!.runSim()) as SpiceResult, out: portToNet['OUT-in'].toLowerCase() };
}

function vector(result: SpiceResult, name: string): number[] {
  const i = result.variableNames.findIndex(v => v.toLowerCase() === name);
  expect(i, `${name} in ${result.variableNames.join(', ')}`).toBeGreaterThanOrEqual(0);
  return result.data[i].values as number[];
}

/** The one-shot run's `net` at `tMs`, linearly between its samples. */
function sampleAt(result: SpiceResult, net: string, tMs: number): number {
  const t = vector(result, 'time');
  const v = vector(result, `v(${net})`);
  const s = tMs / 1000;
  const k = t.findIndex(x => x >= s);
  if (k <= 0) return v[k < 0 ? v.length - 1 : 0];
  const f = (s - t[k - 1]) / (t[k] - t[k - 1]);
  return v[k - 1] + f * (v[k] - v[k - 1]);
}

const cases = [
  { name: 'RL, τ = 1ms', circuit: rl(10, 0.01), totalMs: 4, slices: [2, 5, 10] },
  { name: 'RL, τ = 0.2ms', circuit: rl(50, 0.01), totalMs: 1, slices: [4, 10] },
  { name: 'RLC, ~500Hz ring', circuit: rlc(1, 0.01, 1e-5), totalMs: 6, slices: [3, 8, 15] },
  { name: 'RLC, ~1.6kHz ring', circuit: rlc(2, 0.001, 1e-5), totalMs: 3, slices: [5, 12] },
  { name: 'transformer into 100Ω', circuit: transformer(10, 100), totalMs: 4, slices: [4, 10] },
];

describe('a transient run cut into slices', () => {
  for (const { name, circuit, totalMs, slices } of cases) {
    it(`follows the one-shot run: ${name}`, async () => {
      const { nodes, edges } = circuit;
      // Seeding with OUT's net at 0 makes both runs start from rest under `uic`,
      // rather than from the operating point, where nothing would move.
      const { out } = await run(nodes, edges, 0.01, {});
      const rest: SimState = { [out]: 0 };
      const { result: whole } = await run(nodes, edges, totalMs, rest);
      const peak = Math.max(...vector(whole, `v(${out})`).map(Math.abs));
      expect(peak).toBeGreaterThan(0.1);

      for (const n of slices) {
        const sliceMs = totalMs / n;
        let state = rest;
        for (let k = 1; k <= n; k++) {
          state = readEndState((await run(nodes, edges, sliceMs, state)).result);
          const expected = sampleAt(whole, out, k * sliceMs);
          expect(Math.abs(state[out] - expected), `${n} slices, end of slice ${k}`).toBeLessThan(0.01 * peak);
        }
      }
    });
  }
});
