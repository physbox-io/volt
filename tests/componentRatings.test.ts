import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import type { SpiceResult } from '../src/types/simulation';
import {
  checkComponentRatings,
  powerRatingFor,
  resistanceOf,
  timeWeightedMean,
} from '../src/utils/powerRatings';

const node = (id: string, type: string, data: Record<string, unknown> = {}): Node => ({
  id, type, position: { x: 0, y: 0 }, data,
});

/**
 * A result in the shape ngspice hands back: a time column and one column per
 * net. `timesMs` is what the app reads; the engine's own column is in seconds.
 */
const result = (timesMs: number[], nets: Record<string, number[]>): SpiceResult => ({
  header: 'Plotname: Transient Analysis\n',
  numVariables: 1 + Object.keys(nets).length,
  variableNames: ['time', ...Object.keys(nets).map(n => `v(${n})`)],
  numPoints: timesMs.length,
  dataType: 'real',
  data: [
    { name: 'time', type: 'time', values: timesMs.map(t => t / 1000) },
    ...Object.entries(nets).map(([name, values]) => ({ name: `v(${name})`, type: 'voltage' as const, values })),
  ],
});

const flat = (v: number, n = 5) => new Array(n).fill(v);
const times = (n = 5) => Array.from({ length: n }, (_, i) => i * 10);

describe('the rating a part is held to', () => {
  it('prefers what was typed in', () => {
    expect(powerRatingFor(node('R1', 'resistor', { powerRatingW: 3 }))).toMatchObject({ watts: 3, source: 'set' });
  });

  it('falls back to what the chosen package is sold at', () => {
    expect(powerRatingFor(node('R1', 'resistor', { packageId: '0805' }))).toMatchObject({ watts: 0.125, source: 'package' });
    expect(powerRatingFor(node('R1', 'resistor', { packageId: '2512' }))).toMatchObject({ watts: 1, source: 'package' });
  });

  it("uses the part's own default package when none was chosen", () => {
    // A resistor defaults to an axial through-hole part, which is a quarter watt.
    expect(powerRatingFor(node('R1', 'resistor'))).toMatchObject({ watts: 0.25, source: 'package' });
  });

  it('never returns a rating of zero, whatever it is handed', () => {
    for (const data of [{}, { powerRatingW: 0 }, { powerRatingW: -1 }, { powerRatingW: 'nonsense' }, { packageId: 'NOT-A-PACKAGE' }]) {
      expect(powerRatingFor(node('R1', 'resistor', data)).watts).toBeGreaterThan(0);
    }
  });
});

describe('resistance', () => {
  it('reads the numeric field first, then the label, then the fallback', () => {
    expect(resistanceOf(node('R1', 'resistor', { resistance: 47, label: '1k' }), 1000)).toBe(47);
    expect(resistanceOf(node('R1', 'resistor', { label: '4.7k' }), 1000)).toBe(4700);
    expect(resistanceOf(node('R1', 'resistor', { label: 'hand written' }), 1000)).toBe(1000);
  });
});

describe('the mean that matters', () => {
  it('weights by time rather than by sample count', () => {
    // One sample at 5W crowded against the start and a long stretch at 0W is a
    // part dissipating almost nothing. A plain average would call it 2.5W.
    const values = [5, 5, 0, 0];
    const t = [0, 0.001, 0.002, 1000];
    expect(timeWeightedMean(values, t)).toBeLessThan(0.02);
  });

  it('is the value itself when nothing varies', () => {
    expect(timeWeightedMean(flat(2), times())).toBeCloseTo(2, 6);
    expect(timeWeightedMean([7], [0])).toBe(7);
    expect(timeWeightedMean([], [])).toBe(0);
  });
});

