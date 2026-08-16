import { type Node, type Edge } from '@xyflow/react';

export interface CircuitPreset {
  name: string;
  nodes: Node[];
  edges: Edge[];
  recommendedSimLength?: number;
  noteCard?: string;
}

export interface AppSettings {
  showAura: boolean;
  simLength: number;
  simResolution: 'normal' | 'high';
}

const SETTINGS_KEY = 'circuitexpt_settings';
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

export function addUserPreset(key: string, preset: CircuitPreset): Record<string, CircuitPreset> {
  const existing = loadUserPresets();
  const updated = { ...existing, [key]: preset };
  saveUserPresets(updated);
  return updated;
}

export function removeUserPreset(key: string): Record<string, CircuitPreset> {
  const existing = loadUserPresets();
  const updated = { ...existing };
  delete updated[key];
  saveUserPresets(updated);
  return updated;
}

/** Derive a safe localStorage key from a user-supplied name */
export function nameToKey(name: string): string {
  return 'user_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
