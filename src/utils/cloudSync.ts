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
import { adoptSuiteParameters } from '@physbox-io/ui/suite';
import { machineBedStore } from './machineBed';
import { fetchCloudParameters } from './apiClient';
import { settleToolRack } from './pcbTooling';
import { adoptLlmSettings } from './llmSettings';
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
 * Brings the account down: the shared `global` settings (copilot keys, tool
 * rack, machine bed, the suite's dark mode and touch plate) and the circuits.
 * Returns how many settings changed here and how many circuits arrived; throws
 * when the account cannot be listed, so an unreachable account never reads as
 * up to date.
 *
 * The rack lives under `global`, where Etch and Mesh write it too; whichever
 * copy was edited last wins. An empty answer (signed out or offline) is not
 * the account saying it has no rack, so nothing is settled against it.
 */
export async function pullCloudState(): Promise<{ parameters: number; items: number }> {
  const params = await fetchCloudParameters('global');
  let parameters = 0;
  if (Object.keys(params).length > 0) {
    parameters += adoptLlmSettings(params);
    parameters += adoptSuiteParameters(params);
    if (machineBedStore.adoptRemote(params[CNC_BED_PARAMETER])) parameters += 1;
    if (settleToolRack(params[TOOL_RACK_PARAMETER])) parameters += 1;
  }
  const presets = await presetSync.pull();
  return { parameters, items: presets.received };
}
