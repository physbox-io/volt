import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';
import {
  emptyPcbLayout,
  layoutBoardKey,
  projectLayoutEdges,
  projectLayoutNodes,
  reemitPcbGcode,
  restorePcbLayout,
  GCODE_ONLY_OPTIONS,
  type LayoutProgress,
  type PcbLayoutResult,
  type PcbOptions,
} from '../utils/pcbExporter';
import { layoutWithOverrides } from '../utils/pcbNudge';
import { loadLayoutSnapshot, saveLayoutSnapshot } from '../utils/storage';
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
  /** Which rung of the effort ladder is being run, 1-based. */
  effortStep: number;
  /** How many rungs there are. */
  effortSteps: number;
}

/**
 * Wall-clock budgets the router is given, tried in order until the board comes
 * out fully routed.
 *
 * This used to be a dropdown offering 2s, 8s, 30s and 2min, and the dropdown
 * was the wrong shape for the problem: a budget is not a quality dial. What
 * rescues a board that stalls is the placement search, which runs on its own
 * whenever the first pass falls short. Time barely enters into it.
 *
 * Measured, across every shipped preset and several deliberately over-squeezed
 * variants of them:
 *
 *   - Boards that route: the outcome is identical at every budget, and only
 *     the wait changes. The densest preset came out 100% routed in 8s at the
 *     bottom setting and 56s at the top.
 *   - Boards that do not route: more time buys nothing worth having. Squeezed
 *     to 0.9mm traces and clearances, opAmpAmp stalled at 76.5% on both 2s
 *     (12.8s wall) and 2min (48.4s wall) — same four nets unrouted for four
 *     times the wait. bistableMultivibrator went from 72.7% to 77.3%, one net
 *     out of twenty-two, for 15s against 87s.
 *
 * The top rung is 2min even so. Nothing that routes ever reaches it — every
 * rung stops the moment a board comes out fully routed — so the whole cost of
 * having it falls on boards that were going to fail, and for those an extra
 * minute is a fair price for the occasional net it does close. The measurements
 * above are the argument for not *starting* there, which is what the dropdown
 * made people do; they are not an argument for giving up early.
 */
export const ROUTING_BUDGET_LADDER = [2000, 8000, 30000, 120000] as const;

/**
 * Whether a result is worth escalating from.
 *
 * Only an incompletely routed board is: a circuit with nothing placeable in it,
 * or one that failed for a reason time cannot fix, would otherwise climb the
 * whole ladder to arrive at the same answer four times over.
 */
export function wantsMoreEffort(result: PcbLayoutResult): boolean {
  return result.components.length > 0 && result.completion < 1;
}

/**
 * Completed layouts, keyed by the inputs that produced them.
 *
 * Module-level, because the hook unmounts with the export dialog: without this
 * a user who closes the panel and reopens it pays for a full place-and-route
 * again to look at the same board. A handful of entries is enough to cover
 * flipping a setting and flipping it back; the oldest is dropped past that.
 */
interface CachedLayout {
  result: PcbLayoutResult;
  /** The G-code-only options the stored result's program was emitted under. */
  gcodeKey: string;
}

const layoutCache = new Map<string, CachedLayout>();
// A result carries its G-code with it, so these are not small. Enough to hold
// every rung of the ladder for one board, plus the board either side of a
// setting the user is toggling — a climb that had its own rungs evicted would
// re-run them from scratch on the way back.
const LAYOUT_CACHE_LIMIT = 8;

/**
 * The board most recently written to storage, so reopening the panel on a
 * board that came out of storage does not serialise it straight back. Tens of
 * kilobytes, on a path that runs every time the dialog is mounted.
 */
let lastSavedBoardKey: string | null = null;

function rememberLayout(key: string, entry: CachedLayout) {
  layoutCache.delete(key);
  layoutCache.set(key, entry);
  while (layoutCache.size > LAYOUT_CACHE_LIMIT) {
    layoutCache.delete(layoutCache.keys().next().value as string);
  }
}

