import type { PcbOptions } from './pcbExporter';
import { type Node, type Edge } from '@xyflow/react';
import { saveCloudPreset, removeCloudPreset, PRESETS_UPDATED_EVENT } from './cloudSync';

export interface CircuitPreset {
  name: string;
  nodes: Node[];
  edges: Edge[];
  recommendedSimLength?: number;
  noteCard?: string;
  /**
   * When this preset was last saved, as epoch ms, stamped by `addUserPreset`.
   *
   * The merge needs some way to tell two copies of the same preset apart. It
   * travels inside the preset rather than beside it so the value the server
   * hands back is the one the saving machine wrote, not a row timestamp that
   * changes whenever anything touches the record.
   */
  savedAt?: number;
  /**
   * The CAM settings the board was set up with — trace width, clearances,
   * feeds, depths, tabs.
   *
   * They belong with the circuit rather than with the app: a board is milled
   * with the trace width and clearance it was routed for, and reopening a saved
   * design to find the CAM tab back on the defaults means re-deriving numbers
   * that were arrived at once, carefully, and then thrown away on close.
   * Partial because a preset saved before this existed has none, and because
   * anything absent should fall back to the current default rather than to
   * whatever this preset happened to freeze.
   */
  pcbOptions?: Partial<PcbOptions>;
}

export interface AppSettings {
  showAura: boolean;
  simLength: number;
  simResolution: 'normal' | 'high';
}

const SETTINGS_KEY = 'circuitexpt_settings';
const MACHINING_KEY = 'circuitexpt_machining_options';
const USER_PRESETS_KEY = 'circuitexpt_user_presets';

// ─── Settings ────────────────────────────────────────────────────────────────

export function loadSettings(): Partial<AppSettings> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<AppSettings>;
  } catch {
    return {};
  }
}

export function saveSettings(s: Partial<AppSettings>): void {
  try {
    const existing = loadSettings();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...existing, ...s }));
  } catch {
    // Silently ignore quota errors etc.
  }
}

// ─── User Presets ─────────────────────────────────────────────────────────────

export function loadUserPresets(): Record<string, CircuitPreset> {
  try {
    const raw = localStorage.getItem(USER_PRESETS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, CircuitPreset>;
  } catch {
    return {};
  }
}

export function saveUserPresets(presets: Record<string, CircuitPreset>): void {
  try {
    localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // Silently ignore
  }
}

/*
 * Saving and deleting also push to the account, fire-and-forget.
 *
 * These two functions are the only places a user preset is written in this app,
 * which is what makes them the seam to hang cloud sync on — the same reason Mesh
 * consolidated its four hand-rolled localStorage calls into one module before it
 * could sync anything. The local write is what the user is waiting on, so a failed
 * upload must never be able to lose it, and `cloudSync` no-ops when signed out.
 */

export function addUserPreset(key: string, preset: CircuitPreset): Record<string, CircuitPreset> {
  const existing = loadUserPresets();
  // Stamped here rather than at each call site so every save is dated, whether
  // it came from the dialog, the toolbar button or the MCP bridge.
  const stamped: CircuitPreset = { ...preset, savedAt: Date.now() };
  const updated = { ...existing, [key]: stamped };
  saveUserPresets(updated);
  // Callers that hold the preset list in React state get it back from the
  // return value, but a writer outside React — the MCP bridge — has nowhere to
  // put it, so the copy on screen would go on serving the version it was
  // seeded with. Loading the preset back then returned the *old* circuit and
  // the old note card, with the new one sitting correctly in localStorage.
  window.dispatchEvent(new Event(PRESETS_UPDATED_EVENT));
  void saveCloudPreset(key, stamped);
  return updated;
}

export function removeUserPreset(key: string): Record<string, CircuitPreset> {
  const existing = loadUserPresets();
  const updated = { ...existing };
  delete updated[key];
  saveUserPresets(updated);
  window.dispatchEvent(new Event(PRESETS_UPDATED_EVENT));
  void removeCloudPreset(key);
  return updated;
}

/**
 * Folds presets pulled from the account into the local set.
 *
 * Adds anything new, and takes the cloud copy of a preset this browser already
 * has only when it was saved later. Purely additive was the old rule, on the
 * reasoning that an offline edit is newer than what the account holds — but it
 * also meant an *update* could never cross machines at all. Saving a corrected
 * board on one machine and opening it on another gave the old one back, with
 * nothing on screen to say why. Comparing `savedAt` keeps the case that rule
 * was protecting, since a local edit made later still wins.
 *
 * An undated copy counts as older, so a preset saved before dating existed
 * never overwrites a dated one, and two undated copies leave the local one
 * alone exactly as before. Returns how many were added or refreshed, and
 * announces the change so the preset list on screen picks it up.
 */
export function mergePulledPresets(pulled: Record<string, CircuitPreset>): number {
  const existing = loadUserPresets();
  let added = 0;
  const updated = { ...existing };
  for (const [key, preset] of Object.entries(pulled)) {
    const local = updated[key];
    if (local && (preset.savedAt ?? 0) <= (local.savedAt ?? 0)) continue;
    updated[key] = preset;
    added += 1;
  }
  if (added === 0) return 0;
  saveUserPresets(updated);
  window.dispatchEvent(new Event(PRESETS_UPDATED_EVENT));
  return added;
}

/** Derive a safe localStorage key from a user-supplied name */
/**
 * Storage key for a user preset, from its display name.
 *
 * Idempotent on purpose. Presets are *listed* by key, so the obvious thing to
 * do with a name read off that list is pass it straight back to save over it -
 * and prefixing unconditionally turned `user_teknobox_fixed` into
 * `user_user_teknobox_fixed`, quietly forking a second preset instead of
 * overwriting the first. The original then looked as though something had
 * reverted it, which is a genuinely hard thing to diagnose from the outside.
 *
 * The cost is that a preset a person deliberately names "user something"
 * cannot have its own `user_user_` key. That is a far smaller problem than a
 * save that silently goes somewhere else.
 */
export function nameToKey(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return slug.startsWith('user_') ? slug : 'user_' + slug;
}

// ─── Machining settings ──────────────────────────────────────────────────────
//
// Held apart from the circuit so the CAM tab survives being closed, and so a
// preset can carry a copy without the modal having to know about presets.

export function loadMachiningSettings(): Partial<PcbOptions> {
  try {
    const raw = localStorage.getItem(MACHINING_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveMachiningSettings(options: Partial<PcbOptions>): void {
  try {
    localStorage.setItem(MACHINING_KEY, JSON.stringify(options));
  } catch {
    // Non-fatal: the settings just will not survive a reload.
  }
}
