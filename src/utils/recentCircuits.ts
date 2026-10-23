/**
 * Which circuits were opened lately, for the circuit browser's Recent tab.
 * This browser's own history, so it is kept here rather than in any preset.
 * (A saved circuit's picture is in the preset: see CircuitPreset.thumbnail.)
 *
 * An id is a preset key: built-in keys and saved ones (`user_…`) never collide.
 */

const RECENT_KEY = 'circuitexpt_recent_circuits';
const RECENT_MAX = 12;

/** Fired when the recents change, so open lists can redraw. */
export const RECENT_CHANGED_EVENT = 'physbox:recent-circuits-changed';

export interface RecentCircuit { id: string; at: number }

export function listRecent(): RecentCircuit[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((r): r is RecentCircuit => typeof r?.id === 'string' && typeof r?.at === 'number')
      : [];
  } catch {
    return [];
  }
}

function writeRecent(list: RecentCircuit[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    // A full store loses the history, which is only a convenience.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(RECENT_CHANGED_EVENT));
}

/** Puts `id` at the top of the recents. The empty canvas is not worth remembering. */
export function recordRecent(id: string, at = Date.now()): void {
  if (id === 'empty') return;
  writeRecent([{ id, at }, ...listRecent().filter((r) => r.id !== id)]);
}

export function renameRecent(from: string, to: string): void {
  const list = listRecent();
  if (!list.some((r) => r.id === from)) return;
  writeRecent(list.filter((r) => r.id !== to).map((r) => (r.id === from ? { ...r, id: to } : r)));
}

export function forgetRecent(id: string): void {
  const list = listRecent();
  if (list.some((r) => r.id === id)) writeRecent(list.filter((r) => r.id !== id));
}

/** The circuit browser's tabs. */
export type CircuitBrowserTab = 'recent' | 'mine' | 'examples';

/** Where the browser opens: what was opened lately, else your own circuits, else the examples. */
export function firstBrowserTab(userPresets: Record<string, unknown>): CircuitBrowserTab {
  if (listRecent().length > 0) return 'recent';
  if (Object.keys(userPresets).length > 0) return 'mine';
  return 'examples';
}
