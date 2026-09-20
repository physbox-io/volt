import { describe, it, expect, beforeAll } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { Simulation } from 'eecircuit-engine';
import { generateSpiceNetlist, type SpiceAnalysis } from '../src/utils/spice';
import { buildBodeTrace, cornerFrequencyHz, readOperatingPoint } from '../src/utils/analysisResults';
import { EXPECTED_PLOT, cleanSpiceMessages, plotNameOf } from '../src/utils/simDiagnostics';
import type { SpiceComplexResult, SpiceResult } from '../src/types/simulation';

/**
 * The netlists this app writes, put through the solver this app ships.
 *
 * The unit tests say the right cards come out; this says ngspice agrees, which
 * is the part that cannot be argued from the source. Kept to two small
 * circuits with answers that can be worked out by hand, so a failure here is a
 * statement about the netlist and not about the fixture.
 */

const node = (id: string, type: string, data: Record<string, unknown> = {}): Node => ({
  id, type, position: { x: 0, y: 0 }, data,
});
const wire = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`,
  source, sourceHandle, target, targetHandle,
});

// The engine is a WASM module and takes a moment to come up, so it is started
// once inside a test rather than at describe level — a describe body runs
// during collection, even for a run filtered down to something else.
let engine: Simulation | null = null;
const getEngine = async () => {
  if (!engine) {
    engine = new Simulation();
    await engine.start();
  }
  return engine;
};

const solve = async <T>(nodes: Node[], edges: Edge[], analysis: SpiceAnalysis) => {
  const { netlist, portToNet } = generateSpiceNetlist(
    nodes, edges, 1, 'normal', {}, undefined, undefined, analysis, { skipMcuExecution: true },
  );
  const sim = await getEngine();
  sim.setNetList(netlist);
  const result = await sim.runSim();
  return {
    result: result as T,
    portToNet,
    plot: plotNameOf(result.header),
    messages: cleanSpiceMessages(sim.getError()),
  };
};

/** 9V across 1k and 2k: the midpoint sits at 6V. */
const divider = () => ({
  nodes: [
    node('V1', 'voltage', { voltage: 9 }),
    node('R1', 'resistor', { resistance: 1000 }),
    node('R2', 'resistor', { resistance: 2000 }),
    node('GND1', 'ground'),
    node('MID', 'netlabel', { net: 'MID' }),
  ],
  edges: [
    wire('V1', 'pos', 'R1', 'in'),
    wire('R1', 'out', 'MID', 'in'),
    wire('MID', 'in', 'R2', 'in'),
    wire('R2', 'out', 'GND1', 'in'),
    wire('V1', 'neg', 'GND1', 'in'),
  ],
});

/** 1k into 100n off a signal generator: corner at 1/(2*pi*RC). */
const lowPass = () => ({
  nodes: [
    node('SG1', 'signalgen', { frequency: 1000, amplitude: 1, waveform: 'sine' }),
    node('R1', 'resistor', { resistance: 1000 }),
    node('C1', 'capacitor', { capacitance: 1e-7 }),
    node('OUT', 'netlabel', { net: 'OUT' }),
    node('GND1', 'ground'),
  ],
  edges: [
    wire('SG1', 'out', 'R1', 'in'),
    wire('R1', 'out', 'OUT', 'in'),
    wire('OUT', 'in', 'C1', 'in'),
    wire('C1', 'out', 'GND1', 'in'),
    wire('SG1', 'gnd', 'GND1', 'in'),
  ],
});

beforeAll(async () => {
  await getEngine();
}, 60_000);

describe('the operating point, solved', () => {
  it('puts the midpoint of a 1k/2k divider at 6V', async () => {
    const { nodes, edges } = divider();
    const { result, portToNet, plot, messages } = await solve<SpiceResult>(nodes, edges, { kind: 'op' });
    expect(plot).toBe(EXPECTED_PLOT.op);
    expect(messages).toEqual([]);

    // Resolved through the port map, which is how the overlay finds it: a net
    // label names the net on the drawing, and SPICE numbers it.
    const volts = readOperatingPoint(result);
    const mid = portToNet['R1-out'];
    expect(volts[mid.toLowerCase()]).toBeCloseTo(6, 4);
    // Ground is not in the plot, and nothing should have invented it.
    expect(volts['0']).toBeUndefined();
    expect(portToNet['R2-out']).toBe('0');
  });
});

describe('the frequency sweep, solved', () => {
  it('finds the corner a 1k/100n filter was designed to', async () => {
    const { nodes, edges } = lowPass();
    const { result, portToNet, plot, messages } = await solve<SpiceComplexResult>(nodes, edges, {
      kind: 'ac', sourceNodeId: 'SG1', fStart: 10, fStop: 1e6, pointsPerDecade: 40,
    });
    expect(plot).toBe(EXPECTED_PLOT.ac);
    expect(messages).toEqual([]);
    expect(result.dataType).toBe('complex');

    const trace = buildBodeTrace(result, portToNet['R1-out']);
    expect(trace).not.toBeNull();
    // Flat and in phase at the bottom of the sweep.
    expect(trace!.magDb[0]).toBeCloseTo(0, 1);

    const corner = cornerFrequencyHz(trace)!;
    const expected = 1 / (2 * Math.PI * 1000 * 1e-7);
    expect(corner / expected).toBeGreaterThan(0.95);
    expect(corner / expected).toBeLessThan(1.05);
  });

  it('measures nothing when the drive is put on a source that is not in the loop', async () => {
    // Every other source keeps its own card and so contributes nothing. This is
    // what lets the sweep be taken without editing the circuit — and it has to
    // be true, or a sweep would read the wrong stimulus and look plausible.
    const { nodes, edges } = lowPass();
    const withSpare = [...nodes, node('V9', 'voltage', { voltage: 5 })];
    const { result, portToNet } = await solve<SpiceComplexResult>(withSpare, edges, {
      kind: 'ac', sourceNodeId: 'V9', fStart: 10, fStop: 1e4, pointsPerDecade: 10,
    });
    const trace = buildBodeTrace(result, portToNet['R1-out'])!;
    for (const db of trace.magDb) expect(db).toBeLessThan(-100);
  });
});

describe('a circuit the solver refuses', () => {
  it('comes back as a plot that is not the one that was asked for', async () => {
    // The failure this whole path exists for: ngspice does not reject, it
    // resolves with the `constants` plot and puts the reason on stderr.
    const sim = await getEngine();
    sim.setNetList('Bad\nV1 in 0 DC 5\nQ1 in in 0 NOSUCHMODEL\n.save all\n.tran 1m 10m\n.end\n');
    const result = await sim.runSim();
    expect(plotNameOf(result.header)).not.toBe(EXPECTED_PLOT.tran);
    expect(cleanSpiceMessages(sim.getError()).join(' ')).toMatch(/not parsed|modelname/i);
  });

  it('does not leave the previous run’s data behind for the next one to read', async () => {
    const { nodes, edges } = divider();
    const good = await solve<SpiceResult>(nodes, edges, { kind: 'op' });
    expect(good.plot).toBe(EXPECTED_PLOT.op);
    expect(readOperatingPoint(good.result)[good.portToNet['R1-out'].toLowerCase()]).toBeCloseTo(6, 4);
  });
});
