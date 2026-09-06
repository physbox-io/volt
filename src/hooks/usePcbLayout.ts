import { useEffect, useMemo, useRef, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';
import {
  emptyPcbLayout,
  generatePcbLayout,
  type LayoutProgress,
  type PcbLayoutResult,
  type PcbOptions,
} from '../utils/pcbExporter';
import type { PcbLayoutRequest, PcbLayoutResponse } from '../workers/pcbLayout.worker';

export interface PcbLayoutState {
  /** The most recent completed layout. Stays put while a new one is computed. */
  result: PcbLayoutResult;
  /** True while a layout is in flight. */
  isRouting: boolean;
  /** Routing progress for the in-flight layout, if any. */
  progress: LayoutProgress | null;
  /** True once a layout has completed at least once. */
  hasResult: boolean;
}

/**
 * Strips anything the worker cannot structured-clone. React Flow node data can
 * hold callbacks and, in a few places, back-references to other nodes, either
 * of which would make postMessage throw.
 */
function sanitize<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'function' ? (undefined as T) : value;
  }
  if (seen.has(value as object)) return undefined as T;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map(v => sanitize(v, seen)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'function') continue;
    out[k] = sanitize(v, seen);
  }
  return out as T;
}

const projectNodes = (nodes: Node[]) =>
  nodes.map(n => sanitize({ id: n.id, type: n.type, position: n.position, data: n.data }));

const projectEdges = (edges: Edge[]) =>
  edges.map(e =>
    sanitize({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: e.type,
      data: e.data,
    })
  );

/**
 * Completed layouts, keyed by the inputs that produced them.
 *
 * Module-level, because the hook unmounts with the export dialog: without this
 * a user who closes the panel and reopens it pays for a full place-and-route
 * again to look at the same board. A handful of entries is enough to cover
 * flipping a setting and flipping it back; the oldest is dropped past that.
 */
const layoutCache = new Map<string, PcbLayoutResult>();
// A result carries its G-code with it, so these are not small. Four is enough
// to hold the board either side of a setting the user is toggling.
const LAYOUT_CACHE_LIMIT = 4;

function rememberLayout(key: string, result: PcbLayoutResult) {
  layoutCache.delete(key);
  layoutCache.set(key, result);
  while (layoutCache.size > LAYOUT_CACHE_LIMIT) {
    layoutCache.delete(layoutCache.keys().next().value as string);
  }
}

/**
 * Runs `generatePcbLayout` in a worker, keeping the UI responsive while a dense
 * board is routed. Falls back to a synchronous layout where workers are not
 * available.
 *
 * Requests are debounced, and a superseded request terminates the worker rather
 * than queueing behind it — a routing pass can run for seconds and there is no
 * way to interrupt it from the inside.
 */
export function usePcbLayout(
  nodes: Node[],
  edges: Edge[],
  options: Partial<PcbOptions>,
  // Long enough to swallow a slider drag or a burst of typing in the numeric
  // fields — a full re-place-and-route is far too expensive to run per keystroke.
  debounceMs = 450
): PcbLayoutState {
  // A stable key for the inputs, so unrelated re-renders do not re-route.
  const payload = useMemo(
    () => ({ nodes: projectNodes(nodes), edges: projectEdges(edges), options }),
    [nodes, edges, options]
  );
  const cacheKey = useMemo(() => JSON.stringify(payload), [payload]);

  const [state, setState] = useState<PcbLayoutState>(() => {
    const cached = layoutCache.get(cacheKey);
    return cached
      ? { result: cached, isRouting: false, progress: null, hasResult: true }
      : {
          result: emptyPcbLayout(options, 'Routing…'),
          isRouting: true,
          progress: null,
          hasResult: false,
        };
  });

  const workerRef = useRef<Worker | null>(null);
  const supported = useRef(typeof Worker !== 'undefined');

  useEffect(() => {
    let cancelled = false;

    // Already routed these exact inputs — show that result rather than paying
    // for the same search again.
    const cached = layoutCache.get(cacheKey);
    if (cached) {
      setState({ result: cached, isRouting: false, progress: null, hasResult: true });
      return;
    }

    const runSync = () => {
      try {
        const result = generatePcbLayout(payload.nodes as never, payload.edges as never, options);
        rememberLayout(cacheKey, result);
        if (cancelled) return;
        setState({ result, isRouting: false, progress: null, hasResult: true });
      } catch (err) {
        if (cancelled) return;
        setState(prev => ({
          ...prev,
          result: emptyPcbLayout(options, err instanceof Error ? err.message : String(err)),
          isRouting: false,
          progress: null,
          hasResult: true,
        }));
      }
    };

    const timer = setTimeout(() => {
      setState(prev => ({ ...prev, isRouting: true, progress: null }));

      if (!supported.current) {
        runSync();
        return;
      }

      // Terminate any in-flight run: it is CPU-bound and cannot be interrupted.
      workerRef.current?.terminate();

      let worker: Worker;
      try {
        worker = new Worker(new URL('../workers/pcbLayout.worker.ts', import.meta.url), {
          type: 'module',
        });
      } catch (err) {
        console.warn('[pcb] worker unavailable, routing on the main thread', err);
        supported.current = false;
        runSync();
        return;
      }
      workerRef.current = worker;

      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      worker.onmessage = (evt: MessageEvent<PcbLayoutResponse>) => {
        const msg = evt.data;
        if (cancelled || msg.id !== id) return;
        if (msg.type === 'PROGRESS') {
          setState(prev => ({ ...prev, progress: msg.progress }));
          return;
        }
        if (msg.ok === true) {
          rememberLayout(cacheKey, msg.result as PcbLayoutResult);
          setState({
            result: msg.result as PcbLayoutResult,
            isRouting: false,
            progress: null,
            hasResult: true,
          });
        } else {
          setState(prev => ({
            ...prev,
            result: emptyPcbLayout(options, msg.error),
            isRouting: false,
            progress: null,
            hasResult: true,
          }));
        }
      };

      worker.onerror = err => {
        if (cancelled) return;
        console.warn('[pcb] worker failed, falling back to the main thread', err.message);
        supported.current = false;
        worker.terminate();
        runSync();
      };

      const req: PcbLayoutRequest = {
        type: 'LAYOUT',
        id,
        nodes: payload.nodes,
        edges: payload.edges,
        options: payload.options,
      };
      try {
        worker.postMessage(req);
      } catch (err) {
        console.warn('[pcb] could not post to worker, routing on the main thread', err);
        supported.current = false;
        worker.terminate();
        runSync();
      }
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [payload, cacheKey, debounceMs]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  return state;
}
