/** Engineering-notation values, as they are typed on a schematic. */
import { describe, it, expect } from 'vitest';
import { parseEngValue, formatEngValue } from '../src/utils/engValue';
import { sanitizeSpiceValue } from '../src/utils/spice';

describe('parseEngValue', () => {
  it.each([
    ['1k', 1000], ['4.7k', 4700], ['10K', 10000], ['100', 100],
    ['1meg', 1e6], ['2.2meg', 2.2e6], ['1M', 1e6], ['2.2MΩ', 2.2e6], ['1Meg', 1e6], ['1MEG', 1e6], ['100n', 1e-7], ['4.7u', 4.7e-6],
    ['10m', 0.01], ['33p', 33e-12], ['1g', 1e9], ['0.5', 0.5],
  ])('reads %s', (raw, want) => {
    expect(parseEngValue(raw)!).toBeCloseTo(want, 15);
  });

  it('tolerates a unit letter and surrounding space', () => {
    expect(parseEngValue(' 10kΩ ')!).toBeCloseTo(10000, 9);
    expect(parseEngValue('100nF')!).toBeCloseTo(1e-7, 15);
  });

  it('reads Greek mu and the micro sign alike', () => {
    // U+03BC and U+00B5 render identically; the first once parsed as a bare 10.
    expect(parseEngValue('10\u03bc')!).toBeCloseTo(10e-6, 15);
    expect(parseEngValue('10\u03bcF')!).toBeCloseTo(10e-6, 15);
    expect(parseEngValue('10\u00b5F')!).toBeCloseTo(10e-6, 15);
    expect(sanitizeSpiceValue('10\u03bcF')).toBe('10uF');
    expect(sanitizeSpiceValue('10\u00b5F')).toBe('10uF');
  });

  it('reads M as mega and m as milli, as people write them', () => {
    expect(parseEngValue('1M')!).toBeCloseTo(1e6, 6);
    expect(parseEngValue('1m')!).toBeCloseTo(1e-3, 15);
    expect(parseEngValue('10mA')!).toBeCloseTo(0.01, 15);
    expect(parseEngValue('1MA')!).toBeCloseTo(1e6, 6);
  });

  it('hands SPICE a capital M as meg, since SPICE ignores case', () => {
    for (const [label, want] of [
      ['1M', '1meg'], ['2.2MΩ', '2.2meg'], ['1Meg', '1Meg'], ['1MEG', '1MEG'],
      ['1m', '1m'], ['10mA', '10mA'], ['10mH', '10mH'], ['4.7k', '4.7k'], ['1e3M', '1e3meg'],
    ]) {
      expect(sanitizeSpiceValue(label), label).toBe(want);
    }
  });

  it('agrees with SPICE on every spelling it hands over', () => {
    // SPICE: case-insensitive, meg before m, trailing letters ignored.
    const spice = (v: string) => {
      const m = /^([-+]?[0-9.]+(?:e[-+]?\d+)?)([a-z]*)/i.exec(v)!;
      const n = parseFloat(m[1]); const t = m[2].toLowerCase();
      const mult = t.startsWith('meg') ? 1e6 : ({ t: 1e12, g: 1e9, k: 1e3, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 } as Record<string, number>)[t[0]] ?? 1;
      return n * mult;
    };
    for (const label of ['1M', '2.2MΩ', '1Meg', '1m', '10mA', '4.7k', '100n', '10μF', '22p', '5V', '330Ω']) {
      expect(spice(sanitizeSpiceValue(label)) / parseEngValue(label)!, label).toBeCloseTo(1, 9);
    }
  });

  it('reads source values with their unit', () => {
    expect(parseEngValue('5V')!).toBeCloseTo(5, 12);
    expect(parseEngValue('10mA')!).toBeCloseTo(0.01, 12);
    expect(parseEngValue(formatEngValue(0.0104) + 'A')!).toBeCloseTo(0.0104, 12);
  });

  it('returns null rather than guessing at a label it cannot read', () => {
    for (const bad of ['', 'abc', '10x', '1/2', 'R1']) {
      expect(parseEngValue(bad), bad).toBeNull();
    }
  });
});

describe('formatEngValue', () => {
  it.each([
    [1000, '1k'], [4700, '4.7k'], [1e6, '1M'], [1e-7, '100n'],
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
