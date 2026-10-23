import { describe, it, expect } from 'vitest';
import { presets } from '../src/utils/presets';
import { PRESET_SHELF, EXAMPLE_SHELVES, exampleEntries, matchesQuery, copyName, formatSceneDate } from '../src/utils/circuitCatalog';

describe('circuit catalog', () => {
  it('puts every built-in preset on a shelf', () => {
    const missing = Object.keys(presets).filter((id) => !PRESET_SHELF[id]);
    expect(missing).toEqual([]);
  });

  it('shelves nothing that is not a preset', () => {
    expect(Object.keys(PRESET_SHELF).filter((id) => !(id in presets))).toEqual([]);
  });

  it('lists every preset once, in shelf order', () => {
    const entries = exampleEntries();
    expect(entries.map((e) => e.id).sort()).toEqual(Object.keys(presets).sort());
    const shelfOrder = entries.map((e) => EXAMPLE_SHELVES.indexOf(e.shelf));
    expect(shelfOrder).toEqual([...shelfOrder].sort((a, b) => a - b));
  });
});

describe('matchesQuery', () => {
  it('needs every word, in any order, ignoring case and accents', () => {
    expect(matchesQuery('blink 555', '555 Blinker')).toBe(true);
    expect(matchesQuery('BUCK', 'Buck Converter (24V → 5V)')).toBe(true);
    expect(matchesQuery('cafe', 'Café amp')).toBe(true);
    expect(matchesQuery('buck boost', 'Buck Converter')).toBe(false);
  });

  it('finds everything with an empty query', () => {
    expect(matchesQuery('  ', 'anything')).toBe(true);
  });

  it('searches across all the fields it is given', () => {
    expect(matchesQuery('power buck', 'Buck Converter', 'Power')).toBe(true);
  });
});

describe('copyName', () => {
  it('counts up past names already taken', () => {
    expect(copyName('Amp', [])).toBe('Amp copy');
    expect(copyName('Amp', ['Amp copy'])).toBe('Amp copy 2');
    expect(copyName('Amp copy', ['Amp copy', 'Amp copy 2'])).toBe('Amp copy 3');
  });
});

describe('formatSceneDate', () => {
  const now = new Date(2026, 9, 22, 15, 0).getTime();
  it('says Yesterday for yesterday', () => {
    expect(formatSceneDate(new Date(2026, 9, 21, 9, 0).getTime(), now)).toBe('Yesterday');
  });
  it('gives the year only for another year', () => {
    expect(formatSceneDate(new Date(2025, 0, 3).getTime(), now)).toMatch(/2025/);
    expect(formatSceneDate(new Date(2026, 0, 3).getTime(), now)).not.toMatch(/2026/);
  });
});
