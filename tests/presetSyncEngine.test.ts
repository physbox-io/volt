import { describe, it, expect, vi, beforeEach } from 'vitest';
import { conflictCopyName, planPresetSync, type PresetRow } from '../src/utils/presetSyncPlan';

/** The account's rows and what this browser holds, played through two machines' worth of cases. */

const server = vi.hoisted(() => ({
  rows: new Map<string, { id: string; name: string; revision: number; savedAt: number | null; deleted?: boolean; updatedAt?: string; data: unknown }>(),
  offline: false,
  nextId: 1,
  saves: [] as { name: string; id?: string; baseRevision?: number }[],
  fetches: 0,
  user: 'me' as string | null,
}));

vi.mock('../src/utils/apiClient', () => ({
  getStoredUser: () => (server.user ? { id: server.user } : null),
  fetchCloudPresetList: async () => {
    if (server.offline) throw new Error('offline');
    return [...server.rows.values()].map(({ data: _data, ...row }) => row);
  },
  fetchCloudPreset: async (id: string) => {
    server.fetches += 1;
    if (server.offline) return null;
    const row = [...server.rows.values()].find((r) => r.id === id);
    return row && !row.deleted ? { data: row.data, revision: row.revision } : null;
  },
  deleteCloudPreset: async (id: string) => {
    if (server.offline) return false;
    const row = [...server.rows.values()].find((r) => r.id === id);
    if (!row) return false;
    row.deleted = true;
    row.revision += 1;
    row.updatedAt = new Date(9e12).toISOString();
    return true;
  },
  syncCloudPreset: async (_app: string, name: string, data: { savedAt?: number }, id?: string, baseRevision?: number) => {
    if (server.offline) return null;
    server.saves.push({ name, id, baseRevision });
    const row = server.rows.get(name);
    if (row && !row.deleted && baseRevision !== undefined && baseRevision !== row.revision) {
      return { conflict: { id: row.id, revision: row.revision } };
    }
    const revision = (row?.revision ?? 0) + 1;
    const next = { id: row?.id ?? `pst_${server.nextId++}`, name, revision, savedAt: data.savedAt ?? null, data };
    server.rows.set(name, next);
    return { id: next.id, revision };
  },
}));

const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v),
  removeItem: (k: string) => storage.delete(k),
});

/** One machine: its own presets and its own record of where they stand. */
async function machine() {
  vi.resetModules();
  const { PresetSync } = await import('../src/utils/presetSync');
  const sync = new PresetSync('app', `bases_${Math.random()}`);
  const held: Record<string, { savedAt?: number; body?: string }> = {};
  const refreshed: string[][] = [];
  sync.connect({
    held: () => held,
    read: async (name) => held[name] ?? null,
    write: (name, data) => {
      held[name] = data as { savedAt?: number };
      return true;
    },
    remove: (name) => {
      delete held[name];
    },
    changed: (names) => refreshed.push(names),
  });
  const save = async (name: string, savedAt: number, body = 'x') => {
    held[name] = { savedAt, body };
    sync.noteSaved(name);
    return sync.upload(name, held[name]);
  };
  const del = async (name: string) => {
    delete held[name];
    await sync.remove(name);
  };
  return { sync, held, save, del, refreshed };
}

beforeEach(() => {
  server.rows.clear();
  server.offline = false;
  server.saves.length = 0;
  server.fetches = 0;
  server.user = 'me';
  storage.clear();
});

