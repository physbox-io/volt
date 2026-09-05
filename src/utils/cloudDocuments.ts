/**
 * Auto-saving the open document to the account.
 *
 * Presets already sync: things somebody deliberately named and saved. What has
 * never been kept anywhere is the document actually being worked on, so a cleared
 * site-data prompt, a second laptop or a crashed tab costs a session's work.
 *
 * Shape of the thing:
 *
 *  - **Local storage stays the source of truth.** Every existing local save path
 *    is untouched. This is a copy pushed alongside them, so a free account, a
 *    signed-out account and a dropped connection all behave exactly as they did
 *    before — nothing here is load-bearing for keeping work.
 *  - **Debounced, and deduplicated.** Idle for `IDLE_MS` or `MAX_WAIT_MS` since the
 *    first unsaved change, whichever comes first, and never for a document that
 *    serialises to what was last sent. Editing is continuous; writes should not be.
 *  - **One write in flight.** A slow connection must not queue twenty revisions of
 *    the same document behind each other.
 *  - **Conflicts are surfaced, not resolved.** Two browsers open on one document
 *    would otherwise take turns overwriting each other every few seconds and the
 *    loser would never know. The server refuses a write built on a stale revision;
 *    this reports that and stops writing until somebody chooses.
 *
 * Free accounts never reach the network here at all: `isProAccount` is checked
 * before anything is scheduled.
 */

import {
  isProAccount,
  isProRequired,
  getStoredAuthToken,
  putCloudDocument,
  fetchCloudDocument,
  PhysBoxApiError,
} from './apiClient';

/** Which app's documents these are. */
const APP_ID = 'circuit';

/** Remembers which cloud document this browser's working copy belongs to. */
const DOCUMENT_ID_KEY = 'circuit_cloud_document_id';

/** Quiet time before a save. Long enough to cover typing, short enough to feel safe. */
const IDLE_MS = 3000;

/**
 * Longest a change may go unsaved while someone keeps editing.
 *
 * Without this, continuous work — dragging a node for two minutes — would reset
 * the idle timer forever and never save at all.
 */
const MAX_WAIT_MS = 30000;

/**
 * Shortest gap between serialising the document to see whether it changed.
 *
 * Dragging an element fires a change per frame. Hashing a whole scene sixty times
 * a second to discover that the user is still dragging would be work done purely
 * to find out that no work is needed.
 */
const COALESCE_MS = 750;

/** Backoff after a failed write, doubling to this ceiling. */
const RETRY_MS = 5000;
const MAX_RETRY_MS = 120000;

export type AutosaveState =
  | 'idle'
  | 'pending'
  | 'saving'
  | 'saved'
  | 'offline'
  | 'conflict'
  | 'disabled';

export interface AutosaveStatus {
  state: AutosaveState;
  /** The cloud document this browser is writing to, once there is one. */
  documentId: string | null;
  revision: number | null;
  savedAt: number | null;
  message: string | null;
  /** Set when the server holds a newer revision than the one we started from. */
  conflictRevision: number | null;
}

type Listener = (status: AutosaveStatus) => void;

/**
 * A cheap content hash.
 *
 * Only ever compared against another hash of the same function's output, so it
 * needs to be fast and stable, not cryptographic — this runs on every keystroke's
 * worth of state change.
 */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h) ^ text.charCodeAt(i);
  }
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage full or blocked: the cloud copy is a convenience, not a promise.
  }
}

