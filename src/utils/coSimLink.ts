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
 * The link to one Mesh window.
 *
 * `open` must be called from a click: browsers only let a page open a window
 * in direct response to one. The handshake is HELLO, repeated until Mesh has
 * built its scene and answers with its catalogue.
 */
export class MeshLink implements CoSimEndpoint {
  private win: Window | null = null;
  private origin = '';
  private seq = 0;
  private pending = new Map<number, { resolve: (s: Stepped) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private helloTimer: ReturnType<typeof setInterval> | null = null;
  private listener = (evt: MessageEvent) => this.onMessage(evt);
  status: LinkStatus = 'closed';
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
    const win = window.open(baseUrl, 'physbox-mesh-link');
    if (!win) return false;
    this.win = win;
    this.origin = new URL(baseUrl).origin;
    this.status = 'opening';
    window.addEventListener('message', this.listener);
    const hello = () => {
      if (!this.win || this.win.closed) { this.close(); return; }
      try { this.win.postMessage(envelope({ type: 'HELLO' }), this.origin); } catch { /* not loaded yet */ }
    };
    hello();
    this.helloTimer = setInterval(hello, 500);
    this.changed();
    return true;
  }

  close(tellMesh = true): void {
    if (this.helloTimer) clearInterval(this.helloTimer);
    this.helloTimer = null;
    if (tellMesh && this.win && !this.win.closed && this.status === 'linked') {
      try { this.win.postMessage(envelope({ type: 'UNLINK' }), this.origin); } catch { /* gone */ }
    }
    window.removeEventListener('message', this.listener);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('The link to Mesh was closed.'));
    }
    this.pending.clear();
    const changed = this.status !== 'closed';
    this.win = null;
    this.status = 'closed';
    this.channels = [];
    if (changed) this.changed();
  }

  stepFor(dtMs: number, inputs: Record<string, number>, outputs: string[], timeoutMs = 5000): Promise<Stepped> {
    if (this.status !== 'linked' || !this.win || this.win.closed) {
      return Promise.reject(new Error('Mesh is not linked.'));
    }
    const seq = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`Mesh did not answer a ${dtMs}ms step within ${timeoutMs / 1000}s.`));
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
        p.reject(new Error(msg.message));
        return;
      }
      case 'UNLINK':
        this.close(false);
        return;
      default:
        return;
    }
  }
}
