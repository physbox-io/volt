import { describe, it, expect, beforeAll } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { Simulation } from 'eecircuit-engine';
import { encodePinEdges, chooseMaxStepMs, type Hold } from '../src/hil/pinEncoding';
import { buildSliceCommand, mergeSlices, polledPins, backgroundPollCode, boardUrl, connectedHeltecPins } from '../src/hil/heltecLink';
import { runSlice, initialSliceState, type SliceState } from '../src/sim/sliceRunner';
import { HILMemoizer } from '../src/utils/hilMemoizer';
import { hashDrives } from '../src/utils/mcu';
import { TraceHistory } from '../src/sim/traceHistory';
import { findNetGraph } from '../src/utils/netlistResult';
import type { SpiceResult } from '../src/types/simulation';

/**
 * The HIL pieces taken out of the app: what a slice's waveform becomes on the
 * wire, how slices are batched, and the slice step itself against the real
 * engine.
 */

const node = (id: string, type: string, data: Record<string, unknown> = {}): Node => ({
  id, type, position: { x: 0, y: 0 }, data,
});
const wire = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`,
  source, sourceHandle, target, targetHandle,
});

/** A square wave sampled every `stepMs`, `phaseMs` in. */
function square(freqHz: number, sliceMs: number, stepMs: number, phaseMs = 0) {
  const timestamps_ms: number[] = [];
  const voltage_levels: number[] = [];
  for (let t = 0; t <= sliceMs + 1e-9; t += stepMs) {
    timestamps_ms.push(t);
    const phase = (((t + phaseMs) * freqHz) / 1000) % 1;
    voltage_levels.push(phase < 0.5 ? 3.3 : 0);
  }
  return { timestamps_ms, voltage_levels };
}

const total = (seq: Hold[]) => seq.reduce((s, [, us]) => s + us, 0);

describe('a digital_out pin over one slice', () => {
  const freqs = [5, 13, 25, 60, 100, 240];
  const steps = [0.05, 0.2, 1];
  for (const f of freqs) for (const step of steps) for (const phase of [0, 1.7, 7.3]) {
    it(`${f}Hz sampled every ${step}ms, ${phase}ms in`, () => {
      const sliceMs = 40;
      const { seq, shortestPulseUs } = encodePinEdges(square(f, sliceMs, step, phase), sliceMs, step);
      // The holds fill the slice, give or take a microsecond of rounding each.
      expect(Math.abs(total(seq) - sliceMs * 1000)).toBeLessThanOrEqual(seq.length);
      // Levels alternate, every hold is 0 or 1.
      for (let i = 1; i < seq.length; i++) expect(seq[i][0]).not.toBe(seq[i - 1][0]);
      for (const [level] of seq) expect([0, 1]).toContain(level);
      // One edge per half-period crossed, to within the two at the ends.
      const halfMs = 500 / f;
      const expectedEdges = sliceMs / halfMs;
      expect(Math.abs(seq.length - 1 - expectedEdges)).toBeLessThanOrEqual(2);
      // Every interior hold is a half-period, to within a step.
      for (let i = 1; i < seq.length - 1; i++) expect(Math.abs(seq[i][1] / 1000 - halfMs)).toBeLessThanOrEqual(step + 1e-6);
      if (seq.length > 1) expect(shortestPulseUs).not.toBeNull();
    });
  }

  it('drops a glitch shorter than one and a half steps', () => {
    const trace = { timestamps_ms: [0, 1, 2, 3, 4], voltage_levels: [0, 3.3, 0, 0, 0] };
    expect(encodePinEdges(trace, 4, 1).seq).toEqual([[0, 4000]]);
  });

  it('holds a pin with no trace low for the whole slice', () => {
    expect(encodePinEdges(null, 40, 1)).toEqual({ seq: [[0, 40000]], shortestPulseUs: null });
  });

  it('steps at a tenth of the fastest half-period, between the budget floor and 1ms', () => {
    expect(chooseMaxStepMs({}, 40, false)).toBe(1);
    expect(chooseMaxStepMs({ GPIO_3: 2 }, 40, false)).toBeCloseTo(0.2);
    expect(chooseMaxStepMs({ GPIO_3: 0.001 }, 40, false)).toBeCloseTo(40 / 2000);
    expect(chooseMaxStepMs({}, 40, true)).toBe(0.1);
  });
});

describe('the commands sent to the board', () => {
  const pins = { GPIO_1: 'analog_in', GPIO_3: 'digital_out', GPIO_33: 'digital_in', GPIO_36: 'digital_out' };

  it('writes and reads only wired pins', () => {
    const cmd = buildSliceCommand(pins, { GPIO_3: [[1, 100]], GPIO_36: [[0, 5]] }, new Set(['GPIO_1', 'GPIO_3', 'GPIO_33']));
    expect(cmd).toEqual({
      writes: [{ pin: 3, seq: [[1, 100]] }],
      reads: [{ pin: 1, type: 'analog' }, { pin: 33, type: 'digital' }],
    });
  });

  it('merges queued slices per pin, in order, up to the batch target', () => {
    const slices = [10, 20, 30, 40, 50].map(k => ({
      writes: [{ pin: 3, seq: [[k % 20 ? 1 : 0, k] as Hold] }, { pin: 36, seq: [[0, k] as Hold] }],
      reads: [{ pin: 1, type: 'analog' as const }],
      durationMs: 40,
    }));
    const { command, durationMs, taken } = mergeSlices(slices, 120);
    expect(taken).toBe(3);
    expect(durationMs).toBe(120);
    expect(command.writes.map(w => w.pin)).toEqual([3, 36]);
    expect(command.writes[0].seq.map(([, us]) => us)).toEqual([10, 20, 30]);
    expect(mergeSlices(slices, 1000).taken).toBe(5);
    expect(mergeSlices([], 120).taken).toBe(0);
  });

  it('polls the wired inputs in the order it reads their answers', () => {
    const connected = connectedHeltecPins('h', [wire('h', 'GPIO_33', 'x', 'in'), wire('y', 'out', 'h', 'GPIO_1'), wire('h', 'GPIO_3', 'z', 'in')]);
    expect(polledPins(pins, connected)).toEqual(['GPIO_1', 'GPIO_33']);
    expect(backgroundPollCode(pins, connected))
      .toBe("print('HIL_BG_DATA:', str(h.adc_read(1) / 4095 * 3.3) + ',' + str(h.gpio_read(33)))\n");
    expect(backgroundPollCode(pins, new Set())).toBe("print('HIL_BG_DATA:', 'ok')\n");
  });

  it('refuses plain ws:// to a remote board from an https page', () => {
    expect(boardUrl('192.168.1.5', true)).toBeNull();
    expect(boardUrl('192.168.1.5', false)).toBe('ws://192.168.1.5');
    expect(boardUrl('localhost:8080', true)).toBe('ws://localhost:8080');
    expect(boardUrl('wss://board.example', true)).toBe('wss://board.example');
  });
});

describe('one HIL slice, against the engine', () => {
  let engine: Simulation;
  let solves = 0;
  const solve = async (netlist: string) => {
    solves++;
    engine.setNetList(netlist);
    return (await engine.runSim()) as SpiceResult;
  };
  beforeAll(async () => {
    engine = new Simulation();
    await engine.start();
  });

  /** A square wave into GPIO_3; GPIO_1 read into a 10k load; an RL (τ = 20ms) off a 5V rail. */
  const circuit = (freqHz: number) => ({
    nodes: [
      node('H', 'heltec_v4', { pins: { GPIO_1: 'analog_in', GPIO_3: 'digital_out' } }),
      node('SG', 'signalgen', { waveform: 'square', frequency: freqHz, amplitude: 3.3 }),
      node('RIN', 'resistor', { resistance: 10000 }),
      node('V1', 'voltage', { voltage: 5 }), node('R1', 'resistor', { resistance: 50 }),
      node('L1', 'inductor', { inductance: 1 }), node('GND', 'ground'),
    ],
    edges: [
      wire('SG', 'out', 'H', 'GPIO_3'), wire('SG', 'gnd', 'GND', 'in'),
      wire('H', 'GPIO_1', 'RIN', 'in'), wire('RIN', 'out', 'GND', 'in'),
      wire('V1', 'pos', 'R1', 'in'), wire('R1', 'out', 'L1', 'in'), wire('L1', 'out', 'GND', 'in'), wire('V1', 'neg', 'GND', 'in'),
    ],
  });

  for (const f of [10, 37, 125]) {
    it(`plays a ${f}Hz square on the pin and carries the coil from slice to slice`, async () => {
      const { nodes, edges } = circuit(f);
      const memoizer = new HILMemoizer({ enabled: false });
      // From rest: the coil at 0A, rather than the operating point it settles to.
      let state: SliceState = { ...initialSliceState(), sim: { 'i(l_l1)': 0 } };
      let edgesSeen = 0;
      const sliceMs = 40;
      const n = 6;
      let lastCurrent = 0;
      for (let k = 0; k < n; k++) {
        const slice = await runSlice(state, { nodes, edges, boardId: 'H', inputs: { GPIO_1: 1.234 }, sliceMs }, { solve, memoizer });
        const seq = slice.outputs.GPIO_3;
        expect(Math.abs(total(seq) - sliceMs * 1000)).toBeLessThanOrEqual(seq.length);
        edgesSeen += seq.length - 1;
        // The board's reading is the voltage on its input net.
        const input = findNetGraph(slice.result, slice.portToNet['H-GPIO_1'])!;
        expect(input.voltage_levels.at(-1)).toBeCloseTo(1.234, 3);
        // The coil current keeps rising toward 5V/50Ω across slices, never restarting at 0.
        const current = slice.state.sim['i(l_l1)'];
        expect(current).toBeGreaterThan(lastCurrent);
        lastCurrent = current;
        state = slice.state;
      }
      // The coil's current after n slices is the one-shot RL step: I = V/R (1 - e^(-t/τ)).
      expect(lastCurrent).toBeCloseTo(0.1 * (1 - Math.exp(-(n * sliceMs) / 20)), 3);
      expect(Math.abs(edgesSeen - (2 * f * n * sliceMs) / 1000)).toBeLessThanOrEqual(n * 2);
      expect(state.halfPeriods.GPIO_3).toBeGreaterThan(0);
    });
  }

  it('hands back the cached slice for a slice it has seen, without solving', async () => {
    const { nodes, edges } = circuit(25);
    const memoizer = new HILMemoizer();
    const input = { nodes, edges, boardId: 'H', inputs: { GPIO_1: 2 }, sliceMs: 40 };
    const first = await runSlice(initialSliceState(), input, { solve, memoizer });
    const before = solves;
    const again = await runSlice(initialSliceState(), input, { solve, memoizer });
    expect(solves).toBe(before);
    expect(again.outputs).toEqual(first.outputs);
    expect(again.state).toEqual(first.state);
  });
});

describe('the drive fingerprint in the HIL cache key', () => {
  const drive = (v: number, t = 0.5) => ({
    U1: { pinModes: { D0: 'OUTPUT' as const, D1: 'INPUT' as const }, pwlOutputs: { D0: [{ t: 0, v: 0 }, { t, v }] } },
  });

  it('is the same for the same drive, written in any key order', () => {
    const a = drive(5);
    const b = { U1: { pwlOutputs: { D0: [{ t: 0, v: 0 }, { t: 0.5, v: 5 }] }, pinModes: { D1: 'INPUT' as const, D0: 'OUTPUT' as const } } };
    expect(hashDrives(a)).toBe(hashDrives(b));
  });

  it('changes with any time, voltage, mode, pin or part', () => {
    const base = hashDrives(drive(5));
    const variants = [
      drive(5.000001), drive(5, 0.5000001), drive(0),
      { U1: { ...drive(5).U1, pinModes: { D0: 'INPUT' as const, D1: 'INPUT' as const } } },
      { U1: { ...drive(5).U1, pwlOutputs: { D2: drive(5).U1.pwlOutputs.D0 } } },
      { U2: drive(5).U1 },
      { ...drive(5), U2: drive(5).U1 },
    ];
    const seen = new Set([base]);
    for (const v of variants) seen.add(hashDrives(v));
    expect(seen.size).toBe(variants.length + 1);
  });
});

describe('the trace history of a sliced run', () => {
  /** A scope on net N1 and an LED, as a fake result whose samples are their absolute times. */
  const nodes = [
    { id: 'S', type: 'scope', position: { x: 0, y: 0 }, data: {} },
    { id: 'L', type: 'led', position: { x: 0, y: 0 }, data: {} },
  ] as Node[];
  const portToNet = { 'S-ch1': 'n1', 'S-gnd': '0', 'L-anode': 'n2' };
  const fake = (startMs: number, sliceMs: number, samples: number): SpiceResult => {
    const t = Array.from({ length: samples }, (_, i) => (i * sliceMs) / (samples - 1) / 1000);
    return {
      variableNames: ['time', 'v(n1)', 'v(n2)', 'v(int_led_l)'],
      data: [{ values: t }, { values: t.map(x => startMs + x * 1000) }, { values: t.map(() => 3) }, { values: t.map(() => 1) }],
    } as unknown as SpiceResult;
  };

  it('holds exactly the last window, whatever the slice size', () => {
    for (const [sliceMs, samples] of [[40, 400], [5, 50], [7.3, 11]] as const) {
      const history = new TraceHistory(1000);
      let start = 0;
      for (let k = 0; k < 600; k++) {
        history.append(nodes, fake(start, sliceMs, samples), portToNet, sliceMs);
        start += sliceMs;
      }
      const [scope, led] = history.applyTo(nodes);
      const pts = scope.data.voltageData1 as { t: number; v: number }[];
      // Each point's voltage is its absolute time; shown relative to the window's start.
      expect(pts.every(p => p.t >= 0 && p.t <= 1000 + 1e-9)).toBe(true);
      expect(pts.every(p => Math.abs(p.v - (p.t + start - 1000)) < 1e-6)).toBe(true);
      expect(pts[pts.length - 1].t).toBeCloseTo(1000, 6);
      expect(pts[0].t).toBeLessThan(sliceMs);
      expect((led.data.current_array as number[]).every(v => v === 2)).toBe(true);
    }
  });
});