describe('dissipation', () => {
  const nameOf = (id: string) => id;

  it('reports a resistor over its rating', () => {
    // 10V across 100R is a watt, into a quarter-watt part.
    const nodes = [node('R1', 'resistor', { resistance: 100 })];
    const portToNet = { 'R1-in': 'a', 'R1-out': '0' };
    const found = checkComponentRatings({
      nodes, portToNet, nameOf,
      result: result(times(), { a: flat(10) }),
    });
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('warning');
    expect(found[0].nodeId).toBe('R1');
    expect(found[0].title).toContain('R1');
    expect(found[0].title).toMatch(/1\.00W|1000mW/);
  });

  it('says nothing about a resistor inside its rating', () => {
    const nodes = [node('R1', 'resistor', { resistance: 1000 })];
    const portToNet = { 'R1-in': 'a', 'R1-out': '0' };
    expect(checkComponentRatings({
      nodes, portToNet, nameOf, result: result(times(), { a: flat(5) }),
    })).toEqual([]);
  });

  it('does not fire on a brief spike that the part never feels', () => {
    // A 5W edge lasting a hundredth of a millisecond, then nothing. Peak power
    // is twenty times the rating; the part stays cold.
    const nodes = [node('R1', 'resistor', { resistance: 100 })];
    const portToNet = { 'R1-in': 'a', 'R1-out': '0' };
    const found = checkComponentRatings({
      nodes, portToNet, nameOf,
      result: result([0, 0.01, 0.02, 1000], { a: [22, 22, 0, 0] }),
    });
    expect(found).toEqual([]);
  });

  it('honours a rating that was typed in', () => {
    const portToNet = { 'R1-in': 'a', 'R1-out': '0' };
    const hot = result(times(), { a: flat(10) });
    expect(checkComponentRatings({
      nodes: [node('R1', 'resistor', { resistance: 100, powerRatingW: 5 })], portToNet, nameOf, result: hot,
    })).toEqual([]);
    expect(checkComponentRatings({
      nodes: [node('R1', 'resistor', { resistance: 100, powerRatingW: 0.1 })], portToNet, nameOf, result: hot,
    })).toHaveLength(1);
  });

  it('adds up both halves of a potentiometer track', () => {
    // The wiper wound to the input end: the whole 10V sits across the ohm of
    // track that is left below it, while the long half above carries nothing.
    // A single figure for the part as a whole would miss this entirely.
    const nodes = [node('P1', 'potentiometer', { label: '1k', position: 0.1 })];
    const portToNet = { 'P1-in': 'a', 'P1-wiper': 'w', 'P1-out': '0' };
    const found = checkComponentRatings({
      nodes, portToNet, nameOf,
      result: result(times(), { a: flat(10), w: flat(10) }),
    });
    expect(found).toHaveLength(1);
    expect(found[0].nodeId).toBe('P1');
  });
});

describe('voltage limits', () => {
  const nameOf = (id: string) => id;

  it('checks a capacitor only once it has been told the rating', () => {
    const portToNet = { 'C1-in': 'a', 'C1-out': '0' };
    const overVolted = result(times(), { a: flat(25) });
    expect(checkComponentRatings({
      nodes: [node('C1', 'capacitor', {})], portToNet, nameOf, result: overVolted,
    })).toEqual([]);
    const found = checkComponentRatings({
      nodes: [node('C1', 'capacitor', { voltageRatingV: 16 })], portToNet, nameOf, result: overVolted,
    });
    expect(found).toHaveLength(1);
    expect(found[0].title).toContain('16V');
  });

  it('notices an LED held backwards past what it is specified to', () => {
    const portToNet = { 'D1-anode': '0', 'D1-cathode': 'k' };
    const found = checkComponentRatings({
      nodes: [node('D1', 'led', {})], portToNet, nameOf,
      result: result(times(), { k: flat(12) }),
    });
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('advisory');
    expect(found[0].title).toContain('12.0V');
  });

  it('stays quiet about an LED the right way round', () => {
    const portToNet = { 'D1-anode': 'a', 'D1-cathode': '0' };
    expect(checkComponentRatings({
      nodes: [node('D1', 'led', {})], portToNet, nameOf,
      result: result(times(), { a: flat(2) }),
    })).toEqual([]);
  });
});

describe('nothing to go on', () => {
  it('says nothing when there is no run to read', () => {
    const nodes = [node('R1', 'resistor', { resistance: 1 })];
    expect(checkComponentRatings({ nodes, portToNet: {}, nameOf: id => id, result: null })).toEqual([]);
  });

  it('says nothing about a part whose nets are not in the result', () => {
    const nodes = [node('R1', 'resistor', { resistance: 1 })];
    expect(checkComponentRatings({
      nodes, portToNet: { 'R1-in': 'missing', 'R1-out': 'gone' }, nameOf: id => id,
      result: result(times(), { a: flat(10) }),
    })).toEqual([]);
  });
});
