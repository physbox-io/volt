import { describe, it, expect, beforeAll } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { Simulation } from 'eecircuit-engine';
import { generateSpiceNetlist, type SpiceAnalysis } from '../src/utils/spice';
import { presets } from '../src/utils/presets';
import { runErc } from '../src/utils/erc';
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


/*
 * The preset that ships to demonstrate the sweep.
 *
 * Its values are a design, not a decoration: 10k with 22n and 10n is a corner
 * at 1/(2*pi*R*sqrt(C1*C2)) and a Q of sqrt(C1/C2)/2. If an edit to the netlist
 * builder, the op-amp model or the sweep ever moves either, the note card on
 * that preset starts telling people a number the app no longer produces.
 */
describe('the Sallen-Key preset', () => {
  const preset = presets.sallenKeyFilter;

  it('is wired up completely, with nothing for the rules check to say', () => {
    const { portToNet, pins } = generateSpiceNetlist(
      preset.nodes, preset.edges, 1, 'normal', {}, undefined, undefined,
      { kind: 'op' }, { skipMcuExecution: true },
    );
    const found = runErc({ nodes: preset.nodes, pins, portToNet, nameOf: id => id });
    expect(found.map(a => a.title)).toEqual([]);
  });

  it('sweeps to the corner its component values were chosen for', async () => {
    const R = 10e3, C1 = 22e-9, C2 = 10e-9;
    const designed = 1 / (2 * Math.PI * R * Math.sqrt(C1 * C2));
    expect(designed).toBeGreaterThan(1000);
    expect(designed).toBeLessThan(1150);

    const { result, portToNet, plot } = await solve<SpiceComplexResult>(preset.nodes, preset.edges, {
      kind: 'ac', sourceNodeId: 'sg1', fStart: 10, fStop: 1e6, pointsPerDecade: 40,
    });
    expect(plot).toBe(EXPECTED_PLOT.ac);

    const trace = buildBodeTrace(result, portToNet['u1-out'])!;
    expect(trace).not.toBeNull();

    // Unity gain in the passband: a follower, so 0dB and no phase shift.
    expect(trace.magDb[0]).toBeCloseTo(0, 1);
    expect(Math.abs(trace.phaseDeg[0])).toBeLessThan(2);

    const corner = cornerFrequencyHz(trace)!;
    expect(corner / designed).toBeGreaterThan(0.9);
    expect(corner / designed).toBeLessThan(1.1);

    const at = (f: number) => {
      let best = 0;
      for (let i = 0; i < trace.freqHz.length; i++) {
        if (Math.abs(Math.log10(trace.freqHz[i] / f)) < Math.abs(Math.log10(trace.freqHz[best] / f))) best = i;
      }
      return best;
    };
    // Two poles, so forty dB per decade rather than twenty.
    const drop = trace.magDb[at(1e4)] - trace.magDb[at(1e5)];
    expect(drop).toBeGreaterThan(35);
    expect(drop).toBeLessThan(45);

    // And the phase runs to -180, which is the half of the plot a transient
    // trace cannot show and the reason the unwrapping has to be right.
    expect(Math.min(...trace.phaseDeg)).toBeLessThan(-170);
    expect(Math.min(...trace.phaseDeg)).toBeGreaterThan(-190);
  });
});
