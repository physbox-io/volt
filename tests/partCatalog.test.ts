import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PART_CATALOG, catalogKey, searchParts } from '../src/components/nodes/partCatalog';

const SIDEBAR = readFileSync(new URL('../src/components/Sidebar.tsx', import.meta.url), 'utf8');
const FLOW_AREA = readFileSync(new URL('../src/components/FlowArea.tsx', import.meta.url), 'utf8');

/** Every `partProps('type', 'label')` the palette renders, label included. */
function sidebarParts(): { type: string; label?: string }[] {
  const found: { type: string; label?: string }[] = [];
  for (const m of SIDEBAR.matchAll(/partProps\(\s*'([^']+)'(?:\s*,\s*'([^']*)')?\s*\)/g)) {
    found.push({ type: m[1], label: m[2] });
  }
  // The logic gates and the power rails are rendered from arrays, so their
  // types never reach `partProps` as literals.
  for (const m of SIDEBAR.matchAll(/\[((?:'\w+',\s*)+'\w+')\]\.map/g)) {
    for (const lit of m[1].matchAll(/'([^']+)'/g)) found.push({ type: lit[1] });
  }
  for (const m of SIDEBAR.matchAll(/\['([^']+)',\s*'(powerrail)'\]/g)) {
    found.push({ type: m[2], label: m[1] });
  }
  return found;
}

/** The palette list is scraped from source, so prove the scrape still works. */
const SIDEBAR_PARTS = sidebarParts();

/** The node types the canvas can actually render. */
function registeredTypes(): Set<string> {
  const block = FLOW_AREA.match(/const nodeTypes = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error('nodeTypes table not found in FlowArea.tsx');
  return new Set([...block[1].matchAll(/^\s*(\w+):/gm)].map(m => m[1]));
}

describe('the quick-add catalog', () => {
  it('reads the palette, rather than quietly finding nothing in it', () => {
    expect(SIDEBAR_PARTS.length).toBeGreaterThan(30);
    // One of each shape the scrape has to handle: a bare type, a type with a
    // seed label, a gate off the `.map`, and a rail off the other `.map`.
    expect(SIDEBAR_PARTS).toContainEqual({ type: 'ground', label: undefined });
    expect(SIDEBAR_PARTS).toContainEqual({ type: 'resistor', label: '1k' });
    expect(SIDEBAR_PARTS).toContainEqual({ type: 'xor', label: undefined });
    expect(SIDEBAR_PARTS).toContainEqual({ type: 'powerrail', label: '+3.3V' });
  });

  it('offers every part the palette does', () => {
    const missing = SIDEBAR_PARTS.filter(
      p => !PART_CATALOG.some(c => c.type === p.type && (c.label ?? '') === (p.label ?? '')),
    );
    expect(missing).toEqual([]);
  });

  it('offers nothing the canvas cannot render', () => {
    const types = registeredTypes();
    expect(PART_CATALOG.filter(p => !types.has(p.type)).map(p => p.type)).toEqual([]);
  });

  it('keys each entry uniquely, rails included', () => {
    const keys = PART_CATALOG.map(catalogKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('searching it', () => {
  const first = (q: string) => searchParts(q)[0]?.name;

  it('finds a part by its own name', () => {
    expect(first('resistor')).toBe('Resistor');
    expect(first('scope')).toBe('Oscilloscope');
  });

  it('finds one by what it is called elsewhere', () => {
    expect(first('gnd')).toBe('Ground');
    expect(first('pot')).toBe('Potentiometer');
    expect(first('ne555')).toBe('555 Timer');
    expect(first('mosfet')).toMatch(/MOS$/);
  });

  it('finds one from an abbreviation, which is the point of typing', () => {
    expect(first('sg')).toBe('Signal Generator');
    expect(first('555')).toBe('555 Timer');
    expect(first('5v')).toBe('+5V Rail');
  });

  it('ranks a name that starts with the query above one that merely contains it', () => {
    const names = searchParts('net').map(p => p.name);
    expect(names[0]).toBe('Net Label');
  });

  it('is case- and space-insensitive, and empty means everything', () => {
    expect(first(' LeD ')).toBe('LED');
    expect(searchParts('')).toHaveLength(PART_CATALOG.length);
  });

  it('returns nothing rather than everything when nothing matches', () => {
    expect(searchParts('zzqq')).toEqual([]);
  });
});
