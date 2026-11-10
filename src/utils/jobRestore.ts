/**
 * Puts back a job the last page left unfinished.
 *
 * The machine writes every job down as it runs (`attachCheckpoint` in
 * `webSerialManager`). A reload, a sleep or a closed laptop used to lose the
 * program, and with it the Run From that picks a half-milled board back up.
 * Asked on load and whenever the tab comes back to the front. Cheap when there
 * is nothing to find, and a no-op once a job is restored.
 */

import type { RemoteJobChipProps } from '@physbox-io/ui';
import { webSerialManager } from './webSerialManager';

/** Opens the mill window on a restored job's Run From; set by `watchForInterruptedJob`. */
let onFound: (() => void) | null = null;

/** Looks for a left-behind job now. */
export function recheckInterruptedJob(): void {
  void webSerialManager.restoreInterruptedJob().then((found) => {
    if (found) onFound?.();
  });
}

/** Looks now and each time the tab is brought back; `found` opens the mill window. */
export function watchForInterruptedJob(found: () => void): () => void {
  onFound = found;
  recheckInterruptedJob();
  const onBack = () => {
    if (document.visibilityState === 'visible') recheckInterruptedJob();
  };
  document.addEventListener('visibilitychange', onBack);
  window.addEventListener('focus', onBack);
  return () => {
    if (onFound === found) onFound = null;
    document.removeEventListener('visibilitychange', onBack);
    window.removeEventListener('focus', onBack);
  };
}

/** A job another tab or computer is cutting, for `RemoteJobChip`. */
export const subscribeRemoteJob: RemoteJobChipProps['subscribe'] = (fn) =>
  webSerialManager.getCheckpoint()?.subscribeRemoteJob(fn) ?? (() => {});