/** Identity of the options that only decide how a layout is written out. */
const gcodeKeyOf = (options: Partial<PcbOptions>) =>
  JSON.stringify(GCODE_ONLY_OPTIONS.map(k => options[k] ?? null));

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
  {
    /**
     * Whether there is anything to route for.
     *
     * The bench dialog — connect, jog, zero — is reached through the same
     * component as the board panel, and mounting it therefore started a
     * place-and-route for a board nothing on screen was going to show. On a
     * dense circuit that is not a wasted millisecond but a wasted ladder: the
     * router climbs 2s, 8s, 30s and 120s budgets before it gives up, so
     * opening the panel to press Connect left a worker pegged for minutes
     * while the operator wondered what the machine was waiting for.
     *
     * Feeding the hook empty arrays was the first attempt and is not the same
     * thing: it still spawns a worker, still routes, and still settles a
     * result, only for a board with nothing on it.
     */
    enabled = true,
    // Long enough to swallow a slider drag or a burst of typing in the numeric
    // fields — a full re-place-and-route is far too expensive to run per keystroke.
    debounceMs = 450,
  }: { enabled?: boolean; debounceMs?: number } = {}
): PcbLayoutState {
  /**
   * Which rung of the effort ladder this board is on. Keyed to `boardKey` so a
   * new circuit resets to rung 0 synchronously on the same render instead of
   * racing a separate effect.
   */
  const boardKey = useMemo(() => layoutBoardKey(nodes, edges, options), [nodes, edges, options]);
  const [rungState, setRungState] = useState<{ boardKey: string; rung: number }>({
    boardKey,
    rung: 0,
  });
  const rung = rungState.boardKey === boardKey ? rungState.rung : 0;
  const budgetMs = ROUTING_BUDGET_LADDER[rung];

  /*
   * A stable key for the inputs, so unrelated re-renders do not re-route. The
   * budget is deliberately not part of it: it is this hook's decision rather
   * than the caller's, and a board is the same board at every rung.
   */
  const payload = useMemo(
    () => ({
      nodes: projectLayoutNodes(nodes),
      edges: projectLayoutEdges(edges),
      options: { ...options, routingBudgetMs: budgetMs },
    }),
    [nodes, edges, options, budgetMs]
  );
  const gcodeKey = useMemo(() => gcodeKeyOf(payload.options), [payload]);
  const cacheKey = `${boardKey}|${budgetMs}`;

  // Keep latest raw inputs in refs so the layout effect keys strictly on
  // semantic keys (`cacheKey`/`gcodeKey`) and never cancels an in-flight
  // worker on unrelated parent re-renders.
  const latestRef = useRef({ nodes, edges, payload });
  latestRef.current = { nodes, edges, payload };

  const effortOf = (r: number) => ({ effortStep: r + 1, effortSteps: ROUTING_BUDGET_LADDER.length });

  const [state, setState] = useState<PcbLayoutState>(() => {
    const cached = enabled ? layoutCache.get(cacheKey) : undefined;
    return cached
      ? { result: cached.result, isRouting: false, progress: null, hasResult: true, ...effortOf(0) }
      : {
          result: emptyPcbLayout(options, enabled ? 'Routing…' : 'No board requested'),
          isRouting: enabled,
          progress: null,
          hasResult: false,
          ...effortOf(0),
        };
  });

  /**
   * Takes a finished layout and either settles on it or climbs a rung.
   */
  const settle = useCallback(
    (result: PcbLayoutResult, allowClimb = true) => {
      const climbing = allowClimb && wantsMoreEffort(result) && rung < ROUTING_BUDGET_LADDER.length - 1;
      if (!climbing && result.snapshot && result.snapshot.boardKey !== lastSavedBoardKey) {
        saveLayoutSnapshot(result.snapshot);
        lastSavedBoardKey = result.snapshot.boardKey;
      }
      setState({
        result,
        isRouting: climbing,
        progress: null,
        hasResult: true,
        effortStep: (climbing ? rung + 1 : rung) + 1,
        effortSteps: ROUTING_BUDGET_LADDER.length,
      });
      if (climbing) setRungState({ boardKey, rung: rung + 1 });
    },
    [boardKey, rung]
  );

  const workerRef = useRef<Worker | null>(null);
  const supported = useRef(typeof Worker !== 'undefined');

  const stopWorker = () => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  };

  useEffect(() => {
    if (!enabled) {
      stopWorker();
      return;
    }
    let cancelled = false;
    const { nodes: curNodes, edges: curEdges, payload: curPayload } = latestRef.current;

    if (!layoutCache.has(cacheKey)) {
      const stored = loadLayoutSnapshot();
      const restored = restorePcbLayout(stored, curNodes, curEdges, curPayload.options);
      if (restored) {
        stopWorker();
        lastSavedBoardKey = stored!.boardKey;
        rememberLayout(cacheKey, { result: restored, gcodeKey });
        // Persisted snapshots already represent a settled layout — do not
        // climb the effort ladder and replay restorePcbLayout 4 times.
        settle(restored, false);
        return;
      }
    }

    const cached = layoutCache.get(cacheKey);
    if (cached) {
      stopWorker();
      if (cached.gcodeKey !== gcodeKey) {
        const reemitted = reemitPcbGcode(cached.result, curPayload.options);
        rememberLayout(cacheKey, { result: reemitted, gcodeKey });
        settle(reemitted);
        return;
      }
      settle(cached.result);
      return;
    }

    const runSync = () => {
      try {
        const result = layoutWithOverrides(
          curPayload.nodes as never,
          curPayload.edges as never,
          curPayload.options
        );
        rememberLayout(cacheKey, { result, gcodeKey });
        if (cancelled) return;
        settle(result);
      } catch (err) {
        if (cancelled) return;
        setState(prev => ({
          ...prev,
          result: emptyPcbLayout(curPayload.options, err instanceof Error ? err.message : String(err)),
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
      stopWorker();

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

      const failWorker = (reason: string) => {
        if (workerRef.current === worker) workerRef.current = null;
        worker.terminate();
        if (cancelled) return;
        setState(prev => ({
          ...prev,
          result: emptyPcbLayout(curPayload.options, reason),
          isRouting: false,
          progress: null,
          hasResult: true,
        }));
      };

      worker.onmessage = (evt: MessageEvent<PcbLayoutResponse>) => {
        const msg = evt.data;
        if (cancelled || msg.id !== id) return;
        if (msg.type === 'PROGRESS') {
          setState(prev => ({ ...prev, progress: msg.progress }));
          return;
        }
        if (workerRef.current === worker) workerRef.current = null;
        worker.terminate();
        if (msg.ok === true) {
          rememberLayout(cacheKey, { result: msg.result as PcbLayoutResult, gcodeKey });
          settle(msg.result as PcbLayoutResult);
        } else {
          setState(prev => ({
            ...prev,
            result: emptyPcbLayout(curPayload.options, msg.error),
            isRouting: false,
            progress: null,
            hasResult: true,
          }));
        }
      };

      worker.onerror = err => {
        console.warn('[pcb] worker error', err.message);
        failWorker(err.message || 'PCB layout worker failed.');
      };

      worker.onmessageerror = () => {
        console.warn('[pcb] worker message deserialization failed');
        failWorker('PCB layout worker returned an unreadable message.');
      };

      const req: PcbLayoutRequest = {
        type: 'LAYOUT',
        id,
        nodes: curPayload.nodes,
        edges: curPayload.edges,
        options: curPayload.options,
      };
      try {
        worker.postMessage(req);
      } catch (err) {
        console.warn('[pcb] could not post to worker', err);
        failWorker(err instanceof Error ? err.message : String(err));
      }
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      stopWorker();
    };
  }, [enabled, boardKey, cacheKey, gcodeKey, debounceMs, settle]);

  useEffect(() => () => stopWorker(), []);

  return state;
}
