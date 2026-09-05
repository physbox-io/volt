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
  const updated = { ...existing, [key]: preset };
  saveUserPresets(updated);
  void saveCloudPreset(key, preset);
  return updated;
}

export function removeUserPreset(key: string): Record<string, CircuitPreset> {
  const existing = loadUserPresets();
  const updated = { ...existing };
  delete updated[key];
  saveUserPresets(updated);
  void removeCloudPreset(key);
  return updated;
}

/**
 * Folds presets pulled from the account into the local set.
 *
 * Additive: a key already saved in this browser is left alone — see the note in
 * `cloudSync.pullCloudPresets`. Returns how many were new, and announces the change
 * so the preset list on screen picks it up.
 */
export function mergePulledPresets(pulled: Record<string, CircuitPreset>): number {
  const existing = loadUserPresets();
  let added = 0;
  const updated = { ...existing };
  for (const [key, preset] of Object.entries(pulled)) {
    if (key in updated) continue;
    updated[key] = preset;
    added += 1;
  }
  if (added === 0) return 0;
  saveUserPresets(updated);
  window.dispatchEvent(new Event(PRESETS_UPDATED_EVENT));
  return added;
}

/** Derive a safe localStorage key from a user-supplied name */
export function nameToKey(name: string): string {
  return 'user_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
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
