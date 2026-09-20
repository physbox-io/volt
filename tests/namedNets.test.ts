import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import {
  POWER_RAIL_PRESETS,
  netKey,
  netDisplayName,
  nextNetLabelName,
  nodeNetName,
  railVoltage,
  virtualNetPort,
} from '../src/utils/netNaming';
import { generateSpiceNetlist } from '../src/utils/spice';
import { buildPortAdjacency, isPortConnected } from '../src/utils/graphTopology';
import { extractNets, classifyNode, isPhysical } from '../src/utils/pcbNets';

const node = (id: string, type: string, data: Record<string, unknown> = {}): Node => ({
  id, type, position: { x: 0, y: 0 }, data,
});

const wire = (source: string, sourceHandle: string, target: string, targetHandle: string): Edge => ({
  id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`,
  source, sourceHandle, target, targetHandle,
});

/** R1 between `a` and `b`, R2 between `c` and `d`, nothing joined up yet. */
const twoResistors = () => [
  node('resistor-1', 'resistor', { resistance: 1000 }),
  node('resistor-2', 'resistor', { resistance: 2000 }),
];

describe('net names', () => {
  it('turns every rail preset into a SPICE-safe token', () => {
    for (const { rail } of POWER_RAIL_PRESETS) {
      const key = netKey(rail);
      expect(key).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    }
  });

  it('keeps the sign of a rail rather than dropping it', () => {
    expect(netKey('+5V')).toBe('P5V');
    expect(netKey('-12V')).toBe('N12V');
    expect(netKey('+5V')).not.toBe(netKey('-5V'));
    expect(netKey('+3.3V')).toBe('P3_3V');
  });

  it('never emits a token SPICE would read as a number or a blank', () => {
    const awkward = ['', '   ', '3V3', '5', '!!!', '+', '-', 'a b', 'VCC/2', 'net-1', '__'];
    for (const name of awkward) {
      const key = netKey(name);
      expect(key).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it('folds case and whitespace, so sda and SDA are one net', () => {
    expect(netDisplayName(' sda ', 'X')).toBe('SDA');
    expect(virtualNetPort('sda')).toBe(virtualNetPort('SDA'));
    expect(netDisplayName(undefined, 'NET1')).toBe('NET1');
  });

  it('sends a label written GND to the ground net, not a net called GND', () => {
    for (const name of ['GND', 'gnd', 'VSS', ' ground ']) {
      expect(virtualNetPort(name)).toBe('GND-global');
    }
    expect(virtualNetPort('GNDA')).not.toBe('GND-global');
  });

  it('reads a rail voltage from the name, and lets the node override it', () => {
    for (const { rail, voltage } of POWER_RAIL_PRESETS) {
      expect(railVoltage({ rail })).toBe(voltage);
    }
    expect(railVoltage({ rail: '+5V', voltage: 4.8 })).toBe(4.8);
    expect(railVoltage({ rail: 'MYRAIL' })).toBe(0);
  });

  it('names only the two parts that carry a net name', () => {
    expect(nodeNetName('netlabel', { net: 'sda' })).toBe('SDA');
    expect(nodeNetName('powerrail', { rail: '+5v' })).toBe('+5V');
    expect(nodeNetName('resistor', { net: 'SDA' })).toBeNull();
  });

  it('gives a new label a name no label on the canvas is using', () => {
    const nodes = [node('netlabel-1', 'netlabel', { net: 'NET1' }), node('netlabel-2', 'netlabel', { net: 'NET3' })];
    expect(nextNetLabelName(nodes)).toBe('NET2');
    expect(nextNetLabelName([...nodes, node('netlabel-3', 'netlabel', { net: 'NET2' })])).toBe('NET4');
    expect(nextNetLabelName([])).toBe('NET1');
  });
});

describe('connectivity by name', () => {
  it('joins two pins carrying the same label with no wire between them', () => {
    const nodes = [
      ...twoResistors(),
      node('netlabel-1', 'netlabel', { net: 'SDA' }),
      node('netlabel-2', 'netlabel', { net: 'SDA' }),
    ];
    const edges = [
      wire('resistor-1', 'out', 'netlabel-1', 'in'),
      wire('resistor-2', 'in', 'netlabel-2', 'in'),
    ];
    expect(isPortConnected('resistor-1-out', 'resistor-2-in', nodes, edges)).toBe(true);
  });

  it('leaves pins on different names apart', () => {
    const nodes = [
      ...twoResistors(),
      node('netlabel-1', 'netlabel', { net: 'SDA' }),
      node('netlabel-2', 'netlabel', { net: 'SCL' }),
    ];
    const edges = [
      wire('resistor-1', 'out', 'netlabel-1', 'in'),
      wire('resistor-2', 'in', 'netlabel-2', 'in'),
    ];
    expect(isPortConnected('resistor-1-out', 'resistor-2-in', nodes, edges)).toBe(false);
  });

  it('puts a rail flag and a ground symbol in the same port namespace', () => {
    const nodes = [node('powerrail-1', 'powerrail', { rail: '+5V' }), node('ground-1', 'ground')];
    const adj = buildPortAdjacency(nodes, []);
    expect(adj['powerrail-1-in']).toContain(virtualNetPort('+5V'));
    expect(adj['ground-1-in']).toContain('GND-global');
  });
});

describe('the netlist a named net produces', () => {
  const railCircuit = () => {
    const nodes = [
      ...twoResistors(),
      node('powerrail-1', 'powerrail', { rail: '+5V', voltage: 5 }),
      node('powerrail-2', 'powerrail', { rail: '+5V', voltage: 5 }),
      node('ground-1', 'ground'),
    ];
    const edges = [
      wire('resistor-1', 'in', 'powerrail-1', 'in'),
      wire('resistor-2', 'in', 'powerrail-2', 'in'),
      wire('resistor-1', 'out', 'ground-1', 'in'),
      wire('resistor-2', 'out', 'ground-1', 'in'),
    ];
    return { nodes, edges };
  };

  it('supplies both resistors from one source, not one source per flag', () => {
    const { nodes, edges } = railCircuit();
    const { netlist, portToNet } = generateSpiceNetlist(nodes, edges);

    expect(portToNet['resistor-1-in']).toBe(portToNet['resistor-2-in']);
    const sources = netlist.split('\n').filter(l => l.startsWith('V_rail_'));
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatch(/^V_rail_\S+ \S+ 0 DC 5$/);
  });

  it('drives the rail net at the voltage the flag carries', () => {
    const { nodes, edges } = railCircuit();
    nodes[2].data = { rail: '+3.3V', voltage: 3.3 };
    nodes[3].data = { rail: '+3.3V', voltage: 3.3 };
    const { netlist } = generateSpiceNetlist(nodes, edges);
    expect(netlist).toMatch(/V_rail_\S+ \S+ 0 DC 3\.3/);
  });

  it('emits no device for the flags themselves', () => {
    const { nodes, edges } = railCircuit();
    const { netlist } = generateSpiceNetlist(nodes, edges);
    expect(netlist).not.toMatch(/^[A-UW-Z]\w*_(netlabel|powerrail)-/m);
  });

  it('refuses to put a source across a rail the operator shorted to ground', () => {
    const nodes = [node('powerrail-1', 'powerrail', { rail: '+5V' }), node('ground-1', 'ground')];
    const edges = [wire('powerrail-1', 'in', 'ground-1', 'in')];
    const { netlist } = generateSpiceNetlist(nodes, edges);
    expect(netlist).not.toContain('V_rail_');
  });

  it('merges labelled pins into one SPICE net', () => {
    const nodes = [
      ...twoResistors(),
      node('netlabel-1', 'netlabel', { net: 'SDA' }),
      node('netlabel-2', 'netlabel', { net: 'sda' }),
    ];
    const edges = [
      wire('resistor-1', 'out', 'netlabel-1', 'in'),
      wire('resistor-2', 'in', 'netlabel-2', 'in'),
    ];
    const { portToNet } = generateSpiceNetlist(nodes, edges);
    expect(portToNet['resistor-1-out']).toBe(portToNet['resistor-2-in']);
  });

  it('treats a label written GND as ground itself', () => {
    const nodes = [...twoResistors(), node('netlabel-1', 'netlabel', { net: 'GND' })];
    const edges = [wire('resistor-1', 'out', 'netlabel-1', 'in')];
    const { portToNet } = generateSpiceNetlist(nodes, edges);
    expect(portToNet['resistor-1-out']).toBe('0');
  });

  it('leaves an unnamed circuit\'s netlist exactly as it was', () => {
    const nodes = [...twoResistors(), node('voltage-1', 'voltage', { voltage: 9 }), node('ground-1', 'ground')];
    const edges = [
      wire('voltage-1', 'pos', 'resistor-1', 'in'),
      wire('resistor-1', 'out', 'resistor-2', 'in'),
      wire('resistor-2', 'out', 'ground-1', 'in'),
      wire('voltage-1', 'neg', 'ground-1', 'in'),
    ];
    const { netlist } = generateSpiceNetlist(nodes, edges);
    expect(netlist).toContain('V_voltage-1');
    expect(netlist).toContain('R_resistor-1');
    expect(netlist).not.toContain('V_rail_');
  });
});

describe('the board a named net produces', () => {
  it('keeps the flags off the board and out of the nets', () => {
    for (const type of ['netlabel', 'powerrail']) {
      expect(classifyNode(type)).toBe('virtual');
      expect(isPhysical(type)).toBe(false);
    }
  });

  it('calls the net what the schematic calls it', () => {
    const nodes = [
      ...twoResistors(),
      node('powerrail-1', 'powerrail', { rail: '+5V' }),
      node('powerrail-2', 'powerrail', { rail: '+5V' }),
    ];
    const edges = [
      wire('resistor-1', 'in', 'powerrail-1', 'in'),
      wire('resistor-2', 'in', 'powerrail-2', 'in'),
    ];
    const { nets, portToNet } = extractNets(nodes, edges);
    const rail = nets.find(n => n.name === '+5V');
    expect(rail).toBeDefined();
    expect(rail!.id).toBe('P5V');
    expect(rail!.ports.map(p => p.key).sort()).toEqual(['resistor-1-in', 'resistor-2-in']);
    expect(portToNet['resistor-1-in']).toBe(portToNet['resistor-2-in']);
    // The flags are connectivity, not pins to route copper to.
    expect(rail!.ports.some(p => p.nodeId.startsWith('powerrail'))).toBe(false);
  });

  it('never gives two nets the same id, whatever a label is called', () => {
    const nodes = [
      node('resistor-1', 'resistor'), node('resistor-2', 'resistor'),
      node('resistor-3', 'resistor'), node('resistor-4', 'resistor'),
      node('netlabel-1', 'netlabel', { net: 'N1' }),
      node('netlabel-2', 'netlabel', { net: 'N1' }),
      node('netlabel-3', 'netlabel', { net: 'GND' }),
      node('ground-1', 'ground'),
    ];
    const edges = [
      wire('resistor-1', 'in', 'netlabel-1', 'in'),
      wire('resistor-2', 'in', 'netlabel-2', 'in'),
      wire('resistor-1', 'out', 'resistor-2', 'out'),
      wire('resistor-3', 'in', 'resistor-4', 'in'),
      wire('resistor-3', 'out', 'netlabel-3', 'in'),
      wire('resistor-4', 'out', 'ground-1', 'in'),
    ];
    const { nets } = extractNets(nodes, edges);
    const ids = nets.map(n => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The label named GND landed on the ground net rather than beside it.
    expect(nets.filter(n => n.isGround)).toHaveLength(1);
  });
});
