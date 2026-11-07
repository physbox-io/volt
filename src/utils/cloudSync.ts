/**
 * Cloud preset sync for Volt.
 *
 * `apiClient` has exported `syncCloudPreset`, `fetchCloudPresetList` and
 * `deleteCloudPreset` since it was written, and in this app nothing ever called
 * any of them — the functions were dead code and circuits were localStorage-only,
 * while Etch and Mesh had both halves. So signing in on a second machine restored
 * nothing here, and the account menu said otherwise.
 *
 * It deliberately does not import `storage`: that module saves and deletes through
 * here, and connects itself to `presetSync`, which keeps the two level.
 */

import { CNC_BED_PARAMETER, TOOL_RACK_PARAMETER } from '@physbox-io/machining';
import { machineBedStore } from './machineBed';
import { fetchCloudParameters } from './apiClient';
import { settleToolRack } from './pcbTooling';
import type { CircuitPreset } from './storage';
import { PresetSync } from './presetSync';

export const presetSync = new PresetSync('circuit', 'circuitexpt_cloud_preset_ids');

/**
 * Fired after a pull has merged presets into localStorage.
 *
 * The preset list lives in React state inside `usePresets`, seeded once from
 * localStorage — so writing to storage behind it changes nothing on screen. This
 * is how the hook finds out. A same-tab write does not fire a `storage` event, and
 * a custom name is clearer than overloading that one.
 */
export const PRESETS_UPDATED_EVENT = 'physbox:presets-updated';

/** Carried by that event after a pull: the presets another machine saved a later copy of. */
export interface PresetsPulledDetail {
  refreshed: string[];
}

/** Records a save as owed to the account and uploads it. If that fails it goes again at the next pull. */
export function saveCloudPreset(key: string, preset: CircuitPreset): Promise<boolean> {
  presetSync.noteSaved(key);
  return presetSync.upload(key, preset);
}

/** Deletes the cloud copy of a preset, now if the account can be reached and at the next pull if not. */
export function removeCloudPreset(key: string): Promise<void> {
  return presetSync.remove(key);
}

/**
 * Settles the shared tool rack against the account's, as Etch does on its
 * sign-in pull.
 *
 * The rack lives under the app-agnostic `global` scope, which is where Etch and
 * Mesh write it, so an edit made in either is the rack this app offers next.
 * Whichever copy was edited last wins, and an older account copy is answered
 * with ours. Signed out, there is nothing to settle against and nothing is
 * touched — `fetchCloudParameters` returns empty, and an empty answer is not
 * the account saying it has no rack.
 */
export async function pullToolRack(): Promise<boolean> {
  let params: Record<string, unknown>;
  try {
    params = await fetchCloudParameters('global');
  } catch {
    return false;
  }
  if (!params || Object.keys(params).length === 0) return false;
  // The machine's envelope is shared with Etch and Mesh, like the rack.
  machineBedStore.adoptRemote(params[CNC_BED_PARAMETER]);
  return settleToolRack(params[TOOL_RACK_PARAMETER]);
}
