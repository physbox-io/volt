/**
 * Keeps this browser's saved presets and the account's level, in both directions.
 *
 * `presetSyncPlan` decides what to do; this does it. The app supplies a
 * `PresetStore` because this module sits below whatever holds its presets, which
 * saves and deletes through here.
 *
 * Every save and delete is recorded before it is sent and cleared once the
 * account has it, so one that fails is still owed and goes at the next pull,
 * whenever that is. Work on one preset runs one at a time, so a second save
 * builds on the revision the first came back with.
 */

import {
  deleteCloudPreset,
  fetchCloudPreset,
  fetchCloudPresetList,
  getStoredUser,
  syncCloudPreset,
} from './apiClient';
import { conflictCopyName, planPresetSync, type PresetBase, type PresetRow } from './presetSyncPlan';

/** What sync needs from wherever the app keeps its presets. */
export interface PresetStore {
  /** What is held here, by name, with each one's save date. */
  held(): Record<string, { savedAt?: number }>;
  /** A held preset as it goes to the account. Null when it has gone. */
  read(name: string): Promise<unknown>;
  /** Puts the account's copy in place of what is held. False when there was no room. */
  write(name: string, data: unknown): boolean;
  remove(name: string): void;
  /**
   * For an app that fetches a preset when it is opened rather than now: notes
   * that this row exists, and says whether that changed anything. Null fetches now.
   */
  deferFetch?(name: string, row: PresetRow, base: PresetBase | undefined): { changed: boolean } | null;
  /** The list as it came, for anything the app shows from it. */
  listed?(rows: PresetRow[]): void;
  /** A preset's data under a new name, for one whose data carries it. */
  renamed?(data: unknown, name: string): unknown;
  /** A preset's data as it came from the account, ready to be held. Null when part of it would not come. */
  fromCloud?(data: unknown, blobUrls?: Record<string, string>): Promise<unknown>;
  /** Called after anything arrived, with the presets replaced. */
  changed(refreshed: string[]): void;
}

/** Fired when two saves of a preset could not both keep its name. */
export const PRESET_KEPT_BOTH_EVENT = 'physbox:preset-kept-both';

export interface PresetSyncResult {
  /** Presets that arrived or changed here. */
  received: number;
  /** Presets the account took. */
  sent: number;
}

function readBases(key: string): Record<string, PresetBase> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, PresetBase | string>;
    const bases: Record<string, PresetBase> = {};
    // A bare string is the id alone, as it was recorded before revisions.
    for (const [name, base] of Object.entries(parsed)) bases[name] = typeof base === 'string' ? { id: base } : base;
    return bases;
  } catch {
    return {};
  }
}

export class PresetSync {
  private store: PresetStore | null = null;
  /** Records held here until localStorage has room for them, so a full browser still knows its ids. */
  private unwritten: Record<string, PresetBase> | null = null;
  /** The last piece of work on each preset; the next one waits for it. */
  private queues = new Map<string, Promise<unknown>>();
  /** Refused for good this session, such as for being too big. Not offered again until a reload. */
  private refused = new Set<string>();
  private pulling: Promise<PresetSyncResult> | null = null;

  private readonly appId: string;
  private readonly storageKey: string;

  constructor(appId: string, storageKey: string) {
    this.appId = appId;
    this.storageKey = storageKey;
  }

  connect(store: PresetStore): void {
    this.store = store;
  }

  private bases(): Record<string, PresetBase> {
    return this.unwritten ?? readBases(this.storageKey);
  }

