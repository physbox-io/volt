// ---------------------------------------------------------------------------
// The co-simulation link: this circuit drives a Mesh scene in lock step
//
// Volt owns time. It solves a slice of circuit, asks Mesh to step its scene by
// the same slice with the inputs the circuit produced (a motor's torque on a
// joint), and reads back the outputs the circuit needs (that joint's angle and
// speed, a body's contacts) for the next slice.
//
// The protocol knows nothing about motors: a channel is a name and a number.
// The same shape lives in Mesh's src/utils/coSimLink.ts; the wiki records the
// contract. Different origins, so it runs over `window.open` + `postMessage`,
// and each end only listens to the other's origins.
// ---------------------------------------------------------------------------

export const COSIM_PROTOCOL = 'physbox-cosim';
export const COSIM_VERSION = 1;

/** One number the circuit can write (input) or read (output). */
export interface CoSimChannel {
  name: string;
  direction: 'input' | 'output';
  unit: string;
  description: string;
}

type Envelope = { proto: typeof COSIM_PROTOCOL; v: number };

export type CoSimMessage = Envelope & (
  | { type: 'HELLO' }
  | { type: 'CATALOGUE'; channels: CoSimChannel[]; timestepMs: number; scene: string }
  | { type: 'STEP_FOR'; seq: number; dtMs: number; inputs: Record<string, number>; outputs: string[] }
  | { type: 'STEPPED'; seq: number; t: number; steps: number; outputs: Record<string, number>; unknown: string[] }
  | { type: 'ERROR'; seq?: number; message: string }
  | { type: 'UNLINK' }
);

export type CoSimBody = CoSimMessage extends infer M ? M extends Envelope ? Omit<M, keyof Envelope> : never : never;

export const envelope = <T extends CoSimBody>(body: T): T & Envelope =>
  ({ proto: COSIM_PROTOCOL, v: COSIM_VERSION, ...body });

export function isCoSimMessage(value: unknown): value is CoSimMessage {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return m.proto === COSIM_PROTOCOL && m.v === COSIM_VERSION && typeof m.type === 'string';
}

/** Where Mesh lives: beside Volt on 5175 in development, else the deployed app. */
export function meshBaseUrl(location: { hostname: string; protocol: string } = window.location): string {
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  return local ? `${location.protocol}//${location.hostname}:5175` : 'https://mesh.physbox.io';
}

/**
 * The Mesh page a link opens. `link=volt` has Mesh serve it without the
 * cross-origin isolation headers: with them, the browser puts Mesh in a
 * browsing context group of its own, its `window.opener` is null, and this
 * page's handle to it reads as closed, so no HELLO is ever answered.
 */
export function meshLinkUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('link', 'volt');
  return url.toString();
}

/** The channel names a joint offers. */
export const jointChannels = (joint: string) => ({
  force: `joint:${joint}.force`,
  pos: `joint:${joint}.pos`,
  vel: `joint:${joint}.vel`,
});

/** What one Mesh step reported. */
export type Stepped = { t: number; outputs: Record<string, number>; unknown: string[] };

/** Anything that can step a scene: the real link, or a stand-in in a test. */
export interface CoSimEndpoint {
  stepFor(dtMs: number, inputs: Record<string, number>, outputs: string[]): Promise<Stepped>;
}

export type LinkStatus = 'closed' | 'opening' | 'linked';

/**
 * A step that failed because of the link, not the circuit: Mesh is not open,
 * its window was closed or reloaded, or it did not answer. Kept apart from a
 * solver failure so it is not explained as one (it used to read as "the
 * circuit was solved to nothing").
 */
export class MeshLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeshLinkError';
  }
}

/** The name of the window a link opens, so a later link can find it again. */
export const MESH_WINDOW_NAME = 'physbox-mesh-link';

/** How often a live link checks that the Mesh window is still there. */
export const HEARTBEAT_MS = 1000;

/** True for a window this page may read, which a window still on about:blank is and a loaded Mesh is not. */
function isBlank(win: Window): boolean {
  try {
    return win.location.href === 'about:blank';
  } catch {
    // Cross-origin: a Mesh page is loaded in it.
    return false;
  }
}

/**
 * The link to one Mesh window.
 *
 * `open` must be called from a click: browsers only let a page open a window
 * in direct response to one. The handshake is HELLO, repeated until Mesh has
 * built its scene and answers with its catalogue.
 *
 * A Mesh window this page opened before is linked again where it is, never
 * navigated: loading the link URL into it reloaded Mesh and threw its scene
 * away. While linked, a heartbeat watches for the window closing, and Mesh
 * says UNLINK when its page goes away, so the link does not go on reading
 * "linked" to a Mesh that is gone.
 */
export class MeshLink implements CoSimEndpoint {
  private win: Window | null = null;
  /** The window the last link used, kept after it ends so linking again reattaches to it. */
  private lastWin: Window | null = null;
  private origin = '';
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (s: Stepped) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private helloTimer: ReturnType<typeof setInterval> | null = null;
  private listener = (evt: MessageEvent) => this.onMessage(evt);
  status: LinkStatus = 'closed';
  /** Why the last attempt ended before Mesh answered, if it did; cleared by `open`. */
  failure = '';
  /** Why a link that was up ended from Mesh's side (closed, reloaded, gone quiet); cleared by `open`. */
  lost = '';
  channels: CoSimChannel[] = [];
  scene = '';
  private listeners = new Set<() => void>();

