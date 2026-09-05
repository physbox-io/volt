/**
 * Cloud preset sync for Volt.
 *
 * `apiClient` has exported `syncCloudPreset`, `fetchCloudPresets` and
 * `deleteCloudPreset` since it was written, and in this app nothing ever called
 * any of them — the functions were dead code and circuits were localStorage-only,
 * while Etch and Mesh had both halves. So signing in on a second machine restored
 * nothing here, and the account menu said otherwise.
 *
 * Ported from `physics/src/utils/cloudSync.ts`, including the two things that
 * module learned the hard way: presets are addressed by the id the *server* gave
 * them, and a pull never overwrites a local preset of the same name.
 *
 * It deliberately does not import `storage`: that module saves and deletes through
 * here, so a dependency the other way would be a cycle. Pulled presets are handed
 * back to the caller.
 */

import { fetchCloudPresets, syncCloudPreset, deleteCloudPreset } from './apiClient';
import type { CircuitPreset } from './storage';

/**
 * Maps a preset's key to the id the server gave it.
 *
 * Needed because deleting would otherwise have to guess: the app saves under its
 * own key, the server generates its own id, and deleting by key matches nothing —
 * leaving the preset in the account forever, ready to be pulled straight back down
 * on the next sign-in.
 */
const PRESET_ID_MAP_KEY = 'circuitexpt_cloud_preset_ids';

/**
 * Fired after a pull has merged presets into localStorage.
 *
 * The preset list lives in React state inside `usePresets`, seeded once from
 * localStorage — so writing to storage behind it changes nothing on screen. This
 * is how the hook finds out. A same-tab write does not fire a `storage` event, and
 * a custom name is clearer than overloading that one.
 */
export const PRESETS_UPDATED_EVENT = 'physbox:presets-updated';

function readPresetIdMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(PRESET_ID_MAP_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writePresetIdMap(map: Record<string, string>): void {
  try {
    localStorage.setItem(PRESET_ID_MAP_KEY, JSON.stringify(map));
  } catch {
    // Non-fatal: deletes fall back to leaving the cloud copy in place.
  }
}

function rememberPresetId(key: string, id: string): void {
  const map = readPresetIdMap();
  if (map[key] === id) return;
  map[key] = id;
  writePresetIdMap(map);
}

/** Uploads a saved preset and records the id the server assigned it. */
export async function saveCloudPreset(key: string, preset: CircuitPreset): Promise<void> {
  const existingId = readPresetIdMap()[key];
  const id = await syncCloudPreset('circuit', key, preset, existingId);
  if (id) rememberPresetId(key, id);
}

/** Deletes the cloud copy of a preset, by its real server id. */
export async function removeCloudPreset(key: string): Promise<void> {
  const map = readPresetIdMap();
  const id = map[key];
  if (!id) return;
  const deleted = await deleteCloudPreset(id);
  if (deleted) {
    delete map[key];
    writePresetIdMap(map);
  }
}

/**
 * Pulls the account's saved circuits.
 *
 * Returned rather than written, so the caller decides how to merge — additively,
 * leaving anything already saved in this browser alone. Taking the cloud copy
 * instead would be the wrong call for the case that actually happens: edits made
 * while offline are newer than what the account holds, and overwriting them loses
 * work to restore a stale copy. Ids for skipped keys are still recorded, so
 * deleting them later removes the cloud copy too.
 */
export async function pullCloudPresets(): Promise<Record<string, CircuitPreset>> {
  const pulled: Record<string, CircuitPreset> = {};
  let presets;
  try {
    presets = await fetchCloudPresets('circuit');
  } catch {
    return pulled; // Signed out, offline, or refused — keep what is local.
  }

  for (const preset of presets) {
    if (!preset?.name || !preset?.data) continue;
    if (preset.id) rememberPresetId(preset.name, preset.id);
    pulled[preset.name] = preset.data as CircuitPreset;
  }
  return pulled;
}