/** A document id this browser owns, minted once and then reused. */
function ensureDocumentId(): string {
  const existing = readStored(DOCUMENT_ID_KEY);
  if (existing) return existing;
  // Minted here rather than by the server so a document created offline keeps its
  // identity when it eventually syncs.
  const id = `doc_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  writeStored(DOCUMENT_ID_KEY, id);
  return id;
}

class CloudAutosave {
  private status: AutosaveStatus = {
    state: 'idle',
    documentId: readStored(DOCUMENT_ID_KEY),
    revision: null,
    savedAt: null,
    message: null,
    conflictRevision: null,
  };

  private listeners = new Set<Listener>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = RETRY_MS;

  private pendingName = '';
  private pendingData: unknown = null;
  /** The most recent document offered, waiting to be hashed. See `schedule`. */
  private latest: { name: string; data: unknown } | null = null;
  private coalesceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSerializedAt = 0;
  private pendingHash: string | null = null;
  private lastSentHash: string | null = null;
  private inFlight = false;
  /** Whether this session has asked the account what revision it holds. */
  private primed = false;
  /** Set after a conflict; nothing is written again until it is cleared. */
  private blocked = false;

  constructor() {
    if (typeof window !== 'undefined') {
      // A tab being closed is the one moment a few unsaved seconds actually
      // matter, and it is also the moment there is no time for a normal request.
      window.addEventListener('beforeunload', () => this.flushOnUnload());
      window.addEventListener('online', () => {
        if (this.pendingHash && !this.blocked) this.save();
      });
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  getStatus(): AutosaveStatus {
    return this.status;
  }

  private set(patch: Partial<AutosaveStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener(this.status);
  }

  private enabled(): boolean {
    return Boolean(getStoredAuthToken()) && isProAccount();
  }

  /**
   * Offers the current document for saving.
   *
   * Called on every change, and a change can mean every frame of a drag — so this
   * must be cheap on the hot path. Serialising a scene to compare it against the
   * last one is not cheap, so rapid calls are coalesced and only the most recent
   * document is ever hashed. Below the coalescing window this does nothing but
   * store a reference.
   */
  schedule(name: string, data: unknown): void {
    if (!this.enabled()) {
      if (this.status.state !== 'disabled') {
        this.set({ state: 'disabled', message: null });
      }
      return;
    }
    if (this.blocked) return;

    this.latest = { name, data };

    const since = Date.now() - this.lastSerializedAt;
    if (since >= COALESCE_MS) {
      this.ingest();
      return;
    }
    if (!this.coalesceTimer) {
      this.coalesceTimer = setTimeout(() => {
        this.coalesceTimer = null;
        this.ingest();
      }, COALESCE_MS - since);
    }
  }

  /** Hashes the most recent document offered, and starts the save timers. */
  private ingest(): void {
    if (this.coalesceTimer) {
      clearTimeout(this.coalesceTimer);
      this.coalesceTimer = null;
    }
    const latest = this.latest;
    if (!latest || this.blocked || !this.enabled()) return;

    this.lastSerializedAt = Date.now();
    const { name, data } = latest;

    let serialized: string;
    try {
      serialized = JSON.stringify(data);
    } catch {
      // A document that will not serialise cannot be saved to anything; the local
      // paths have the same problem and there is nothing useful to say about it.
      return;
    }

    const next = hash(serialized);
    if (next === this.lastSentHash) return;
    if (next === this.pendingHash) {
      this.pendingName = name;
      return;
    }

    this.pendingName = name;
    this.pendingData = data;
    this.pendingHash = next;
    this.set({ state: 'pending' });

    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.save(), IDLE_MS);

    if (!this.maxWaitTimer) {
      this.maxWaitTimer = setTimeout(() => this.save(), MAX_WAIT_MS);
    }
  }

  /** Writes now, if there is anything to write. */
  async flush(): Promise<void> {
    // A document offered inside the coalescing window has not been hashed yet, and
    // "save now" has to mean the latest one rather than the last one hashed.
    this.ingest();
    await this.save();
  }

  /**
   * Writes immediately and marks the result as a checkpoint somebody meant.
   *
   * Automatic checkpoints are guesses about when a snapshot might be useful. A
   * deliberate save is not a guess, and the pruner never throws a labelled one
   * away — so "the version before I changed the kerf" stays findable.
   */
  async saveExplicit(name: string, data: unknown, label: string): Promise<void> {
    if (!this.enabled() || this.blocked) return;
    const id = ensureDocumentId();
    this.clearTimers();
    this.set({ state: 'saving', documentId: id });
    try {
      const res = await putCloudDocument({
        id,
        appId: APP_ID,
        name,
        data,
        baseRevision: this.status.revision ?? undefined,
        label,
      });
      try {
        this.lastSentHash = hash(JSON.stringify(data));
      } catch {
        this.lastSentHash = null;
      }
      this.pendingHash = null;
      this.set({ state: 'saved', revision: res.revision, savedAt: Date.now(), message: null });
    } catch (err) {
      this.handleFailure(err);
    }
  }

  /**
   * Cancels the save timers.
   *
   * Deliberately leaves the coalescing timer alone: this runs from `save()`, and
   * that timer may be holding a document newer than the one being written. Killing
   * it there would strand those edits until the user happened to touch something
   * again. Only `ingest` clears it, because only `ingest` consumes it.
   */
  private clearTimers(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.maxWaitTimer) clearTimeout(this.maxWaitTimer);
    this.idleTimer = null;
    this.maxWaitTimer = null;
  }

  /**
   * Learns the revision the account currently holds, once per session.
   *
   * Without this, the first write of a session sends no `base_revision` and the
   * server accepts it — which is right for a document that has never synced, and
   * wrong for the case this whole mechanism exists for. Open the same account in a
   * second browser and its first autosave would blindly overwrite whatever the
   * first one had written, with no conflict raised, because it had no revision to
   * be stale against.
   *
   * A 404 is the good outcome for a genuinely new document: nothing to be stale
   * against, so the write proceeds and creates it. Only the *revision* is adopted,
   * never the content — a pull that replaced what is on screen is not something an
   * autosave should ever do on its own.
   */
  private async primeRevision(id: string): Promise<void> {
    if (this.primed) return;
    this.primed = true;
    try {
      const doc = await fetchCloudDocument(id);
      this.set({ revision: doc.revision, documentId: doc.id });
    } catch {
      // Not there, or unreachable. Either way the write below decides what happens.
    }
  }

  private async save(): Promise<void> {
    this.clearTimers();
    if (this.inFlight || this.blocked || this.pendingHash === null) return;
    if (!this.enabled()) return;

    const id = ensureDocumentId();
    if (this.status.revision === null) await this.primeRevision(id);
    const name = this.pendingName;
    const data = this.pendingData;
    const sending = this.pendingHash;

    this.inFlight = true;
    this.set({ state: 'saving', documentId: id, message: null });

    try {
      const res = await putCloudDocument({
        id,
        appId: APP_ID,
        name,
        data,
        // Undefined on the very first write of a session, which is what lets an
        // offline-first document land without knowing the server's revision.
        baseRevision: this.status.revision ?? undefined,
      });

      this.lastSentHash = sending;
      if (this.pendingHash === sending) this.pendingHash = null;
      this.retryDelay = RETRY_MS;
      this.set({
        state: this.pendingHash ? 'pending' : 'saved',
        revision: res.revision,
        savedAt: Date.now(),
        message: null,
      });

      // Something arrived while this was in flight.
      if (this.pendingHash) this.idleTimer = setTimeout(() => this.save(), IDLE_MS);
    } catch (err) {
      this.handleFailure(err);
    } finally {
      this.inFlight = false;
    }
  }

  private handleFailure(err: unknown): void {
    if (err instanceof PhysBoxApiError && err.status === 409) {
      /*
       * Somebody else moved the document. Do not write again: last-write-wins
       * across two machines is exactly the failure this feature exists to
       * prevent, and the person deserves to be asked.
       */
      this.blocked = true;
      this.set({
        state: 'conflict',
        conflictRevision: typeof err.body.revision === 'number' ? err.body.revision : null,
        message: 'This document was changed on another device.',
      });
      return;
    }

    if (isProRequired(err)) {
      // The account changed under us; stop trying rather than 403 forever.
      this.blocked = true;
      this.set({ state: 'disabled', message: null });
      return;
    }

    if (err instanceof PhysBoxApiError && err.status === 413) {
      this.blocked = true;
      this.set({ state: 'offline', message: err.message });
      return;
    }

    /*
     * Anything else is treated as reachability, and nothing is stashed anywhere.
     *
     * There is no need: the app's own local save has already happened, and it is
     * the durability story. A second copy of the same document under another
     * localStorage key would be one more thing to keep consistent for no gain.
     */
    this.set({ state: 'offline', message: 'Not synced — your work is saved on this device.' });

    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.save(), this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_MS);
  }

  /**
   * A last attempt as the tab goes away.
   *
   * `fetch` with `keepalive` is the only thing that survives an unload, and it is
   * capped at 64 KB — so this is a best-effort for small documents and a no-op for
   * large ones. Nothing is lost either way: the local copy is already written.
   */
  private flushOnUnload(): void {
    this.ingest();
    if (this.pendingHash === null || this.blocked || !this.enabled()) return;
    void this.save();
  }

  /** After a conflict: keep this browser's copy and overwrite the account's. */
  async keepLocalCopy(): Promise<void> {
    const id = this.status.documentId;
    if (!id) return;
    // Adopt the server's revision so the next write is no longer stale, then let
    // the normal path send the local document on top of it.
    try {
      const doc = await fetchCloudDocument(id);
      this.set({ revision: doc.revision });
    } catch {
      this.set({ revision: null });
    }
    this.blocked = false;
    this.lastSentHash = null;
    this.set({ state: 'pending', conflictRevision: null, message: null });
    await this.save();
  }

  /**
   * Starts a separate cloud document for this browser's copy.
   *
   * The escape hatch for a conflict somebody does not want to resolve: both
   * versions survive, under different ids.
   */
  forkDocument(): void {
    writeStored(DOCUMENT_ID_KEY, null);
    this.blocked = false;
    this.lastSentHash = null;
    // A new id has no revision on the server, and must not inherit the old one's.
    this.primed = true;
    this.set({
      state: 'pending',
      documentId: ensureDocumentId(),
      revision: null,
      conflictRevision: null,
      message: null,
    });
    void this.save();
  }

}

export const cloudAutosave = new CloudAutosave();
