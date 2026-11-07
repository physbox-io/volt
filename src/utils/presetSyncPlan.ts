/**
 * What it takes to bring one browser's saved presets and the account's level.
 *
 * Works from revisions, not clocks. Each browser remembers the revision of the
 * account's row its copy was built on and whether it has changed since, so "who
 * moved" is a fact rather than a comparison of two machines' clocks. Clocks are
 * the fallback only for a copy with no such record, from before there were any.
 *
 * Pure, so every case below can be tested without a browser or a server.
 */

/** One row of the account's list. */
export interface PresetRow {
  id: string;
  name: string;
  revision: number;
  /** The preset's own save date. Null when it has none. */
  savedAt: number | null;
  deleted?: boolean;
  updatedAt?: string;
}

/** What this browser remembers about a preset's place in the account. */
export interface PresetBase {
  id?: string;
  /** The revision of the row this copy was built on. */
  revision?: number;
  /** The account this was recorded under. Unset for a save made signed out. */
  user?: string;
  /** Changed here since `revision`: the account does not have it yet. */
  unsynced?: boolean;
  /** Deleted here, and the account has not been told yet. */
  deleted?: boolean;
}

export type PresetAction =
  /** The account should have this browser's copy. */
  | { kind: 'upload'; name: string; onto?: PresetRow }
  /** This browser should have the account's copy. */
  | { kind: 'fetch'; name: string; row: PresetRow }
  /** Both moved: neither copy may be lost. */
  | { kind: 'conflict'; name: string; row: PresetRow }
  /** Deleted elsewhere. */
  | { kind: 'removeLocal'; name: string }
  /** Deleted here. */
  | { kind: 'deleteRemote'; name: string; id: string }
  /** The two are already the same save. */
  | { kind: 'adopt'; name: string; row: PresetRow }
  /** A record with nothing left for it to describe. */
  | { kind: 'forget'; name: string };

/** The one row of a name that counts: the live one, latest first as the server lists them. */
function rowsByName(rows: PresetRow[]): Map<string, PresetRow> {
  const byName = new Map<string, PresetRow>();
  for (const row of rows) {
    const held = byName.get(row.name);
    if (!held || (held.deleted && !row.deleted)) byName.set(row.name, row);
  }
  return byName;
}

function planOne(
  name: string,
  held: { savedAt?: number } | undefined,
  base: PresetBase | undefined,
  row: PresetRow | undefined,
): PresetAction | null {
  const live = row && !row.deleted ? row : undefined;

  if (base?.deleted) {
    if (!live) return { kind: 'forget', name };
    // Saved elsewhere since this browser last saw it: the delete was of an older copy.
    if (base.revision !== undefined && live.revision > base.revision) return { kind: 'fetch', name, row: live };
    return { kind: 'deleteRemote', name, id: live.id };
  }

  if (!held) {
    if (live) return { kind: 'fetch', name, row: live };
    return base ? { kind: 'forget', name } : null;
  }

  if (!row) return { kind: 'upload', name };

  const known = base?.revision !== undefined && base.id === row.id;
  const savedAt = held.savedAt ?? 0;

  if (row.deleted) {
    if (known) return base.unsynced ? { kind: 'upload', name } : { kind: 'removeLocal', name };
    const deletedAt = row.updatedAt ? Date.parse(row.updatedAt) : 0;
    return savedAt > deletedAt ? { kind: 'upload', name } : { kind: 'removeLocal', name };
  }

  if (row.savedAt !== null && row.savedAt === held.savedAt) {
    return known && base.revision === row.revision && !base.unsynced ? null : { kind: 'adopt', name, row };
  }

  if (!known) {
    if (row.savedAt === null && !held.savedAt) return { kind: 'adopt', name, row };
    return savedAt > (row.savedAt ?? 0) ? { kind: 'upload', name, onto: row } : { kind: 'fetch', name, row };
  }

  if (row.revision > base.revision!) {
    return base.unsynced ? { kind: 'conflict', name, row } : { kind: 'fetch', name, row };
  }
  return base.unsynced ? { kind: 'upload', name } : null;
}

/**
 * Everything to do, for presets held here and rows the account lists.
 *
 * A preset recorded under another account is left alone: this browser may hold
 * it, but it is not this account's to take or to send.
 */
export function planPresetSync(
  held: Record<string, { savedAt?: number }>,
  bases: Record<string, PresetBase>,
  rows: PresetRow[],
  user: string,
): PresetAction[] {
  const byName = rowsByName(rows);
  const actions: PresetAction[] = [];
  for (const name of new Set([...Object.keys(held), ...Object.keys(bases), ...byName.keys()])) {
    const base = bases[name];
    if (base?.user && base.user !== user) continue;
    const action = planOne(name, Object.hasOwn(held, name) ? held[name] : undefined, base, byName.get(name));
    if (action) actions.push(action);
  }
  return actions;
}

/** A name for the other side of a conflict, clear of everything already saved. */
export function conflictCopyName(name: string, taken: (candidate: string) => boolean): string {
  const first = `${name} (other device)`;
  let candidate = first;
  for (let n = 2; taken(candidate); n++) candidate = `${first.slice(0, -1)} ${n})`;
  return candidate;
}
