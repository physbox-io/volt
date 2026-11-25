import { describe, it, expect, beforeAll } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { Simulation } from 'eecircuit-engine';
import { generateSpiceNetlist, type SpiceAnalysis } from '../src/utils/spice';
import { runSketches } from '../src/utils/mcu';
import { presets } from '../src/utils/presets';
import { EXPECTED_PLOT, cleanSpiceMessages, plotNameOf } from '../src/utils/simDiagnostics';
import { findNetGraph } from '../src/utils/netlistResult';
import { readOperatingPoint } from '../src/utils/analysisResults';
import type { SpiceResult } from '../src/types/simulation';

const node = (id: string, type: string, data: Record<string, unknown> = {}): Node => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data,
});

const wire = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});

let engine: Simulation;

beforeAll(async () => {
  engine = new Simulation();
  await engine.start();
}, 60_000);

async function solveCircuit(
  nodes: Node[],
  edges: Edge[],
  opts: { simLength?: number; analysis?: SpiceAnalysis; hilMaxStepMs?: number; initialConditions?: Record<string, number> } = {},
) {
  const fresh = structuredClone(nodes);
  const simLength = opts.simLength ?? 0.02;
  const { drives } = runSketches(fresh, simLength);
  const { netlist, portToNet } = generateSpiceNetlist(fresh, edges, {
    simLength,
    mcuDrives: drives,
    analysis: opts.analysis,
    hilMaxStepMs: opts.hilMaxStepMs,
    initialConditions: opts.initialConditions,
  });
  engine.setNetList(netlist);
  const result = (await engine.runSim()) as SpiceResult;
  const plot = plotNameOf(result.header);
  const messages = cleanSpiceMessages(engine.getError());
  return { result, portToNet, plot, messages, netlist };
}

describe('WASM regression: fuse convergence & blowing', () => {
  it('converges at t=0 without exp overflow and blows cleanly under overcurrent', async () => {
    // 10V across 1Ω -> 10A; I^2 = 100 A^2; i2t = 0.05 -> blows in ~0.5ms
    const nodes = [
      node('V1', 'voltage', { voltage: 10 }),
      node('F1', 'fuse', { rating: 1, i2t: 0.05 }),
      node('R1', 'resistor', { resistance: 1 }),
      node('G', 'ground'),
    ];
    const edges = [
      wire('V1', 'pos', 'F1', 'in'),
      wire('F1', 'out', 'R1', 'in'),
      wire('R1', 'out', 'G', 'in'),
      wire('V1', 'neg', 'G', 'in'),
    ];
    const { result, portToNet, plot, messages } = await solveCircuit(nodes, edges, { simLength: 0.01, hilMaxStepMs: 0.05 });
    expect(plot).toBe(EXPECTED_PLOT.tran);
    expect(messages).toEqual([]);

    const heat = findNetGraph(result, 'int_f1_h')!;
    expect(heat).not.toBeNull();
    expect(heat.voltage_levels.at(-1)!).toBeGreaterThanOrEqual(0.05);

    const loadV = findNetGraph(result, portToNet['R1-in'])!;
    expect(loadV).not.toBeNull();
    // After blowing, voltage across load drops near 0V
    expect(Math.abs(loadV.voltage_levels.at(-1)!)).toBeLessThan(0.1);
  });
});

describe('WASM regression: named MOSFET models', () => {
  for (const model of ['2n7000', 'irf540n']) {
    it(`compiles and solves ${model} cleanly in WASM (ON vs OFF)`, async () => {
      const makeCircuit = (vGate: number) => ({
        nodes: [
          node('VDD', 'voltage', { voltage: 12 }),
          node('VG', 'voltage', { voltage: vGate }),
          node('RD', 'resistor', { resistance: 100 }),
          node('M1', 'nmos', { model }),
          node('G', 'ground'),
        ],
        edges: [
          wire('VDD', 'pos', 'RD', 'in'),
          wire('RD', 'out', 'M1', 'd'),
          wire('M1', 's', 'G', 'in'),
          wire('VG', 'pos', 'M1', 'g'),
          wire('VG', 'neg', 'G', 'in'),
          wire('VDD', 'neg', 'G', 'in'),
        ],
      });

      const off = makeCircuit(0);
      const offRes = await solveCircuit(off.nodes, off.edges, { analysis: { kind: 'op' } });
      expect(offRes.plot).toBe(EXPECTED_PLOT.op);
      expect(offRes.messages).toEqual([]);
      const vDrainOff = readOperatingPoint(offRes.result)[offRes.portToNet['M1-d'].toLowerCase()];
      expect(vDrainOff).toBeCloseTo(12, 1);

      const on = makeCircuit(10);
      const onRes = await solveCircuit(on.nodes, on.edges, { analysis: { kind: 'op' } });
      expect(onRes.plot).toBe(EXPECTED_PLOT.op);
      expect(onRes.messages).toEqual([]);
      const vDrainOn = readOperatingPoint(onRes.result)[onRes.portToNet['M1-d'].toLowerCase()];
      expect(vDrainOn).toBeLessThan(2);
    });
  }
});

