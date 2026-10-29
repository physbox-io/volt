import { describe, it, expect, beforeAll } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { Simulation } from 'eecircuit-engine';
import {
  applyParameterValue,
  buildSweepableTargets,
  buildTransientTrace,
  defaultSweepConfig,
  formatSpiceToken,
  formatSweepValue,
  generateSweepValues,
  parseSweepValuesList,
} from '../src/utils/parameterSweep';
import { generateSpiceNetlist } from '../src/utils/spice';
import { buildBodeTrace, cornerFrequencyHz, readOperatingPoint } from '../src/utils/analysisResults';
import type { SpiceComplexResult, SpiceResult } from '../src/types/simulation';

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

describe('parameterSweep utilities', () => {
  it('identifies sweepable targets across passive, active, and source components', () => {
    const nodes: Node[] = [
      node('r1', 'resistor', { resistance: 2200, label: '2.2k' }),
      node('c1', 'capacitor', { capacitance: 1e-7, label: '100n' }),
      node('pot1', 'potentiometer', { label: '10k', position: 0.25 }),
      node('v1', 'voltage', { voltage: 9 }),
      node('z1', 'zener', { label: '5.1V' }),
      node('gnd', 'ground'),
    ];
    const targets = buildSweepableTargets(nodes, id => id.toUpperCase());

    expect(targets.map(t => `${t.nodeId}:${t.param}`)).toEqual([
      'c1:capacitance',
      'r1:resistance',
      'pot1:position',
      'pot1:resistance',
      'v1:voltage',
      'z1:zenerVoltage',
    ]);

    const rTarget = targets.find(t => t.nodeId === 'r1')!;
    expect(rTarget.currentValue).toBe(2200);
    const cfg = defaultSweepConfig(rTarget);
    expect(cfg.scale).toBe('log');
    expect(cfg.start).toBeCloseTo(550, 5);
    expect(cfg.stop).toBeCloseTo(8800, 5);
  });

  it('generates linear and logarithmic step sequences cleanly', () => {
    const lin = generateSweepValues({ start: 1, stop: 5, steps: 5, scale: 'linear' });
    expect(lin).toEqual([1, 2, 3, 4, 5]);

    const log = generateSweepValues({ start: 100, stop: 10000, steps: 3, scale: 'log' });
    expect(log[0]).toBeCloseTo(100, 6);
    expect(log[1]).toBeCloseTo(1000, 6);
    expect(log[2]).toBeCloseTo(10000, 6);
  });

  it('parses engineering value lists with suffixes and units', () => {
    const parsed = parseSweepValuesList('1k, 2.2kΩ, 4.7k; 10k');
    expect(parsed).toEqual([1000, 2200, 4700, 10000]);
  });

  it('formats SI sweep values and SPICE tokens', () => {
    expect(formatSweepValue(1000, 'Ω')).toBe('1 kΩ');
    expect(formatSweepValue(2200, 'Ω')).toBe('2.2 kΩ');
    expect(formatSweepValue(1e-7, 'F')).toBe('100 nF');
    expect(formatSweepValue(50, '%')).toBe('50%');
    expect(formatSpiceToken(4700)).toBe('4.7k');
    expect(formatSpiceToken(1e-7)).toBe('100n');
  });

  it('applies stepped parameter values without mutating the original nodes', () => {
    const original: Node[] = [
      node('r1', 'resistor', { resistance: 1000, label: '1k' }),
      node('pot1', 'potentiometer', { label: '10k', position: 50 }),
      node('z1', 'zener', { label: '5.1V' }),
    ];
    const steppedR = applyParameterValue(original, 'r1', 'resistance', 4700);
    expect((original[0].data as { resistance: number }).resistance).toBe(1000);
    expect((steppedR[0].data as { resistance: number }).resistance).toBe(4700);

    // Potentiometer resistance is read from data.label by its netlist emitter
    const steppedPotR = applyParameterValue(original, 'pot1', 'resistance', 50000);
    const { netlist: potNetlist } = generateSpiceNetlist(
      [...steppedPotR, node('gnd', 'ground')],
      [],
      { simLength: 1, analysis: { kind: 'op' } },
    );
    expect(potNetlist).toContain('25000');

    // Zener breakdown voltage is read from data.label by its netlist emitter
    const steppedZener = applyParameterValue(original, 'z1', 'zenerVoltage', 9.1);
    const { netlist: zenerNetlist } = generateSpiceNetlist(
      [...steppedZener, node('gnd', 'ground')],
      [],
      { simLength: 1, analysis: { kind: 'op' } },
    );
    expect(zenerNetlist).toContain('BV=9.1');
  });
});

