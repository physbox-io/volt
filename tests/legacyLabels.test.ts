/** Pot labels saved when the pot read "m" as mega, and how M and m reach the netlist now. */
import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { upgradeLegacyLabels } from '../src/utils/legacyLabels';
import { generateSpiceNetlist } from '../src/utils/spice';

const pot = (label: string): Node =>
  ({ id: 'p', type: 'potentiometer', position: { x: 0, y: 0 }, data: { label, position: 50 } });

const labelOf = (n: Node[]) => n[0].data.label;

describe('upgradeLegacyLabels', () => {
  it.each([
    ['1m', '1M'], ['2.2m', '2.2M'], ['1mΩ', '1MΩ'], ['4.7 m ohm', '4.7 M ohm'],
  ])('reads an old pot %s as %s', (from, to) => {
    expect(labelOf(upgradeLegacyLabels([pot(from)]))).toBe(to);
  });

  it('leaves every other spelling, and every other part, alone', () => {
    for (const keep of ['10k', '1M', '1meg', '100', 'R_load', '']) {
      expect(labelOf(upgradeLegacyLabels([pot(keep)])), keep).toBe(keep);
    }
    const r = [{ ...pot('10m'), type: 'resistor' }];
    expect(upgradeLegacyLabels(r)).toBe(r);
  });

  it('is idempotent and returns the same array when nothing changes', () => {
    const once = upgradeLegacyLabels([pot('1m')]);
    expect(upgradeLegacyLabels(once)).toBe(once);
  });
});

describe('potentiometer netlist', () => {
  const halves = (label: string) => {
    const { netlist } = generateSpiceNetlist([pot(label)], []);
    return netlist.split('\n').filter(l => /^R_p_(top|bot) /.test(l)).map(l => Number(l.split(' ')[3]));
  };

  it.each([['10k', 1e4], ['1meg', 1e6], ['4.7kΩ', 4700], ['100', 100]])('splits %s into halves summing to %d', (label, total) => {
    const [top, bot] = halves(label);
    expect(top + bot).toBeCloseTo(total, 6);
  });

  it('reads an old pot, migrated or already capital, as the megohm it was', () => {
    for (const old of ['1m', '1M']) {
      const [top, bot] = halves(labelOf(upgradeLegacyLabels([pot(old)])) as string);
      expect(top + bot, old).toBeCloseTo(1e6, 3);
    }
  });

  it('simulates a 1M resistor as a megohm', () => {
    const r = { id: 'r', type: 'resistor', position: { x: 0, y: 0 }, data: { label: '1M' } } as Node;
    const line = generateSpiceNetlist([r], []).netlist.split('\n').find(l => l.startsWith('R_r '))!;
    expect(line.split(' ')[3]).toBe('1meg');
  });
});
