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
// Both are reached through unknown: the shims are only the members the code
// under test touches, not the whole Storage and Window interfaces.
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
(globalThis as unknown as { window: { dispatchEvent: (event: Event) => boolean } }).window = {
  dispatchEvent: () => true,
};

// The module uploads through cloudSync on every save; the merge rule under test
// is purely local, so the network half is stubbed out.
const connected = vi.hoisted(() => ({ store: null as unknown as import('../src/utils/presetSync').PresetStore }));

vi.mock('../src/utils/cloudSync', () => ({
  PRESETS_UPDATED_EVENT: 'physbox:presets-updated',
  saveCloudPreset: vi.fn(),
  removeCloudPreset: vi.fn(),
  presetSync: { connect: (s: PresetStore) => { connected.store = s; } },
}));

import { addUserPreset, loadUserPresets, nameToKey, type CircuitPreset } from '../src/utils/storage';
import type { PresetStore } from '../src/utils/presetSync';

const preset = (label: string, savedAt?: number): CircuitPreset => ({
  name: label,
  nodes: [{ id: label, type: 'resistor', position: { x: 0, y: 0 }, data: {} }],
  edges: [],
  ...(savedAt === undefined ? {} : { savedAt }),
});


beforeEach(() => {
  localStorage.clear();
});

describe('what a pull announces', () => {
  it('names the presets it replaced, not the ones it only added', () => {
    const events: CustomEvent[] = [];
    const dispatch = vi.spyOn(window, 'dispatchEvent').mockImplementation((e) => {
      events.push(e as CustomEvent);
      return true;
    });
    addUserPreset(nameToKey('held'), preset('old', 1000), { keepDate: true });
    events.length = 0;

    connected.store.changed([nameToKey('held')]);

    expect(events[0].detail).toEqual({ refreshed: [nameToKey('held')] });
    dispatch.mockRestore();
  });
});

describe('addUserPreset', () => {
  it('dates every save, so the next merge can order them', () => {
    const before = Date.now();
    addUserPreset('user_a', preset('local'));
    const savedAt = loadUserPresets().user_a.savedAt!;
    expect(savedAt).toBeGreaterThanOrEqual(before);
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