describe('end-to-end parameter sweep with ngspice', () => {
  let engine: Simulation | null = null;
  const getEngine = async () => {
    if (!engine) {
      engine = new Simulation();
      await engine.start();
    }
    return engine;
  };

  beforeAll(async () => {
    await getEngine();
  }, 60_000);

  it('steps R1 in a low-pass RC filter and shifts the -3dB corner frequency proportionally', async () => {
    const nodes: Node[] = [
      node('SG1', 'signalgen', { frequency: 1000, amplitude: 1, waveform: 'sine' }),
      node('R1', 'resistor', { resistance: 1000 }),
      node('C1', 'capacitor', { capacitance: 1e-7 }),
      node('OUT', 'netlabel', { net: 'OUT' }),
      node('GND1', 'ground'),
    ];
    const edges: Edge[] = [
      wire('SG1', 'out', 'R1', 'in'),
      wire('R1', 'out', 'OUT', 'in'),
      wire('OUT', 'in', 'C1', 'in'),
      wire('C1', 'out', 'GND1', 'in'),
      wire('SG1', 'gnd', 'GND1', 'in'),
    ];

    const sim = await getEngine();
    const corners: number[] = [];

    for (const rVal of [1000, 2000, 4000]) {
      const steppedNodes = applyParameterValue(nodes, 'R1', 'resistance', rVal);
      const { netlist, portToNet } = generateSpiceNetlist(steppedNodes, edges, {
        simLength: 1,
        analysis: { kind: 'ac', sourceNodeId: 'SG1', fStart: 10, fStop: 1e5, pointsPerDecade: 30 },
      });
      sim.setNetList(netlist);
      const raw = (await sim.runSim()) as SpiceComplexResult;
      const trace = buildBodeTrace(raw, portToNet['R1-out']);
      expect(trace).not.toBeNull();
      const fc = cornerFrequencyHz(trace);
      expect(fc).not.toBeNull();
      corners.push(fc!);
    }

    // Doubling R halves the cutoff frequency
    expect(corners[0] / corners[1]).toBeGreaterThan(1.9);
    expect(corners[0] / corners[1]).toBeLessThan(2.1);
    expect(corners[1] / corners[2]).toBeGreaterThan(1.9);
    expect(corners[1] / corners[2]).toBeLessThan(2.1);
  });

  it('steps R2 in a voltage divider across OP and transient analyses', async () => {
    const nodes: Node[] = [
      node('V1', 'voltage', { voltage: 12 }),
      node('R1', 'resistor', { resistance: 1000 }),
      node('R2', 'resistor', { resistance: 1000 }),
      node('GND1', 'ground'),
    ];
    const edges: Edge[] = [
      wire('V1', 'pos', 'R1', 'in'),
      wire('R1', 'out', 'R2', 'in'),
      wire('R2', 'out', 'GND1', 'in'),
      wire('V1', 'neg', 'GND1', 'in'),
    ];

    const sim = await getEngine();
    const expectedMid = [4, 6, 8]; // R2 = 500, 1000, 2000 against R1 = 1000 on 12V

    for (let i = 0; i < 3; i++) {
      const r2 = [500, 1000, 2000][i];
      const steppedNodes = applyParameterValue(nodes, 'R2', 'resistance', r2);

      // Operating point check
      const opNet = generateSpiceNetlist(steppedNodes, edges, {
        simLength: 0.01,
        analysis: { kind: 'op' },
      });
      sim.setNetList(opNet.netlist);
      const opRes = (await sim.runSim()) as SpiceResult;
      const midNet = opNet.portToNet['R1-out'];
      const volts = readOperatingPoint(opRes);
      expect(volts[midNet.toLowerCase()]).toBeCloseTo(expectedMid[i], 3);

      // Transient trace extraction check
      const tranNet = generateSpiceNetlist(steppedNodes, edges, {
        simLength: 0.01,
      });
      sim.setNetList(tranNet.netlist);
      const tranRes = (await sim.runSim()) as SpiceResult;
      const trace = buildTransientTrace(tranRes, tranNet.portToNet['R1-out']);
      expect(trace).not.toBeNull();
      expect(trace!.voltage.length).toBeGreaterThan(2);
      expect(trace!.voltage[trace!.voltage.length - 1]).toBeCloseTo(expectedMid[i], 2);
    }
  });
});

