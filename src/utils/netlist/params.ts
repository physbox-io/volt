import { parseEngValue } from '../engValue';

/**
 * A number a part keeps in `data`, whether stored as a number or as text with
 * an SI suffix ("2.8m"), or `fallback` when missing or unreadable.
 */
export function numParam(data: Record<string, unknown>, key: string, fallback: number): number {
  const v = data[key];
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (typeof v === 'string' && v.trim()) {
    const parsed = parseEngValue(v);
    if (parsed !== null && Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}