  private writeBases(bases: Record<string, PresetBase>): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(bases));
      this.unwritten = null;
    } catch {
      this.unwritten = bases;
    }
  }

  private patch(name: string, base: PresetBase | null): void {
    const bases = this.bases();
    if (base) bases[name] = base;
    else delete bases[name];
    this.writeBases(bases);
  }

  private inTurn<T>(name: string, work: () => Promise<T>): Promise<T> {
    const turn = (this.queues.get(name) ?? Promise.resolve()).then(work, work);
    const tail = turn.catch(() => {}).finally(() => {
      if (this.queues.get(name) === tail) this.queues.delete(name);
    });
    this.queues.set(name, tail);
    return turn;
  }

  /** The id a preset's data is fetched by. */
  idOf(name: string): string | undefined {
    return this.bases()[name]?.id;
  }

  /** Whether this copy has changes the account does not have yet. */
  isUnsynced(name: string): boolean {
    return Boolean(this.bases()[name]?.unsynced);
  }

  /** A save has landed here, and is now owed to the account. */
  noteSaved(name: string): void {
    const base = this.bases()[name];
    this.refused.delete(name);
    this.patch(name, { ...this.ownBase(base), unsynced: true, deleted: undefined });
  }

  /** The record as this account may build on it: one of another account's starts over. */
  private ownBase(base: PresetBase | undefined): PresetBase {
    const user = getStoredUser()?.id;
    return base?.user && user && base.user !== user ? {} : { ...base };
  }

  /**
   * Uploads a preset this browser holds. True when the account took it, which
   * includes keeping both sides of a conflict.
   */
  upload(name: string, data: unknown): Promise<boolean> {
    return this.inTurn(name, () => this.send(name, data));
  }

  private async send(name: string, data: unknown, onto?: PresetRow): Promise<boolean> {
    const user = getStoredUser()?.id;
    if (!user) return false;
    const base = this.ownBase(this.bases()[name]);
    const id = onto?.id ?? base.id;
    const baseRevision = onto?.revision ?? base.revision ?? 0;
    const result = await syncCloudPreset(this.appId, name, data, id, baseRevision);
    if (result === null) return false;
    if ('refused' in result) {
      this.refused.add(name);
      return false;
    }
    if ('conflict' in result) {
      const row: PresetRow = { id: result.conflict.id, name, revision: result.conflict.revision, savedAt: null };
      return this.keepBoth(name, row, data);
    }
    // A save made or a delete asked for while this one was on its way is still owed.
    const unsynced = this.savedSince(name, data);
    const { deleted } = this.bases()[name] ?? {};
    this.patch(name, { id: result.id, revision: result.revision, user, unsynced: unsynced || undefined, deleted });
    return true;
  }

  private savedSince(name: string, sent: unknown): boolean {
    const savedAt = (sent as { savedAt?: number } | null)?.savedAt;
    const held = this.store?.held();
    return savedAt !== undefined && !!held && Object.hasOwn(held, name) && held[name].savedAt !== savedAt;
  }

  /** The account's save goes under a new name, here and there, and this browser's keeps the name. */
  private async keepBoth(name: string, row: PresetRow, data: unknown): Promise<boolean> {
    const store = this.store;
    if (!store) return false;
    const theirs = await this.fetchRow(row.id);
    if (!theirs) return false;
    const copy = conflictCopyName(name, (candidate) => Object.hasOwn(store.held(), candidate));
    const named = (doc: unknown) => (store.renamed ? store.renamed(doc, copy) : doc);
    if (!store.write(copy, named(theirs.data))) return false;
    this.patch(copy, { unsynced: true });
    void this.upload(copy, named(theirs.sent));
    store.changed([]);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(PRESET_KEPT_BOTH_EVENT, { detail: { name, copy } }));
    }
    return this.send(name, data, { ...row, revision: theirs.revision });
  }

  private async fetchRow(id: string): Promise<{ data: unknown; sent: unknown; revision: number } | null> {
    const preset = await fetchCloudPreset(id);
    if (!preset?.data || typeof preset.data !== 'object') return null;
    const data = this.store?.fromCloud ? await this.store.fromCloud(preset.data, preset.blobUrls) : preset.data;
    return data ? { data, sent: preset.data, revision: preset.revision ?? 0 } : null;
  }

  /** A delete here, owed to the account until it has it. */
  remove(name: string): Promise<void> {
    this.refused.delete(name);
    this.patch(name, { ...this.ownBase(this.bases()[name]), unsynced: undefined, deleted: true });
    return this.inTurn(name, () => this.sendDelete(name)).then(() => undefined);
  }

  private async sendDelete(name: string): Promise<boolean> {
    const id = this.bases()[name]?.id;
    if (!id) return false;
    const deleted = await deleteCloudPreset(id);
    if (deleted) this.patch(name, null);
    return deleted;
  }

  /** The account's latest copy of a preset, once. Null when it cannot be had or is already held. */
  async fetchLatest(name: string): Promise<unknown> {
    return this.inTurn(name, async () => {
      const base = this.bases()[name];
      if (!base?.id) return null;
      const got = await this.fetchRow(base.id);
      if (!got) return null;
      this.patch(name, { ...base, revision: got.revision, user: getStoredUser()?.id });
      return got.data;
    });
  }

  /** Lists the account and does whatever it takes to bring the two level. Throws if it cannot be listed. */
  pull(): Promise<PresetSyncResult> {
    this.pulling ??= this.runPull().finally(() => {
      this.pulling = null;
    });
    return this.pulling;
  }

  private async runPull(): Promise<PresetSyncResult> {
    const result: PresetSyncResult = { received: 0, sent: 0 };
    const store = this.store;
    const user = getStoredUser()?.id;
    if (!store || !user) return result;
    const rows = await fetchCloudPresetList(this.appId);
    store.listed?.(rows);
    const refreshed: string[] = [];
    const actions = planPresetSync(store.held(), this.bases(), rows, user);
    for (const action of actions) {
      const { name } = action;
      if (this.refused.has(name)) continue;
      await this.inTurn(name, async () => {
        switch (action.kind) {
          case 'forget':
            this.patch(name, null);
            store.remove(name);
            break;
          case 'adopt':
            this.patch(name, { id: action.row.id, revision: action.row.revision, user });
            break;
          case 'removeLocal':
            store.remove(name);
            this.patch(name, null);
            result.received += 1;
            break;
          case 'deleteRemote':
            await deleteCloudPreset(action.id).then((ok) => ok && this.patch(name, null));
            break;
          case 'upload': {
            const data = await store.read(name);
            if (data && (await this.send(name, data, action.onto))) result.sent += 1;
            break;
          }
          case 'conflict': {
            const data = await store.read(name);
            if (data && (await this.keepBoth(name, action.row, data))) result.sent += 1;
            break;
          }
          case 'fetch': {
            const base = this.bases()[name];
            const deferred = store.deferFetch?.(name, action.row, base);
            if (deferred) {
              this.patch(name, { ...base, id: action.row.id, user });
              if (deferred.changed) result.received += 1;
              break;
            }
            const held = Object.hasOwn(store.held(), name);
            const got = await this.fetchRow(action.row.id);
            if (!got || !store.write(name, got.data)) break;
            this.patch(name, { id: action.row.id, revision: got.revision, user });
            if (held) refreshed.push(name);
            result.received += 1;
            break;
          }
        }
      });
    }
    if (result.received > 0) store.changed(refreshed);
    return result;
  }
}
