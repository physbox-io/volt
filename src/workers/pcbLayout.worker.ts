// ---------------------------------------------------------------------------
// PCB layout worker
//
// Placement + maze routing is a multi-second CPU-bound job on a dense board, so
// it runs here instead of on the main thread. The UI stays interactive and can
// show routing progress while the board is being solved.
// ---------------------------------------------------------------------------

import { generatePcbLayout, type PcbOptions, type LayoutProgress } from '../utils/pcbExporter';

export interface PcbLayoutRequest {
  type: 'LAYOUT';
  id: string;
  nodes: unknown[];
  edges: unknown[];
  options: Partial<PcbOptions>;
}

export type PcbLayoutResponse =
  | { type: 'PROGRESS'; id: string; progress: LayoutProgress }
  | { type: 'RESULT'; id: string; ok: true; result: unknown }
  | { type: 'RESULT'; id: string; ok: false; error: string };

/** The newest request wins; progress from superseded runs is dropped. */
let currentId: string | null = null;

self.onmessage = (evt: MessageEvent<PcbLayoutRequest>) => {
  const { type, id, nodes, edges, options } = evt.data ?? ({} as PcbLayoutRequest);
  if (type !== 'LAYOUT') return;

  currentId = id;

  // Progress is throttled: the router can finish a pass in a few milliseconds
  // on a small board, and posting every one of those just floods the main
  // thread we are trying to keep free.
  let lastPost = 0;
  const onProgress = (progress: LayoutProgress) => {
    if (currentId !== id) return;
    const now = Date.now();
    if (now - lastPost < 100) return;
    lastPost = now;
    const msg: PcbLayoutResponse = { type: 'PROGRESS', id, progress };
    self.postMessage(msg);
  };

  try {
    const result = generatePcbLayout(nodes as never, edges as never, options, onProgress);
    if (currentId !== id) return;
    self.postMessage({ type: 'RESULT', id, ok: true, result } satisfies PcbLayoutResponse);
  } catch (err) {
    if (currentId !== id) return;
    self.postMessage({
      type: 'RESULT',
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies PcbLayoutResponse);
  }
};
