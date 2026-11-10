/**
 * Puts back a job the last page left unfinished.
 *
 * The machine writes every job down as it runs (`attachCheckpoint` in
 * `webSerialManager`). A reload, a sleep or a closed laptop used to lose the
 * program, and with it the Run From that picks a half-milled board back up.
 * Asked on load and whenever the tab comes back to the front. Cheap when there
 * is nothing to find, and a no-op once a job is restored.
 */

import { webSerialManager } from './webSerialManager';

/** Looks now and each time the tab is brought back; `onFound` opens the mill window. */
export function watchForInterruptedJob(onFound: () => void): () => void {
  const look = () => {
    void webSerialManager.restoreInterruptedJob().then((found) => {
      if (found) onFound();
    });
  };
  look();
  const onBack = () => {
    if (document.visibilityState === 'visible') look();
  };
  document.addEventListener('visibilitychange', onBack);
  window.addEventListener('focus', onBack);
  return () => {
    document.removeEventListener('visibilitychange', onBack);
    window.removeEventListener('focus', onBack);
  };
}
