import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { generateSpiceNetlist } from '../src/utils/spice';
import { buildProbePoints } from '../src/utils/probePoints';
import { presets } from '../src/utils/presets';

const node = (id: string, type: string, data: Record<string, unknown> = {}): Node => ({
  id, type, position: { x: 0, y: 0 }, data,
});
const wire = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`,
  source, sourceHandle, target, targetHandle,
});

const points = (nodes: Node[], edges: Edge[]) => {
  const { pins, portToNet } = generateSpiceNetlist(
    nodes, edges, 1, 'normal', {}, undefined, undefined,
    { kind: 'op' }, { skipMcuExecution: true },
  );
  return { list: buildProbePoints(pins, id => id.toUpperCase()), portToNet };
};

/** Generator → R1 → C1 → ground, with a scope across the capacitor. */
const rcWithScope = () => ({
  nodes: [
    node('sg1', 'signalgen', { frequency: 1000, amplitude: 1 }),
    node('r1', 'resistor', { resistance: 1000 }),
    node('c1', 'capacitor', { capacitance: 1e-7 }),
    node('scope1', 'scope'),
    node('g1', 'ground'),
  ],
  edges: [
    wire('sg1', 'out', 'r1', 'in'),
    wire('r1', 'out', 'c1', 'in'),
    wire('c1', 'out', 'g1', 'in'),
    wire('sg1', 'gnd', 'g1', 'in'),
    wire('r1', 'out', 'scope1', 'ch1'),
    wire('sg1', 'out', 'scope1', 'ch2'),
    wire('scope1', 'gnd', 'g1', 'in'),
  ],
});

describe('what a sweep is offered to measure', () => {
  it('offers the node the scope’s first channel is on, not the one its second is on', () => {
    // Channel two is the reference someone compares against — here, the input.
    // Defaulting to it plots a flat line and looks like the feature is broken.
    const { list, portToNet } = points(...Object.values(rcWithScope()) as [Node[], Edge[]]);
    expect(list[0].net).toBe(portToNet['r1-out']);
  });

  it('names the node after a part, not after the instrument watching it', () => {
    const { list } = points(...Object.values(rcWithScope()) as [Node[], Edge[]]);
    expect(list[0].label).toMatch(/^(R1 output|C1 input)$/);
    expect(list[0].label).not.toContain('SCOPE');
  });

  it('puts the generator’s own node last, even though a resistor shares it', () => {
    const { list, portToNet } = points(...Object.values(rcWithScope()) as [Node[], Edge[]]);
    expect(list[list.length - 1].net).toBe(portToNet['sg1-out']);
  });

  it('still offers something sensible with no instruments at all', () => {
    const nodes = [
      node('sg1', 'signalgen', { frequency: 1000, amplitude: 1 }),
      node('r1', 'resistor', { resistance: 1000 }),
      node('c1', 'capacitor', { capacitance: 1e-7 }),
      node('g1', 'ground'),
    ];
    const edges = [
      wire('sg1', 'out', 'r1', 'in'),
      wire('r1', 'out', 'c1', 'in'),
      wire('c1', 'out', 'g1', 'in'),
      wire('sg1', 'gnd', 'g1', 'in'),
    ];
    const { list, portToNet } = points(nodes, edges);
    expect(list[0].net).toBe(portToNet['r1-out']);
  });

  it('never offers ground, an unconnected pin, or the same net twice', () => {
    const nodes = [
      node('sg1', 'signalgen', { frequency: 1000, amplitude: 1 }),
      node('r1', 'resistor', { resistance: 1000 }),
      node('r9', 'resistor', { resistance: 1000 }),
      node('g1', 'ground'),
    ];
    const edges = [wire('sg1', 'out', 'r1', 'in'), wire('r1', 'out', 'g1', 'in'), wire('sg1', 'gnd', 'g1', 'in')];
    const { list } = points(nodes, edges);
    expect(list.some(p => p.net === '0')).toBe(false);
    expect(list.some(p => p.net.startsWith('NC_'))).toBe(false);
    expect(new Set(list.map(p => p.net)).size).toBe(list.length);
  });

  it('is empty for a circuit with nothing wired up', () => {
    expect(buildProbePoints([], id => id)).toEqual([]);
    expect(points([node('r1', 'resistor')], []).list).toEqual([]);
  });

  it('defaults the shipped Bode preset to the filter output', () => {
    const preset = presets.sallenKeyFilter;
    const { list, portToNet } = points(preset.nodes, preset.edges);
    expect(list[0].net).toBe(portToNet['u1-out']);
    expect(list[0].label).toContain('U1');
  });
});
