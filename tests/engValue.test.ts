/** Engineering-notation values, as they are typed on a schematic. */
import { describe, it, expect } from 'vitest';
import { parseEngValue, formatEngValue } from '../src/utils/engValue';

describe('parseEngValue', () => {
  it.each([
    ['1k', 1000], ['4.7k', 4700], ['10K', 10000], ['100', 100],
    ['1meg', 1e6], ['2.2meg', 2.2e6], ['100n', 1e-7], ['4.7u', 4.7e-6],
    ['10m', 0.01], ['33p', 33e-12], ['1g', 1e9], ['0.5', 0.5],
  ])('reads %s', (raw, want) => {
    expect(parseEngValue(raw)!).toBeCloseTo(want, 15);
  });

  it('tolerates a unit letter and surrounding space', () => {
    expect(parseEngValue(' 10kΩ ')!).toBeCloseTo(10000, 9);
    expect(parseEngValue('100nF')!).toBeCloseTo(1e-7, 15);
  });

  it('returns null rather than guessing at a label it cannot read', () => {
    for (const bad of ['', 'abc', '10x', '1/2', 'R1']) {
      expect(parseEngValue(bad), bad).toBeNull();
    }
  });
});

describe('formatEngValue', () => {
  it.each([
    [1000, '1k'], [4700, '4.7k'], [1e6, '1meg'], [1e-7, '100n'],
    [0.01, '10m'], [33e-12, '33p'], [100, '100'], [0, '0'],
  ])('writes %d as %s', (v, want) => {
    expect(formatEngValue(v)).toBe(want);
  });

  it('keeps three significant figures, not float noise', () => {
    expect(formatEngValue(4700.0002)).toBe('4.7k');
    expect(formatEngValue(1234)).toBe('1.23k');
  });

  it('round-trips every spelling it produces', () => {
    for (const v of [1, 2.2, 47, 100, 1e3, 4.7e3, 1e6, 1e-3, 4.7e-6, 1e-9, 33e-12]) {
      const round = parseEngValue(formatEngValue(v));
      expect(round, `${v} -> ${formatEngValue(v)}`).not.toBeNull();
      expect(round! / v).toBeCloseTo(1, 2);
    }
  });
});
