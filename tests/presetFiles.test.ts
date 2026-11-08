import { describe, it, expect, beforeEach, vi } from 'vitest';

// Node, as for presetSync.test.ts: localStorage and window are stubbed to the
// members storage and the recents touch.
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
(globalThis as unknown as { window: { dispatchEvent: (event: Event) => boolean } }).window = {
  dispatchEvent: () => true,
};
// The session is a suite cookie, so a cookie jar: a write sets or (Max-Age=0) deletes one.
const jar = new Map<string, string>();
(globalThis as unknown as { document: { cookie: string } }).document = {
  get cookie() {
    return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  },
  set cookie(line: string) {
    const [pair, ...attrs] = line.split(';').map((s) => s.trim());
    const eq = pair.indexOf('=');
    if (attrs.includes('Max-Age=0')) jar.delete(pair.slice(0, eq));
    else jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  },
};

vi.mock('../src/utils/cloudSync', () => ({
  PRESETS_UPDATED_EVENT: 'physbox:presets-updated',
  saveCloudPreset: vi.fn(),
  removeCloudPreset: vi.fn(),
  presetSync: { connect: vi.fn() },
}));

import {
  addUserPreset, loadUserPresets, nameToKey, noRoomMessage, removeUserPreset, renameUserPreset, duplicateUserPreset,
  takeLastWriteFailed, userPresetName,
  type CircuitPreset,
} from '../src/utils/storage';
import { listRecent, recordRecent } from '../src/utils/recentCircuits';
import { clearStoredAuth, setStoredAuth } from '../src/utils/apiClient';

const preset = (name: string): CircuitPreset => ({
  name: `User: ${name}`,
  nodes: [{ id: name, type: 'resistor', position: { x: 0, y: 0 }, data: {} }],
  edges: [],
  thumbnail: 'data:image/jpeg;base64,xyz',
});

const save = (name: string) => addUserPreset(nameToKey(name), preset(name));
const names = () => Object.values(loadUserPresets()).map(userPresetName).sort();

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('renameUserPreset', () => {
  it('moves the circuit, its date, its picture and its place in the recents', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    save('Amp');
    recordRecent(nameToKey('Amp'));
    vi.setSystemTime(5000);

    const result = renameUserPreset(nameToKey('Amp'), 'Big amp');
    expect(result).toEqual({ ok: true, key: 'user_big_amp', name: 'Big amp' });
    const all = loadUserPresets();
    expect(Object.keys(all)).toEqual(['user_big_amp']);
    expect(all.user_big_amp.name).toBe('User: Big amp');
    expect(all.user_big_amp.savedAt).toBe(1000);
    expect(all.user_big_amp.thumbnail).toBe('data:image/jpeg;base64,xyz');
    expect(all.user_big_amp.nodes[0].id).toBe('Amp');
    expect(listRecent().map((r) => r.id)).toEqual(['user_big_amp']);
  });

  it('refuses a name another circuit already has, and keeps both', () => {
    save('Amp');
    save('Filter');
    const result = renameUserPreset(nameToKey('Amp'), 'filter');
    expect(result.ok).toBe(false);
    expect(names()).toEqual(['Amp', 'Filter']);
  });

  it('refuses an empty name', () => {
    save('Amp');
    expect(renameUserPreset(nameToKey('Amp'), '   ').ok).toBe(false);
    expect(names()).toEqual(['Amp']);
  });

  it('changes only the shown name when the key stays the same', () => {
    save('amp');
    const result = renameUserPreset('user_amp', 'Amp');
    expect(result).toEqual({ ok: true, key: 'user_amp', name: 'Amp' });
    expect(names()).toEqual(['Amp']);
  });
});

describe('duplicateUserPreset', () => {
  it('saves a copy under a free name, leaving the original', () => {
    save('Amp');
    save('Amp copy');
    const result = duplicateUserPreset(nameToKey('Amp'));
    expect(result).toEqual({ ok: true, key: 'user_amp_copy_2', name: 'Amp copy 2' });
    expect(names()).toEqual(['Amp', 'Amp copy', 'Amp copy 2']);
    expect(loadUserPresets().user_amp_copy_2.nodes[0].id).toBe('Amp');
  });

  it('steps past a name whose key is taken by different punctuation', () => {
    save('Amp');
    save('Amp-copy');
    const result = duplicateUserPreset(nameToKey('Amp'));
    expect(result.ok && result.key).toBe('user_amp_copy_2');
    expect(Object.keys(loadUserPresets())).toHaveLength(3);
  });
});

describe('recents', () => {
  it('keeps the newest first, once each, and forgets a deleted circuit', () => {
    save('Amp');
    recordRecent('user_amp', 1);
    recordRecent('basicBlink', 2);
    recordRecent('user_amp', 3);
    recordRecent('empty', 4);
    expect(listRecent().map((r) => r.id)).toEqual(['user_amp', 'basicBlink']);
    removeUserPreset('user_amp');
    expect(listRecent().map((r) => r.id)).toEqual(['basicBlink']);
  });
});

describe('a browser with no room left', () => {
  const refuseWrites = () => vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new DOMException('full', 'QuotaExceededError');
  });

  it('says a save did not land, rather than listing a circuit it cannot keep', () => {
    save('kept');
    const refused = refuseWrites();
    const list = addUserPreset(nameToKey('new'), preset('new'));
    refused.mockRestore();
    expect(takeLastWriteFailed()).toBe(true);
    expect(takeLastWriteFailed()).toBe(false);
    expect(Object.keys(list)).toEqual([nameToKey('kept')]);
  });

  it('keeps the original when a rename cannot be written', () => {
    save('amp');
    const refused = refuseWrites();
    const result = renameUserPreset(nameToKey('amp'), 'filter');
    refused.mockRestore();
    expect(result).toEqual({ ok: false, message: noRoomMessage('filter') });
    expect(names()).toEqual(['amp']);
  });

  it('leaves a circuit with the account when there is one, listed for the session', () => {
    setStoredAuth('token', { id: 'u1', email: 'a@b.c', subscription_tier: 'early_access' });
    const refused = refuseWrites();
    const list = addUserPreset(nameToKey('big'), preset('big'));
    refused.mockRestore();
    clearStoredAuth();
    expect(takeLastWriteFailed()).toBe(false);
    expect(Object.keys(list)).toContain(nameToKey('big'));
    expect(names()).toContain('big');
    removeUserPreset(nameToKey('big'));
  });
});