  /** Told whenever status or catalogue changes, and when Mesh ends the link. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private changed() {
    for (const l of this.listeners) l();
  }

  open(baseUrl = meshBaseUrl()): boolean {
    this.close();
    this.failure = '';
    this.lost = '';
    const win = this.meshWindow(meshLinkUrl(baseUrl));
    if (!win) return false;
    this.win = win;
    this.origin = new URL(baseUrl).origin;
    this.status = 'opening';
    window.addEventListener('message', this.listener);
    const hello = () => {
      if (!this.win || this.win.closed) {
        this.failure = 'The Mesh window closed, or the browser cut it off from this page, before Mesh answered.';
        this.close();
        return;
      }
      try { this.win.postMessage(envelope({ type: 'HELLO' }), this.origin); } catch { /* not loaded yet */ }
    };
    hello();
    this.helloTimer = setInterval(hello, 500);
    this.changed();
    return true;
  }

  /**
   * The window to link: the one the last link used if it is still open, else
   * whichever window already carries the link's name (this page may have been
   * reloaded since it opened Mesh), else a new one. Only a window still on
   * about:blank is sent to the link URL.
   */
  private meshWindow(url: string): Window | null {
    const known = this.lastWin && !this.lastWin.closed ? this.lastWin : null;
    const win = known ?? window.open('', MESH_WINDOW_NAME);
    if (!win) return null;
    if (isBlank(win)) win.location.href = url;
    else win.focus?.();
    return win;
  }

  /** Ends a link that Mesh's side ended, saying why. */
  private lose(reason: string): void {
    if (this.status === 'closed') return;
    this.lost = reason;
    this.close(false);
  }

  close(tellMesh = true): void {
    if (this.helloTimer) clearInterval(this.helloTimer);
    this.helloTimer = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (tellMesh && this.win && !this.win.closed && this.status === 'linked') {
      try { this.win.postMessage(envelope({ type: 'UNLINK' }), this.origin); } catch { /* gone */ }
    }
    window.removeEventListener('message', this.listener);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new MeshLinkError(this.lost || 'The link to Mesh was closed.'));
    }
    this.pending.clear();
    const changed = this.status !== 'closed';
    if (this.win) this.lastWin = this.win;
    this.win = null;
    this.status = 'closed';
    this.channels = [];
    if (changed) this.changed();
  }

  stepFor(dtMs: number, inputs: Record<string, number>, outputs: string[], timeoutMs = 5000): Promise<Stepped> {
    if (this.status === 'linked' && (!this.win || this.win.closed)) this.lose('The Mesh window was closed.');
    if (this.status !== 'linked' || !this.win) {
      return Promise.reject(new MeshLinkError(this.lost
        ? `Mesh is not open, or the link to it was lost: ${this.lost} Press Link Mesh to link again.`
        : 'Mesh is not linked. Press Link Mesh to open it and link.'));
    }
    const seq = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        if (!this.win || this.win.closed) this.lose('The Mesh window was closed.');
        reject(new MeshLinkError(this.lost
          ? `Mesh is not open, or the link to it was lost: ${this.lost}`
          : `Mesh did not answer a ${dtMs}ms step within ${timeoutMs / 1000}s. Check that its tab is still open and its scene is built.`));
      }, timeoutMs);
      this.pending.set(seq, { resolve, reject, timer });
      this.win!.postMessage(envelope({ type: 'STEP_FOR', seq, dtMs, inputs, outputs }), this.origin);
    });
  }

  private onMessage(evt: MessageEvent) {
    if (evt.source !== this.win || evt.origin !== this.origin || !isCoSimMessage(evt.data)) return;
    const msg = evt.data;
    switch (msg.type) {
      case 'CATALOGUE':
        if (this.helloTimer) clearInterval(this.helloTimer);
        this.helloTimer = null;
        // A catalogue again while linked (a cavity measured) keeps the one heartbeat.
        this.heartbeat ??= setInterval(() => {
          if (!this.win || this.win.closed) this.lose('The Mesh window was closed.');
        }, HEARTBEAT_MS);
        this.status = 'linked';
        this.channels = msg.channels;
        this.scene = msg.scene;
        this.changed();
        return;
      case 'STEPPED': {
        const p = this.pending.get(msg.seq);
        if (!p) return;
        this.pending.delete(msg.seq);
        clearTimeout(p.timer);
        p.resolve({ t: msg.t, outputs: msg.outputs, unknown: msg.unknown });
        return;
      }
      case 'ERROR': {
        const p = msg.seq === undefined ? undefined : this.pending.get(msg.seq);
        if (!p) return;
        this.pending.delete(msg.seq!);
        clearTimeout(p.timer);
        p.reject(new MeshLinkError(`Mesh: ${msg.message}`));
        // Mesh answering that it is not linked has been reloaded since it was.
        if (/not linked/i.test(msg.message)) this.lose('Mesh was reloaded, which ended the link.');
        return;
      }
      case 'UNLINK':
        this.lose('Mesh was closed or reloaded, which ended the link.');
        return;
      default:
        return;
    }
  }
}
