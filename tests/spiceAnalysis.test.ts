import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { generateSpiceNetlist } from '../src/utils/spice';

const node = (id: string, type: string, data: Record<string, unknown> = {}): Node => ({
  id, type, position: { x: 0, y: 0 }, data,
});
const wire = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`,
  source, sourceHandle, target, targetHandle,
});

const filter = () => ({
  nodes: [
    node('SG1', 'signalgen', { frequency: 1000, amplitude: 1, waveform: 'sine' }),
    node('V1', 'voltage', { voltage: 5 }),
    node('R1', 'resistor', { resistance: 1000 }),
    node('C1', 'capacitor', { capacitance: 1e-7 }),
    node('GND1', 'ground'),
  ],
  edges: [
    wire('SG1', 'out', 'R1', 'in'),
    wire('R1', 'out', 'C1', 'in'),
    wire('C1', 'out', 'GND1', 'in'),
    wire('SG1', 'gnd', 'GND1', 'in'),
    wire('V1', 'neg', 'GND1', 'in'),
  ],
});

const build = (
  analysis: Parameters<typeof generateSpiceNetlist>[7],
  options?: Parameters<typeof generateSpiceNetlist>[8],
) => {
  const { nodes, edges } = filter();
  return generateSpiceNetlist(nodes, edges, 1, 'normal', {}, { n1: 1.5 }, undefined, analysis, options);
};

describe('the transient netlist is unchanged', () => {
  it('still ends in .tran, and carries the initial conditions', () => {
    const { netlist } = build();
    expect(netlist).toMatch(/^\.tran /m);
    expect(netlist).toMatch(/^\.ic /m);
    expect(netlist).not.toContain(' AC 1');
    expect(netlist.trimEnd().endsWith('.end')).toBe(true);
  });

  it('is byte-for-byte what it was before an analysis was named', () => {
    const { nodes, edges } = filter();
    const withDefault = generateSpiceNetlist(nodes, edges, 1, 'normal');
    const explicit = generateSpiceNetlist(nodes, edges, 1, 'normal', {}, undefined, undefined, { kind: 'tran' });
    expect(explicit.netlist).toBe(withDefault.netlist);
  });
});

describe('operating point', () => {
  it('ends in .op and leaves the transient-only cards out', () => {
    const { netlist } = build({ kind: 'op' });
    expect(netlist).toMatch(/^\.op$/m);
    expect(netlist).not.toMatch(/^\.tran /m);
    // `.ic` seeds a transient run's starting state and means nothing to a bias
    // point; handing ngspice one alongside `.op` only invites a disagreement.
    expect(netlist).not.toMatch(/^\.ic /m);
    expect(netlist).toContain('.save all');
    expect(netlist.trimEnd().endsWith('.end')).toBe(true);
  });

  it('still describes the same devices', () => {
    const tran = build().netlist;
    const op = build({ kind: 'op' }).netlist;
    for (const card of ['R_R1', 'C_C1', 'V_SG1', 'V_V1']) {
      expect(tran).toContain(card);
      expect(op).toContain(card);
    }
  });
});

describe('AC sweep', () => {
  const ac = (sourceNodeId: string) => build({
    kind: 'ac', sourceNodeId, fStart: 10, fStop: 1e6, pointsPerDecade: 25,
  }).netlist;

  it('ends in .ac dec over the range it was given', () => {
    expect(ac('SG1')).toMatch(/^\.ac dec 25 10 1000000$/m);
    expect(ac('SG1')).not.toMatch(/^\.tran /m);
    expect(ac('SG1')).not.toMatch(/^\.ic /m);
  });

  it('drives exactly one source, and leaves every other card alone', () => {
    const netlist = ac('SG1');
    const driven = netlist.split('\n').filter(l => l.includes(' AC 1'));
    expect(driven).toHaveLength(1);
    expect(driven[0]).toContain('V_SG1');
    // The other source keeps its own card verbatim, which is what makes it
    // contribute nothing: no AC magnitude means an AC magnitude of zero.
    expect(netlist).toContain('V_V1');
    expect(netlist).toMatch(/V_V1 \S+ \S+ DC 5\n/);
  });

  it('moves the drive when a different source is chosen', () => {
    expect(ac('V1')).toMatch(/V_V1 .* AC 1/);
    expect(ac('V1')).not.toMatch(/V_SG1 .* AC 1/);
  });

  it('never emits a fractional or zero points-per-decade', () => {
    for (const p of [0, 0.4, 1.6, 25.5, -3]) {
      const { netlist } = build({ kind: 'ac', sourceNodeId: 'SG1', fStart: 1, fStop: 100, pointsPerDecade: p });
      const decades = /\.ac dec (\S+) /.exec(netlist)?.[1];
      expect(Number(decades)).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(Number(decades))).toBe(true);
    }
  });
});

describe('the pin list', () => {
  it('names every terminal the netlist was built from', () => {
    const { pins } = build();
    const ports = pins.map(p => `${p.nodeId}-${p.handleId}`);
    expect(ports).toContain('R1-in');
    expect(ports).toContain('R1-out');
    expect(ports).toContain('C1-in');
    expect(ports).toContain('SG1-out');
    // Ground and net labels have no device of their own, so no terminals.
    expect(ports.some(p => p.startsWith('GND1-'))).toBe(false);
  });

  it('lists each terminal once, whatever the analysis', () => {
    for (const analysis of [undefined, { kind: 'op' } as const]) {
      const { pins } = build(analysis);
      const ports = pins.map(p => `${p.nodeId}-${p.handleId}`);
      expect(new Set(ports).size).toBe(ports.length);
    }
  });

  it('marks a terminal with nothing wired to it', () => {
    const { pins } = build();
    // V1's positive terminal is deliberately left off in this fixture.
    expect(pins.find(p => p.nodeId === 'V1' && p.handleId === 'pos')?.connected).toBe(false);
    expect(pins.find(p => p.nodeId === 'R1' && p.handleId === 'in')?.connected).toBe(true);
  });
});

describe('running the sketch', () => {
  it('leaves the microcontroller alone when asked to', () => {
    const mcu = node('MCU1', 'mcu', {
      code: "pinMode('D0','OUTPUT');\nwhile(true){ digitalWrite('D0',1); sleep(10); digitalWrite('D0',0); sleep(10); }",
      state: {},
    });
    const nodes = [mcu, node('GND1', 'ground')];
    const before = JSON.stringify(mcu.data.state);

    const skipped = generateSpiceNetlist(nodes, [], 1, 'normal', {}, undefined, undefined,
      { kind: 'op' }, { skipMcuExecution: true });
    expect(JSON.stringify(mcu.data.state)).toBe(before);
    expect(skipped.mcuLogs.MCU1).toEqual([]);
    // Every pin still reaches the netlist, which is what the rules check reads.
    expect(skipped.pins.some(p => p.nodeId === 'MCU1')).toBe(true);

    generateSpiceNetlist(nodes, [], 1, 'normal');
    expect(JSON.stringify(mcu.data.state)).not.toBe(before);
  });
});