describe('between two machines', () => {
  it('carries a new save and a re-save across', async () => {
    const a = await machine();
    const b = await machine();
    await a.save('tray', 1000, 'first');
    await b.sync.pull();
    expect(b.held.tray.body).toBe('first');

    await a.save('tray', 2000, 'second');
    await b.sync.pull();
    expect(b.held.tray.body).toBe('second');
    expect(b.refreshed.at(-1)).toEqual(['tray']);
  });

  it('downloads nothing when there is nothing new, including a machine\'s own save', async () => {
    const a = await machine();
    await a.save('tray', 1000);
    await a.sync.pull();
    await a.sync.pull();
    expect(server.fetches).toBe(0);
  });

  it('uploads a save the account missed, at the next pull', async () => {
    const a = await machine();
    server.offline = true;
    expect(await a.save('tray', 1000)).toBe(false);
    server.offline = false;

    await a.sync.pull();
    expect(server.rows.get('tray')?.savedAt).toBe(1000);
    expect(a.sync.isUnsynced('tray')).toBe(false);
  });

  it('uploads what was saved before signing in', async () => {
    server.user = null;
    const a = await machine();
    await a.save('tray', 1000);
    server.user = 'me';

    await a.sync.pull();
    expect(server.rows.get('tray')?.savedAt).toBe(1000);
  });

  it('carries a delete across', async () => {
    const a = await machine();
    const b = await machine();
    await a.save('tray', 1000);
    await b.sync.pull();

    await a.del('tray');
    await b.sync.pull();
    expect(b.held.tray).toBeUndefined();
  });

  it('carries a rename across without leaving the old name', async () => {
    const a = await machine();
    const b = await machine();
    await a.save('tray', 1000);
    await b.sync.pull();

    await a.save('dish', 1000);
    await a.del('tray');
    await b.sync.pull();
    expect(Object.keys(b.held)).toEqual(['dish']);
  });

  it('sends a delete that failed at the next pull, instead of bringing the preset back', async () => {
    const a = await machine();
    await a.save('tray', 1000);
    server.offline = true;
    await a.del('tray');
    server.offline = false;

    await a.sync.pull();
    expect(a.held.tray).toBeUndefined();
    expect(server.rows.get('tray')?.deleted).toBe(true);
  });

  it('lets a delete of an older copy lose to a later save elsewhere', async () => {
    const a = await machine();
    const b = await machine();
    await a.save('tray', 1000);
    await b.sync.pull();
    server.offline = true;
    await b.del('tray');
    server.offline = false;
    await a.save('tray', 2000, 'later');

    await b.sync.pull();
    expect(b.held.tray.body).toBe('later');
    expect(server.rows.get('tray')?.deleted).toBeUndefined();
  });

  it('keeps both when a stale machine saves, under a name that says so', async () => {
    const a = await machine();
    const b = await machine();
    await a.save('tray', 1000);
    await b.sync.pull();
    await a.save('tray', 2000, 'theirs');

    expect(await b.save('tray', 3000, 'mine')).toBe(true);
    expect(b.held.tray.body).toBe('mine');
    expect(b.held['tray (other device)'].body).toBe('theirs');
    expect(server.rows.get('tray')?.savedAt).toBe(3000);

    await a.sync.pull();
    expect(a.held.tray.body).toBe('mine');
    expect(a.held['tray (other device)'].body).toBe('theirs');
  });

  it('keeps both when the conflict is found at a pull', async () => {
    const a = await machine();
    const b = await machine();
    await a.save('tray', 1000);
    await b.sync.pull();
    server.offline = true;
    await b.save('tray', 3000, 'mine');
    server.offline = false;
    await a.save('tray', 2000, 'theirs');

    await b.sync.pull();
    expect(b.held.tray.body).toBe('mine');
    expect(b.held['tray (other device)'].body).toBe('theirs');
  });

  it('lets an edit here beat a delete elsewhere', async () => {
    const a = await machine();
    const b = await machine();
    await a.save('tray', 1000);
    await b.sync.pull();
    server.offline = true;
    await b.save('tray', 2000, 'edited');
    server.offline = false;
    await a.del('tray');

    await b.sync.pull();
    expect(server.rows.get('tray')).toMatchObject({ savedAt: 2000 });
    expect(server.rows.get('tray')?.deleted).toBeUndefined();
  });

  it('runs saves of one preset in order, each on the revision before it', async () => {
    const a = await machine();
    a.held.tray = { savedAt: 1 };
    a.sync.noteSaved('tray');
    await Promise.all([a.sync.upload('tray', { savedAt: 1 }), a.sync.upload('tray', { savedAt: 2 })]);
    expect(server.saves.map((s) => s.baseRevision)).toEqual([0, 1]);
    expect(server.rows.size).toBe(1);
  });

  it('leaves another account\'s presets alone', async () => {
    const a = await machine();
    await a.save('tray', 1000);
    server.user = 'someone else';
    server.rows.clear();

    await a.sync.pull();
    expect(server.rows.size).toBe(0);
    expect(a.held.tray).toBeDefined();

    await a.save('tray', 2000);
    expect(server.saves.at(-1)).toMatchObject({ id: undefined, baseRevision: 0 });
  });

  it('remembers ids for the session when the browser has no room for them', async () => {
    const a = await machine();
    const setItem = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error('quota');
    };
    await a.save('tray', 1000);
    await a.save('tray', 2000);
    localStorage.setItem = setItem;
    expect(server.saves.at(-1)?.baseRevision).toBe(1);
    expect(a.sync.idOf('tray')).toBe(server.rows.get('tray')?.id);
  });

  it('reads the ids recorded before revisions', async () => {
    const a = await machine();
    await a.save('tray', 1000);
    await a.sync.pull();
    const key = [...storage.keys()].find((k) => k.startsWith('bases_'))!;
    storage.set(key, JSON.stringify({ tray: server.rows.get('tray')?.id }));

    await a.sync.pull();
    expect(server.fetches).toBe(0);
    expect(JSON.parse(storage.get(key)!).tray.revision).toBe(1);
  });
});

describe('planning', () => {
  const row = (over: Partial<PresetRow> = {}): PresetRow => ({ id: 'r', name: 'tray', revision: 2, savedAt: 2000, ...over });
  const plan = (held: object, base: object | null, rows: PresetRow[]) =>
    planPresetSync({ tray: held } as never, base ? { tray: base } : {}, rows, 'me').map((a) => a.kind);

  it('goes by clocks only for a copy with no record', () => {
    expect(plan({ savedAt: 3000 }, null, [row()])).toEqual(['upload']);
    expect(plan({ savedAt: 1000 }, null, [row()])).toEqual(['fetch']);
    expect(plan({ savedAt: 9000 }, { id: 'r', revision: 1 }, [row()])).toEqual(['fetch']);
  });

  it('counts the same save as level, whatever the record says', () => {
    expect(plan({ savedAt: 2000 }, { id: 'r', revision: 1, unsynced: true }, [row()])).toEqual(['adopt']);
    expect(plan({ savedAt: 2000 }, { id: 'r', revision: 2 }, [row()])).toEqual([]);
  });

  it('takes a delete made before this browser kept records, unless saved here since', () => {
    const gone = row({ deleted: true, updatedAt: new Date(5000).toISOString() });
    expect(plan({ savedAt: 1000 }, null, [gone])).toEqual(['removeLocal']);
    expect(plan({ savedAt: 9000 }, null, [gone])).toEqual(['upload']);
  });

  it('treats a live row over a deleted one of the same name as the one that counts', () => {
    const kinds = planPresetSync({}, {}, [row({ id: 'a', deleted: true }), row({ id: 'b' })], 'me');
    expect(kinds).toMatchObject([{ kind: 'fetch', row: { id: 'b' } }]);
  });

  it('finds a copy name clear of what is saved', () => {
    const taken = new Set(['tray (other device)', 'tray (other device 2)']);
    expect(conflictCopyName('tray', (n) => taken.has(n))).toBe('tray (other device 3)');
  });
});