describe('WASM regression: timer555 astable & active-low RESET', () => {
  const astable555 = (resetToGround: boolean) => {
    const nodes = [
      node('V1', 'voltage', { voltage: 9 }),
      node('U1', 'timer555', {}),
      node('RA', 'resistor', { resistance: 1000 }),
      node('RB', 'resistor', { resistance: 10000 }),
      node('C1', 'capacitor', { capacitance: 1e-6 }),
      node('RL', 'resistor', { resistance: 10000 }),
      node('G', 'ground'),
    ];
    const edges = [
      wire('V1', 'pos', 'U1', '8'),
      wire('V1', 'pos', 'RA', 'in'),
      wire('RA', 'out', 'U1', '7'),
      wire('U1', '7', 'RB', 'in'),
      wire('RB', 'out', 'U1', '6'),
      wire('U1', '6', 'U1', '2'),
      wire('U1', '2', 'C1', 'in'),
      wire('C1', 'out', 'G', 'in'),
      wire('U1', '3', 'RL', 'in'),
      wire('RL', 'out', 'G', 'in'),
      wire('U1', '1', 'G', 'in'),
      wire('V1', 'neg', 'G', 'in'),
      resetToGround ? wire('U1', '4', 'G', 'in') : wire('V1', 'pos', 'U1', '4'),
    ];
    return { nodes, edges };
  };

  it('oscillates when RESET (pin 4) is tied to VCC', async () => {
    const { nodes, edges } = astable555(false);
    // Period ≈ 0.693 * (1k + 2*10k) * 1uF ≈ 14.5ms; run 60ms
    const { result, portToNet, plot, messages } = await solveCircuit(nodes, edges, { simLength: 0.06, hilMaxStepMs: 0.1 });
    expect(plot).toBe(EXPECTED_PLOT.tran);
    const fatal = messages.filter(m => /error|fatal|not parsed|singular|abort|no convergence|timestep too small/i.test(m));
    expect(fatal).toEqual([]);
    const out = findNetGraph(result, portToNet['U1-3'])!;
    expect(out).not.toBeNull();
    const minV = Math.min(...out.voltage_levels);
    const maxV = Math.max(...out.voltage_levels);
    expect(minV).toBeLessThan(1);
    expect(maxV).toBeGreaterThan(8);
  });

  it('holds output low when RESET (pin 4) is pulled to GND', async () => {
    const { nodes, edges } = astable555(true);
    const { result, portToNet, plot, messages } = await solveCircuit(nodes, edges, { simLength: 0.03, hilMaxStepMs: 0.1 });
    expect(plot).toBe(EXPECTED_PLOT.tran);
    const fatal = messages.filter(m => /error|fatal|not parsed|singular|abort|no convergence|timestep too small/i.test(m));
    expect(fatal).toEqual([]);
    const out = findNetGraph(result, portToNet['U1-3'])!;
    expect(out).not.toBeNull();
    // After initial startup settling, output stays low (< 0.5V)
    const tail = out.voltage_levels.slice(Math.floor(out.voltage_levels.length / 2));
    expect(Math.max(...tail)).toBeLessThan(0.5);
  });
});

describe('WASM regression: transformer driven by acvoltage', () => {
  it('solves cleanly without singular matrix and steps down 2:1', async () => {
    const nodes = [
      node('AC1', 'acvoltage', { amplitude: 10, frequency: 60 }),
      node('T1', 'transformer', { l_pri: '100m', l_sec: '25m', k: 0.99 }),
      node('RL', 'resistor', { resistance: 1000 }),
      node('G', 'ground'),
    ];
    const edges = [
      wire('AC1', 'pos', 'T1', 'p1'),
      wire('T1', 'p2', 'G', 'in'),
      wire('AC1', 'neg', 'G', 'in'),
      wire('T1', 's1', 'RL', 'in'),
      wire('RL', 'out', 'T1', 's2'),
      wire('T1', 's2', 'G', 'in'),
    ];
    const { result, portToNet, plot, messages } = await solveCircuit(nodes, edges, { simLength: 0.04, hilMaxStepMs: 0.1 });
    expect(plot).toBe(EXPECTED_PLOT.tran);
    expect(messages).toEqual([]);
    const sec = findNetGraph(result, portToNet['T1-s1'])!;
    expect(sec).not.toBeNull();
    const peak = Math.max(...sec.voltage_levels.map(Math.abs));
    // sqrt(25m / 100m) = 0.5 -> ~5V peak
    expect(peak).toBeGreaterThan(4.2);
    expect(peak).toBeLessThan(5.5);
  });
});

