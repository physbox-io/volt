import { describe, it, expect } from 'vitest';
import {
  DESIGNATOR_PREFIXES,
  assignDesignators,
  designatorPrefix,
  getNodeDefaultName,
} from '../src/utils/nodeNaming';

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, data });

/** A part of every kind that gets a designator, in creation order. */
const oneOfEach = () =>
  Object.keys(DESIGNATOR_PREFIXES).map((type, i) => node(`${type}-${i + 1}`, type));

describe('which parts are numbered', () => {
  it('numbers every kind of part a board is built from', () => {
    for (const type of ['resistor', 'capacitor', 'inductor', 'diode', 'zener', 'led',
      'npn', 'pnp', 'nmos', 'pmos', 'timer555', 'opamp', 'mcu', 'switch', 'pinheader']) {
      expect(designatorPrefix(type)).toBeTruthy();
    }
  });

  it('numbers nothing that is not a part', () => {
    for (const type of ['ground', 'junction', 'netlabel', 'powerrail', 'scope', 'multimeter', 'via', 'cutout']) {
      expect(designatorPrefix(type)).toBeNull();
    }
    expect(designatorPrefix(undefined)).toBeNull();
    expect(designatorPrefix('not-a-type')).toBeNull();
  });

  it('gives every prefix the conventional letter', () => {
    expect(designatorPrefix('resistor')).toBe('R');
    expect(designatorPrefix('capacitor')).toBe('C');
    expect(designatorPrefix('inductor')).toBe('L');
    // Any diode is a D and any transistor a Q, whatever the polarity.
    for (const t of ['diode', 'zener', 'led']) expect(designatorPrefix(t)).toBe('D');
    for (const t of ['npn', 'pnp', 'nmos', 'pmos']) expect(designatorPrefix(t)).toBe('Q');
    // Every IC, the gates included.
    for (const t of ['timer555', 'opamp', 'dff', 'mcu', 'heltec_v4', 'and', 'or', 'not', 'nand', 'nor', 'xor']) {
      expect(designatorPrefix(t)).toBe('U');
    }
    expect(designatorPrefix('switch')).toBe('SW');
    expect(designatorPrefix('pinheader')).toBe('J');
  });
});

describe('numbering a canvas', () => {
  it('counts each letter from 1, independently of the others', () => {
    const nodes = [
      node('resistor-1', 'resistor'), node('capacitor-2', 'capacitor'),
      node('resistor-3', 'resistor'), node('diode-4', 'diode'),
      node('npn-5', 'npn'), node('resistor-6', 'resistor'), node('led-7', 'led'),
    ];
    expect(assignDesignators(nodes)).toEqual({
      'resistor-1': 'R1', 'capacitor-2': 'C1', 'resistor-3': 'R2',
      'diode-4': 'D1', 'npn-5': 'Q1', 'resistor-6': 'R3', 'led-7': 'D2',
    });
  });

  it('never gives two parts the same designator', () => {
    const nodes = [...oneOfEach(), ...oneOfEach().map(n => node(`${n.id}0`, n.type))];
    const names = Object.values(assignDesignators(nodes));
    expect(names).toHaveLength(nodes.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('numbers in creation order, however the nodes are ordered in the array', () => {
    const nodes = [
      node('resistor-9', 'resistor'), node('resistor-2', 'resistor'), node('resistor-5', 'resistor'),
    ];
    const names = assignDesignators(nodes);
    expect(names['resistor-2']).toBe('R1');
    expect(names['resistor-5']).toBe('R2');
    expect(names['resistor-9']).toBe('R3');
    expect(assignDesignators([...nodes].reverse())).toEqual(names);
  });

  it('leaves the parts already drawn alone when another is added', () => {
    const nodes = [node('resistor-1', 'resistor'), node('resistor-2', 'resistor')];
    const before = assignDesignators(nodes);
    const after = assignDesignators([...nodes, node('resistor-7', 'resistor')]);
    expect(after['resistor-1']).toBe(before['resistor-1']);
    expect(after['resistor-2']).toBe(before['resistor-2']);
    expect(after['resistor-7']).toBe('R3');
  });

  it('keeps a hand-set name and numbers around it', () => {
    const nodes = [
      node('resistor-1', 'resistor', { name: 'R7' }),
      node('resistor-2', 'resistor'),
      node('resistor-3', 'resistor'),
    ];
    const names = assignDesignators(nodes);
    expect(names['resistor-1']).toBe('R7');
    expect(names['resistor-2']).toBe('R1');
    expect(names['resistor-3']).toBe('R2');
    expect(new Set(Object.values(names)).size).toBe(3);
  });

  it('does not collide with a hand-set name further down the sequence', () => {
    const nodes = [
      node('resistor-1', 'resistor'),
      node('resistor-2', 'resistor', { name: 'R2' }),
      node('resistor-3', 'resistor'),
    ];
    const names = assignDesignators(nodes);
    expect(names).toEqual({ 'resistor-1': 'R1', 'resistor-2': 'R2', 'resistor-3': 'R3' });
  });

  it('skips the parts that are not numbered, and keeps their names out', () => {
    const nodes = [node('ground-1', 'ground'), node('resistor-2', 'resistor'), node('junction-3', 'junction')];
    expect(assignDesignators(nodes)).toEqual({ 'resistor-2': 'R1' });
  });

  it('handles ids an older circuit or an agent can carry', () => {
    const nodes = [node('r1', 'resistor'), node('my-custom-part', 'capacitor'), node('C12', 'capacitor')];
    const names = assignDesignators(nodes);
    expect(names['r1']).toBe('R1');
    // Both capacitors are numbered; the one with no number in its id sorts last.
    expect(new Set([names['C12'], names['my-custom-part']])).toEqual(new Set(['C1', 'C2']));
  });
});

describe('the single-node fallback', () => {
  it('names a part from its own id when there is no canvas to count', () => {
    expect(getNodeDefaultName('resistor-3', 'resistor')).toBe('R3');
    expect(getNodeDefaultName('npn-4', 'npn')).toBe('Q4');
    expect(getNodeDefaultName('timer555-9', 'timer555')).toBe('U9');
    expect(getNodeDefaultName('r1', 'resistor')).toBe('R1');
  });

  it('falls back to the id for a part that is not numbered', () => {
    expect(getNodeDefaultName('ground-2', 'ground')).toBe('ground-2');
    expect(getNodeDefaultName('junction-1', 'junction')).toBe('junction-1');
  });
});
