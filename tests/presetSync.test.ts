import { describe, it, expect, beforeEach, vi } from 'vitest';

/*
 * The suite runs in node (see vitest.config.ts) because everything else under
 * test is pure geometry. Storage is the exception: it is localStorage and a
 * window event by design, so those two are stubbed here rather than moving the
 * whole suite to jsdom for one file.
 */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
(globalThis as any).localStorage = new MemoryStorage();
(globalThis as any).window = { dispatchEvent: () => true };

// The module uploads through cloudSync on every save; the merge rule under test
// is purely local, so the network half is stubbed out.
vi.mock('../src/utils/cloudSync', () => ({
  PRESETS_UPDATED_EVENT: 'physbox:presets-updated',
  saveCloudPreset: vi.fn(),
  removeCloudPreset: vi.fn(),
}));

import { addUserPreset, mergePulledPresets, loadUserPresets, nameToKey, type CircuitPreset } from '../src/utils/storage';

const preset = (label: string, savedAt?: number): CircuitPreset => ({
  name: label,
  nodes: [{ id: label, type: 'resistor', position: { x: 0, y: 0 }, data: {} }] as any,
  edges: [],
  ...(savedAt === undefined ? {} : { savedAt }),
});

const labelOf = (key: string) => loadUserPresets()[key]?.nodes[0]?.id;

beforeEach(() => {
  localStorage.clear();
});

describe('mergePulledPresets', () => {
  it('adds a preset this browser has never seen', () => {
    expect(mergePulledPresets({ user_a: preset('cloud') })).toBe(1);
    expect(labelOf('user_a')).toBe('cloud');
  });

  it('takes the cloud copy when it was saved later', () => {
    localStorage.setItem('circuitexpt_user_presets', JSON.stringify({ user_a: preset('local', 1000) }));
    expect(mergePulledPresets({ user_a: preset('cloud', 2000) })).toBe(1);
    expect(labelOf('user_a')).toBe('cloud');
  });

  // The case the old additive rule existed to protect: an edit made offline is
  // newer than the account's copy, and must not be rolled back by a pull.
  it('keeps a local edit that is newer than the account', () => {
    localStorage.setItem('circuitexpt_user_presets', JSON.stringify({ user_a: preset('local', 3000) }));
    expect(mergePulledPresets({ user_a: preset('cloud', 2000) })).toBe(0);
    expect(labelOf('user_a')).toBe('local');
  });

  it('leaves the local copy alone when neither is dated', () => {
    localStorage.setItem('circuitexpt_user_presets', JSON.stringify({ user_a: preset('local') }));
    expect(mergePulledPresets({ user_a: preset('cloud') })).toBe(0);
    expect(labelOf('user_a')).toBe('local');
  });

  it('never lets an undated cloud copy overwrite a dated local one', () => {
    localStorage.setItem('circuitexpt_user_presets', JSON.stringify({ user_a: preset('local', 1000) }));
    expect(mergePulledPresets({ user_a: preset('cloud') })).toBe(0);
    expect(labelOf('user_a')).toBe('local');
  });

  it('same timestamp is not newer, so the local copy stands', () => {
    localStorage.setItem('circuitexpt_user_presets', JSON.stringify({ user_a: preset('local', 2000) }));
    expect(mergePulledPresets({ user_a: preset('cloud', 2000) })).toBe(0);
    expect(labelOf('user_a')).toBe('local');
  });
});

describe('addUserPreset', () => {
  it('dates every save, so the next merge can order them', () => {
    const before = Date.now();
    addUserPreset('user_a', preset('local'));
    const savedAt = loadUserPresets().user_a.savedAt!;
    expect(savedAt).toBeGreaterThanOrEqual(before);
  });

  it('a save on this machine beats the copy the account already held', () => {
    addUserPreset('user_a', preset('local'));
    expect(mergePulledPresets({ user_a: preset('cloud', 1000) })).toBe(0);
    expect(labelOf('user_a')).toBe('local');
  });
});

describe('nameToKey', () => {
  it('prefixes a plain name', () => {
    expect(nameToKey('TeknoBox Final')).toBe('user_teknobox_final');
  });

  it('is idempotent, so saving over a listed preset overwrites it', () => {
    // Presets are listed by key, so the obvious thing to do with a name read
    // off that list is pass it back to save over it. Prefixing unconditionally
    // turned user_teknobox_fixed into user_user_teknobox_fixed and forked a
    // second preset, leaving the first looking as though it had been reverted.
    const key = nameToKey('teknobox_final');
    expect(nameToKey(key)).toBe(key);
    expect(nameToKey('user_teknobox_fixed')).toBe('user_teknobox_fixed');
  });
});
