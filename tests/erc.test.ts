import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { generateSpiceNetlist } from '../src/utils/spice';
import { runErc, dcPathGroups, pinLabel } from '../src/utils/erc';
import type { Advisory } from '../src/types/advisories';

const node = (id: string, type: string, data: Record<string, unknown> = {}): Node => ({
  id, type, position: { x: 0, y: 0 }, data,
});

const wire = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`,
  source, sourceHandle, target, targetHandle,
});

/** The rules check, run the way the app runs it. */
const check = (nodes: Node[], edges: Edge[]): Advisory[] => {
  const { portToNet, pins } = generateSpiceNetlist(
    nodes, edges, 1, 'normal', {}, undefined, undefined,
    { kind: 'op' }, { skipMcuExecution: true },
  );
  return runErc({ nodes, pins, portToNet, nameOf: id => id });
};

const ids = (list: Advisory[]) => list.map(a => a.id);
const titles = (list: Advisory[]) => list.map(a => a.title).join(' | ');

/** A 9V supply across two resistors, grounded. Nothing to say about it. */
const divider = () => ({
  nodes: [
    node('V1', 'voltage', { voltage: 9 }),
    node('R1', 'resistor', { resistance: 1000 }),
    node('R2', 'resistor', { resistance: 2000 }),
    node('GND1', 'ground'),
  ],
  edges: [
    wire('V1', 'pos', 'R1', 'in'),
    wire('R1', 'out', 'R2', 'in'),
    wire('R2', 'out', 'GND1', 'in'),
    wire('V1', 'neg', 'GND1', 'in'),
  ],
});

describe('the quiet case', () => {
  it('says nothing about a complete divider', () => {
    const { nodes, edges } = divider();
    expect(check(nodes, edges)).toEqual([]);
  });

  it('says nothing about an empty canvas', () => {
    expect(check([], [])).toEqual([]);
    expect(check([node('GND1', 'ground')], [])).toEqual([]);
  });

  it('stays quiet across a spread of ordinary circuits', () => {
    // Each of these is a circuit someone would actually draw, wired up
    // completely. A rules check that fires on any of them is one that gets
    // turned off before it ever catches anything.
    const cases: { name: string; nodes: Node[]; edges: Edge[] }[] = [
      {
        name: 'RC low-pass off a signal generator',
        nodes: [
          node('SG1', 'signalgen', { frequency: 1000, amplitude: 5 }),
          node('R1', 'resistor', { resistance: 1000 }),
          node('C1', 'capacitor', { capacitance: 1e-7 }),
          node('GND1', 'ground'),
        ],
        edges: [
          wire('SG1', 'out', 'R1', 'in'),
          wire('R1', 'out', 'C1', 'in'),
          wire('C1', 'out', 'GND1', 'in'),
          wire('SG1', 'gnd', 'GND1', 'in'),
        ],
      },
      {
        name: 'LED and series resistor off a rail',
        nodes: [
          node('PR1', 'powerrail', { rail: '+5V', voltage: 5 }),
          node('R1', 'resistor', { resistance: 330 }),
          node('D1', 'led', {}),
          node('GND1', 'ground'),
        ],
        edges: [
          wire('PR1', 'in', 'R1', 'in'),
          wire('R1', 'out', 'D1', 'anode'),
          wire('D1', 'cathode', 'GND1', 'in'),
        ],
      },
      {
        name: 'inverting op-amp with both rails wired',
        nodes: [
          node('V1', 'voltage', { voltage: 12 }),
          node('V2', 'voltage', { voltage: -12 }),
          node('SG1', 'signalgen', { frequency: 1000, amplitude: 1 }),
          node('R1', 'resistor', { resistance: 1000 }),
          node('R2', 'resistor', { resistance: 10000 }),
          node('U1', 'opamp', {}),
          node('GND1', 'ground'),
        ],
        edges: [
          wire('SG1', 'out', 'R1', 'in'),
          wire('R1', 'out', 'U1', 'in_inv'),
          wire('U1', 'in_inv', 'R2', 'in'),
          wire('R2', 'out', 'U1', 'out'),
          wire('U1', 'in_non', 'GND1', 'in'),
          wire('V1', 'pos', 'U1', 'vcc'),
          wire('V2', 'pos', 'U1', 'vee'),
          wire('V1', 'neg', 'GND1', 'in'),
          wire('V2', 'neg', 'GND1', 'in'),
          wire('SG1', 'gnd', 'GND1', 'in'),
        ],
      },
      {
        name: 'transformer with both windings loaded',
        nodes: [
          node('V1', 'acvoltage', { amplitude: 12, frequency: 50 }),
          node('T1', 'transformer', {}),
          node('R1', 'resistor', { resistance: 100 }),
          node('GND1', 'ground'),
        ],
        edges: [
          wire('V1', 'pos', 'T1', 'p1'),
          wire('T1', 'p2', 'GND1', 'in'),
          wire('V1', 'neg', 'GND1', 'in'),
          wire('T1', 's1', 'R1', 'in'),
          wire('R1', 'out', 'T1', 's2'),
          wire('T1', 's2', 'GND1', 'in'),
        ],
      },
    ];

    for (const c of cases) {
      expect(check(c.nodes, c.edges), `${c.name}: ${titles(check(c.nodes, c.edges))}`).toEqual([]);
    }
  });
});

describe('floating terminals', () => {
  it('names the pin that nothing is wired to', () => {
    const { nodes, edges } = divider();
    const found = check(nodes, edges.filter(e => e.target !== 'GND1' || e.source !== 'R2'));
    expect(ids(found)).toContain('erc:floating:R2:out');
  });

  it("calls an op-amp's supply pin by its name", () => {
    const nodes = [
      node('U1', 'opamp'),
      node('GND1', 'ground'),
      node('SG1', 'signalgen', { frequency: 100, amplitude: 1 }),
    ];
    const edges = [
      wire('SG1', 'out', 'U1', 'in_non'),
      wire('U1', 'in_inv', 'U1', 'out'),
      wire('SG1', 'gnd', 'GND1', 'in'),
    ];
    const found = check(nodes, edges);
    expect(titles(found)).toContain('VCC pin is not connected');
    expect(titles(found)).toContain('VEE pin is not connected');
  });

  it('stops naming a part that has been told to be quiet', () => {
    const noisy = [node('U1', 'opamp'), node('GND1', 'ground')];
    const quiet = [node('U1', 'opamp', { ercIgnore: true }), node('GND1', 'ground')];
    expect(check(noisy, []).some(a => a.id.startsWith('erc:floating:U1'))).toBe(true);
    expect(check(quiet, []).some(a => a.id.startsWith('erc:floating:U1'))).toBe(false);
  });
});

describe('a missing reference', () => {
  it('notices a circuit with no ground at all', () => {
    const { nodes, edges } = divider();
    const grounded = nodes.filter(n => n.type !== 'ground');
    const rewired = edges.filter(e => e.target !== 'GND1');
    expect(ids(check(grounded, rewired))).toContain('erc:no-ground');
  });

  it('is not satisfied by a ground symbol nothing is wired to', () => {
    const nodes = [
      node('V1', 'voltage', { voltage: 5 }),
      node('R1', 'resistor', { resistance: 1000 }),
      node('GND1', 'ground'),
    ];
    const edges = [wire('V1', 'pos', 'R1', 'in'), wire('V1', 'neg', 'R1', 'out')];
    expect(ids(check(nodes, edges))).toContain('erc:no-ground');
  });

  it('says it once, not once per part', () => {
    const nodes = [node('R1', 'resistor'), node('R2', 'resistor'), node('R3', 'resistor')];
    const edges = [wire('R1', 'out', 'R2', 'in'), wire('R2', 'out', 'R3', 'in')];
    expect(ids(check(nodes, edges)).filter(id => id === 'erc:no-ground')).toHaveLength(1);
  });
});

describe('a named net with nothing else on it', () => {
  it('notices a label written once', () => {
    const nodes = [
      node('V1', 'voltage', { voltage: 5 }),
      node('R1', 'resistor', { resistance: 1000 }),
      node('GND1', 'ground'),
      node('L1', 'netlabel', { net: 'VOUT' }),
    ];
    const edges = [
      wire('V1', 'pos', 'R1', 'in'),
      wire('R1', 'out', 'GND1', 'in'),
      wire('V1', 'neg', 'GND1', 'in'),
    ];
    expect(titles(check(nodes, edges))).toContain('Nothing else is on the net "VOUT"');
  });

  it('stays quiet once something answers to the name', () => {
    const nodes = [
      node('V1', 'voltage', { voltage: 5 }),
      node('R1', 'resistor', { resistance: 1000 }),
      node('R2', 'resistor', { resistance: 1000 }),
      node('GND1', 'ground'),
      node('L1', 'netlabel', { net: 'VOUT' }),
    ];
    const edges = [
      wire('V1', 'pos', 'R1', 'in'),
      wire('R1', 'out', 'L1', 'in'),
      wire('L1', 'in', 'R2', 'in'),
      wire('R2', 'out', 'GND1', 'in'),
      wire('V1', 'neg', 'GND1', 'in'),
    ];
    expect(titles(check(nodes, edges))).not.toContain('Nothing else is on the net');
  });
});

describe('DC paths', () => {
  it('reports a section reachable only through capacitors', () => {
    // C1 couples the divider into R3, and nothing else references R3's node.
    const nodes = [
      node('V1', 'voltage', { voltage: 9 }),
      node('R1', 'resistor', { resistance: 1000 }),
      node('C1', 'capacitor', { capacitance: 1e-6 }),
      node('R3', 'resistor', { resistance: 1000 }),
      node('C2', 'capacitor', { capacitance: 1e-6 }),
      node('GND1', 'ground'),
    ];
    const edges = [
      wire('V1', 'pos', 'R1', 'in'),
      wire('R1', 'out', 'GND1', 'in'),
      wire('V1', 'neg', 'GND1', 'in'),
      wire('R1', 'in', 'C1', 'in'),
      wire('C1', 'out', 'R3', 'in'),
      wire('R3', 'out', 'C2', 'in'),
      wire('C2', 'out', 'GND1', 'in'),
    ];
    const found = check(nodes, edges);
    expect(ids(found).some(id => id.startsWith('erc:no-dc-path'))).toBe(true);
    expect(titles(found)).toContain('R3');
  });

  it('does not report a net whose floating pin has already been named', () => {
    // One unconnected resistor lead. It is reported once, as a floating pin,
    // and not a second time as a net with no DC path.
    const nodes = [
      node('V1', 'voltage', { voltage: 5 }),
      node('R1', 'resistor', { resistance: 1000 }),
      node('GND1', 'ground'),
    ];
    const edges = [wire('V1', 'pos', 'R1', 'in'), wire('V1', 'neg', 'GND1', 'in')];
    const found = check(nodes, edges);
    expect(ids(found)).toContain('erc:floating:R1:out');
    expect(ids(found).some(id => id.startsWith('erc:no-dc-path'))).toBe(false);
  });

  it('treats a capacitor and a current source as breaks, and a resistor as a path', () => {
    expect(dcPathGroups('capacitor', {}, ['in', 'out'])).toEqual([]);
    expect(dcPathGroups('currentsource', {}, ['pos', 'neg'])).toEqual([]);
    expect(dcPathGroups('resistor', {}, ['in', 'out'])).toEqual([['in', 'out']]);
  });

  it('reaches ground through a part that drives against it', () => {
    // A logic gate's output is a B-source written against node 0, so it does
    // set the level on its output net — while its inputs genuinely do not.
    expect(dcPathGroups('nand', {}, ['in1', 'in2', 'out'])).toEqual([['out', '0']]);
  });

  it('reads a multimeter as a break unless it is set to measure current', () => {
    expect(dcPathGroups('multimeter', { mode: 'voltage' }, ['pos', 'neg'])).toEqual([]);
    expect(dcPathGroups('multimeter', { mode: 'current' }, ['pos', 'neg'])).toEqual([['pos', 'neg']]);
  });
});

describe('pin names', () => {
  it('uses the name on the datasheet rather than the handle id', () => {
    expect(pinLabel('opamp', 'in_non')).toContain('non-inverting');
    expect(pinLabel('timer555', '2')).toBe('TRIG (pin 2)');
    expect(pinLabel('resistor', 'out')).toBe('output');
    expect(pinLabel('whatever', 'zz')).toBe('pin zz');
  });
});
