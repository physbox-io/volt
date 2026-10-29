/**
 * Keeps the computer awake while a job is on the machine.
 *
 * A laptop left beside the machine for an hour's cut goes to sleep on its own
 * schedule. Sleep suspends USB, the serial port closes under the stream, and
 * the controller runs its buffer dry and stops partway through the job, with
 * the board half-cut and the origin trusted to nobody. A screen wake lock is
 * the one thing a web page can do about that.
 *
 * What it does *not* fix is a backgrounded tab, and it is not meant to: the
 * browser drops the lock whenever the page is hidden. That is harmless here
 * because the stream is paced by the controller's `ok`s arriving on the serial
 * reader, not by timers, so tab throttling does not starve it. The lock is
 * asked for again when the page becomes visible.
 *
 * Held for the whole of a job and for multi-point surface probing, pauses
 * included: a tool change is exactly when the operator walks away from the
 * keyboard, and a machine that sleeps then cannot be resumed.
 */

let wanted = false;
let sentinel: WakeLockSentinel | null = null;
let requesting = false;
let listening = false;

function supported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

async function acquire(): Promise<void> {
  if (!wanted || sentinel || requesting) return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  requesting = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    // The job may have ended while the request was in flight.
    if (!wanted) {
      void lock.release();
      return;
    }
    sentinel = lock;
    lock.addEventListener('release', () => {
      if (sentinel === lock) sentinel = null;
    });
  } catch {
    // Refused (battery saver, a permissions policy). Nothing to tell the
    // operator that would change what they do; the job runs either way.
  } finally {
    requesting = false;
  }
}

function onVisibility(): void {
  if (document.visibilityState === 'visible') void acquire();
}

/** Call with whether a job or probe walk is in progress; cheap to call on every state change. */
export function setJobWakeLock(active: boolean): void {
  if (!supported() || active === wanted) return;
  wanted = active;
  if (active) {
    if (!listening) {
      document.addEventListener('visibilitychange', onVisibility);
      listening = true;
    }
    void acquire();
  } else {
    const lock = sentinel;
    sentinel = null;
    if (lock) void lock.release();
  }
}