describe('WASM regression: Volt-emitted logicGates and dff', () => {
  it('solves AND and NOT gates via generateSpiceNetlist with valid logic levels', async () => {
    const nodes = [
      node('VA', 'voltage', { voltage: 5 }),
      node('VB', 'voltage', { voltage: 5 }),
      node('G_AND', 'and', {}),
      node('G_NOT', 'not', {}),
      node('RL', 'resistor', { resistance: 10000 }),
      node('G', 'ground'),
    ];
    const edges = [
      wire('VA', 'pos', 'G_AND', 'in1'),
      wire('VB', 'pos', 'G_AND', 'in2'),
      wire('G_AND', 'out', 'G_NOT', 'in1'),
      wire('G_NOT', 'out', 'RL', 'in'),
      wire('RL', 'out', 'G', 'in'),
      wire('VA', 'neg', 'G', 'in'),
      wire('VB', 'neg', 'G', 'in'),
    ];
    const { result, portToNet, plot, messages } = await solveCircuit(nodes, edges, { analysis: { kind: 'op' } });
    expect(plot).toBe(EXPECTED_PLOT.op);
    expect(messages).toEqual([]);
    const op = readOperatingPoint(result);
    expect(op[portToNet['G_AND-out'].toLowerCase()]).toBeGreaterThan(4.5);
    expect(op[portToNet['G_NOT-out'].toLowerCase()]).toBeLessThan(0.5);
  });

  it('solves DFF latching D=HIGH on a rising clock edge', async () => {
    const nodes = [
      node('VD', 'voltage', { voltage: 5 }),
      node('VCLK', 'signalgen', { waveform: 'square', frequency: 500, amplitude: 5, dutyCycle: 50 }),
      node('FF1', 'dff', {}),
      node('RQ', 'resistor', { resistance: 10000 }),
      node('RQB', 'resistor', { resistance: 10000 }),
      node('G', 'ground'),
    ];
    const edges = [
      wire('VD', 'pos', 'FF1', 'd'),
      wire('VCLK', 'out', 'FF1', 'clk'),
      wire('FF1', 'q', 'RQ', 'in'),
      wire('RQ', 'out', 'G', 'in'),
      wire('FF1', 'qbar', 'RQB', 'in'),
      wire('RQB', 'out', 'G', 'in'),
      wire('VD', 'neg', 'G', 'in'),
      wire('VCLK', 'gnd', 'G', 'in'),
    ];
    const { result, portToNet, plot, messages } = await solveCircuit(nodes, edges, { simLength: 0.005, hilMaxStepMs: 0.02 });
    expect(plot).toBe(EXPECTED_PLOT.tran);
    expect(messages).toEqual([]);
    const q = findNetGraph(result, portToNet['FF1-q'])!;
    const qbar = findNetGraph(result, portToNet['FF1-qbar'])!;
    expect(q.voltage_levels.at(-1)!).toBeGreaterThan(4.5);
    expect(qbar.voltage_levels.at(-1)!).toBeLessThan(0.5);
  });
});

describe('WASM regression: currentMirror preset', () => {
  it('solves with positive mirrored current (~5mA)', async () => {
    const preset = presets.currentMirror;
    const { result, portToNet, plot, messages } = await solveCircuit(preset.nodes, preset.edges, { analysis: { kind: 'op' } });
    expect(plot).toBe(EXPECTED_PLOT.op);
    expect(messages).toEqual([]);
    const op = readOperatingPoint(result);
    // Rload is 1k between v1.pos (12V) and mm2.pos; I_mirror = (V(rload-in) - V(rload-out)) / 1000
    const vTop = op[portToNet['rload-in'].toLowerCase()];
    const vBot = op[portToNet['rload-out'].toLowerCase()];
    const iMirrorMa = ((vTop - vBot) / 1000) * 1000;
    expect(iMirrorMa).toBeGreaterThan(4.5);
    expect(iMirrorMa).toBeLessThan(6.0);
  });
});

describe('WASM regression: built-in preset smoke check', () => {
  const skipPresets = new Set(['empty']);
  const entries = Object.entries(presets).filter(([k]) => !skipPresets.has(k));

  for (const [key, preset] of entries) {
    it(`preset "${key}" compiles and solves cleanly in ngspice`, async () => {
      const simLength = Math.min(preset.recommendedSimLength ?? 0.02, 0.01);
      const { result, plot, messages } = await solveCircuit(preset.nodes, preset.edges, { simLength });
      expect(plot, `${key} plot`).toBe(EXPECTED_PLOT.tran);
      expect(result.variableNames.length, `${key} vars`).toBeGreaterThan(1);
      const fatal = messages.filter(m => /error|fatal|not parsed|singular|abort|no convergence|timestep too small/i.test(m));
      expect(fatal, `${key} errors: ${fatal.join(' | ')}`).toEqual([]);
    });
  }
});
