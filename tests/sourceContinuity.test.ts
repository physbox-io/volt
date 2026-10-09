import { describe, it, expect, beforeAll } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { Simulation } from 'eecircuit-engine';
import { generateSpiceNetlist } from '../src/utils/spice';
import { readEndState, simTime, type SimState } from '../src/utils/simState';
import { pwlFrom } from '../src/utils/netlist/values';
import type { SpiceResult } from '../src/types/simulation';

/**
 * A run cut into slices, each started from the state the last one ended in,
 * traces the waveform the run made in one go — for every source that is a
 * function of time.
 *
 * HIL and a Mesh-linked run are nothing but slices, and Run continues from
 * where the last run stopped. Before the state carried its time, every
 * generator restarted at phase zero each slice: a 50Hz sine sliced every 5ms
 * came out a quarter-wave sawtooth.
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

const STEP_MS = 0.02;

async function run(nodes: Node[], edges: Edge[], lengthMs: number, state: SimState) {
  const { netlist, portToNet } = generateSpiceNetlist(nodes, edges, { simLength: lengthMs / 1000, initialConditions: state, hilMaxStepMs: STEP_MS });
  engine.setNetList(netlist);
  const result = (await engine.runSim()) as SpiceResult;
  const col = (name: string) => result.data[result.variableNames.findIndex(v => v.toLowerCase() === name)].values as number[];
  return { result, t: col('time'), v: col(`v(${portToNet['R1-in'].toLowerCase()})`) };
}

/** `v` at `ts` seconds, linearly between samples. */
function at(t: number[], v: number[], ts: number): number {
  const k = t.findIndex(x => x >= ts - 1e-12);
  if (k <= 0) return v[k < 0 ? v.length - 1 : 0];
  const f = (ts - t[k - 1]) / (t[k] - t[k - 1]);
  return v[k - 1] + f * (v[k] - v[k - 1]);
}

/** A source into a 1k load; the trace is across the load. */
const loaded = (source: Node, pos: string, neg: string) => ({
  nodes: [source, node('R1', 'resistor', { resistance: 1000 }), node('G', 'ground')],
  edges: [wire(source.id, pos, 'R1', 'in'), wire('R1', 'out', 'G', 'in'), wire(source.id, neg, 'G', 'in')],
});

const recording = Array.from({ length: 41 }, (_, i) => ({ t: i * 0.001, v: Math.sin(i * 0.7) * (i % 3 === 0 ? 1 : 0.4) }));

const cases: { name: string; circuit: ReturnType<typeof loaded>; amp: number; edges?: (ts: number) => boolean }[] = [];
for (const f of [50, 137, 400]) {
  cases.push({ name: `${f}Hz sine generator`, circuit: loaded(node('S', 'signalgen', { waveform: 'sine', frequency: f, amplitude: 2 }), 'out', 'gnd'), amp: 2 });
}
for (const [f, duty] of [[60, 50], [230, 25], [500, 70]] as const) {
  const period = 1 / f;
  cases.push({
    name: `${f}Hz square at ${duty}%`,
    circuit: loaded(node('S', 'signalgen', { waveform: 'square', frequency: f, amplitude: 5, dutyCycle: duty }), 'out', 'gnd'),
    amp: 5,
    // Near an edge the two runs sample a 1µs ramp at slightly different points.
    edges: ts => {
      const phase = ts % period;
      return Math.min(phase, Math.abs(phase - (duty / 100) * period), period - phase) < 3 * STEP_MS / 1000;
    },
  });
}
cases.push({ name: '60Hz AC source', circuit: loaded(node('S', 'acvoltage', { amplitude: 10, frequency: 60 }), 'pos', 'neg'), amp: 10 });
cases.push({ name: 'microphone recording', circuit: loaded(node('S', 'microphone', { pwlData: recording, amplification: 20 }), 'out', 'gnd'), amp: 1 });

describe('a source sliced', () => {
  for (const { name, circuit, amp, edges: nearEdge } of cases) {
    for (const sliceMs of [5, 3.3]) {
      it(`follows the one-shot run: ${name}, ${sliceMs}ms slices`, async () => {
        const totalMs = 33;
        const { nodes, edges } = circuit;
        const whole = await run(nodes, edges, totalMs, {});
        let state: SimState = {};
        let worst = 0;
        let start = 0;
        while (start < totalMs - 1e-9) {
          const len = Math.min(sliceMs, totalMs - start);
          const slice = await run(nodes, edges, len, state);
          for (let i = 0; i < slice.t.length; i++) {
            const ts = start / 1000 + slice.t[i];
            if (nearEdge?.(ts)) continue;
            worst = Math.max(worst, Math.abs(slice.v[i] - at(whole.t, whole.v, ts)));
          }
          state = readEndState(slice.result, state);
          start += len;
        }
        expect(simTime(state)).toBeCloseTo(totalMs / 1000, 9);
        expect(worst / amp).toBeLessThan(0.01);
      });
    }
  }
});

describe('a recording picked up part way', () => {
  it('starts at the value it had there and keeps every later point', () => {
    const pts = [{ t: 0, v: 0 }, { t: 1, v: 10 }, { t: 2, v: 0 }];
    expect(pwlFrom(pts, 0)).toBe(pts);
    expect(pwlFrom(pts, 0.25)).toEqual([{ t: 0, v: 2.5 }, { t: 0.75, v: 10 }, { t: 1.75, v: 0 }]);
    expect(pwlFrom(pts, 1)).toEqual([{ t: 0, v: 10 }, { t: 1, v: 0 }]);
    expect(pwlFrom(pts, 5)).toEqual([{ t: 0, v: 0 }]);
  });
});
