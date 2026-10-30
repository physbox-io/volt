// A Mesh that was closed or reloaded used to stay "Mesh linked", a linked run
// against it failed as an ngspice "circuit solved to nothing", and linking
// again loaded the link URL into the Mesh window, which reloaded it and threw
// its scene away. The link now notices Mesh going, says so as a link failure,
// and reattaches to the window it already has.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HEARTBEAT_MS, MESH_WINDOW_NAME, MeshLink, MeshLinkError, envelope, type CoSimBody } from '../src/utils/coSimLink';

const MESH = 'http://localhost:5175';

/** A window Volt holds a handle to. A loaded Mesh is cross-origin, so its location cannot be read. */
function fakeWindow(blank: boolean) {
  let href = 'about:blank';
  const posted: CoSimBody[] = [];
  const win = {
    closed: false,
    focus: vi.fn(),
    postMessage: vi.fn((msg: CoSimBody) => { posted.push(msg); }),
    location: {
      get href() {
        if (!blank) throw new DOMException('Blocked a frame with origin', 'SecurityError');
        return href;
      },
      set href(v: string) { href = v; blank = false; },
    },
  };
  return { win, posted, navigatedTo: () => href };
}

/** The page Volt runs in: window.open and the message listeners. */
function fakePage() {
  const listeners = new Set<(e: MessageEvent) => void>();
  const page = {
    open: vi.fn<(url: string, name: string) => unknown>(),
    addEventListener: (_t: string, l: (e: MessageEvent) => void) => listeners.add(l),
    removeEventListener: (_t: string, l: (e: MessageEvent) => void) => listeners.delete(l),
    location: { hostname: 'localhost', protocol: 'http:' },
  };
  const deliver = (source: unknown, body: CoSimBody) => {
    for (const l of [...listeners]) l({ source, origin: MESH, data: envelope(body) } as unknown as MessageEvent);
  };
  return { page, deliver };
}

const catalogue: CoSimBody = { type: 'CATALOGUE', channels: [], timestepMs: 1, scene: 'Dial' };

describe('MeshLink when Mesh goes away', () => {
  let page: ReturnType<typeof fakePage>;
  beforeEach(() => {
    vi.useFakeTimers();
    page = fakePage();
    vi.stubGlobal('window', page.page);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** A link opened into a new window and answered. */
  function linked() {
    const mesh = fakeWindow(true);
    page.page.open.mockReturnValueOnce(mesh.win);
    const link = new MeshLink();
    expect(link.open(MESH)).toBe(true);
    page.deliver(mesh.win, catalogue);
    expect(link.status).toBe('linked');
    return { link, mesh };
  }

  it('opens a new window by name and sends only a blank one to the link URL', () => {
    const { mesh } = linked();
    expect(page.page.open).toHaveBeenCalledWith('', MESH_WINDOW_NAME);
    expect(mesh.navigatedTo()).toBe(`${MESH}/?link=volt`);
  });

  it('says a step with no Mesh is a link failure, not a solver one', async () => {
    const link = new MeshLink();
    const step = link.stepFor(10, {}, []);
    await expect(step).rejects.toBeInstanceOf(MeshLinkError);
    await expect(step).rejects.toThrow(/Mesh is not linked/);
  });

  it('stops reading linked when the Mesh window closes, and says why', async () => {
    const { link, mesh } = linked();
    const told = vi.fn();
    link.subscribe(told);
    mesh.win.closed = true;
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(link.status).toBe('closed');
    expect(link.lost).toMatch(/closed/);
    expect(told).toHaveBeenCalled();
    await expect(link.stepFor(10, {}, [])).rejects.toThrow(/Mesh is not open, or the link to it was lost/);
  });

  it('ends a step in flight when the window closes, as a link failure', async () => {
    const { link, mesh } = linked();
    const step = link.stepFor(10, {}, []);
    mesh.win.closed = true;
    vi.advanceTimersByTime(HEARTBEAT_MS);
    await expect(step).rejects.toBeInstanceOf(MeshLinkError);
  });

  it('ends the link when Mesh says UNLINK as its page goes', () => {
    const { link, mesh } = linked();
    page.deliver(mesh.win, { type: 'UNLINK' });
    expect(link.status).toBe('closed');
    expect(link.lost).toMatch(/closed or reloaded/);
  });

  it('ends the link when a reloaded Mesh answers that it is not linked', async () => {
    const { link, mesh } = linked();
    const step = link.stepFor(10, {}, []);
    const seq = (mesh.posted.at(-1) as { seq: number }).seq;
    page.deliver(mesh.win, { type: 'ERROR', seq, message: 'Mesh is not linked. Link again from Volt.' });
    await expect(step).rejects.toBeInstanceOf(MeshLinkError);
    expect(link.status).toBe('closed');
    expect(link.lost).toMatch(/reloaded/);
  });

  it('links again to the same window without loading anything into it', () => {
    const { link, mesh } = linked();
    link.close();
    mesh.posted.length = 0;
    expect(link.open(MESH)).toBe(true);
    expect(page.page.open).toHaveBeenCalledTimes(1);
    expect(mesh.win.focus).toHaveBeenCalled();
    expect(mesh.posted.some(m => m.type === 'HELLO')).toBe(true);
    page.deliver(mesh.win, catalogue);
    expect(link.status).toBe('linked');
  });

  it('finds the Mesh window by name after this page reloaded, and leaves it loaded', () => {
    const existing = fakeWindow(false);
    page.page.open.mockReturnValueOnce(existing.win);
    const link = new MeshLink();
    expect(link.open(MESH)).toBe(true);
    expect(page.page.open).toHaveBeenCalledWith('', MESH_WINDOW_NAME);
    expect(existing.win.focus).toHaveBeenCalled();
    expect(existing.posted.some(m => m.type === 'HELLO')).toBe(true);
  });
});
