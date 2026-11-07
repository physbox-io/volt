import { useSyncExternalStore } from 'react';

const KEY = 'grblTouchPlateMm';
export const DEFAULT_TOUCH_PLATE_MM = 12;

const listeners = new Set<() => void>();

function readTouchPlateMm(): number {
  const raw = localStorage.getItem(KEY);
  const value = raw === null ? NaN : parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TOUCH_PLATE_MM;
}

export function setTouchPlateMm(mm: number): void {
  localStorage.setItem(KEY, String(mm));
  listeners.forEach(notify => notify());
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/** The plate on the bench: one value for the machine dialog and the job's own dialogs. */
export function useTouchPlateMm(): number {
  return useSyncExternalStore(subscribe, readTouchPlateMm);
}
