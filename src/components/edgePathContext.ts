import { createContext, useCallback, useRef, useSyncExternalStore } from 'react';

type Point = { x: number; y: number };
export type EdgePaths = Record<string, Point[]>;

/**
 * The registry of drawn wire paths, plus which wire the pointer is over.
 *
 * It is a context object rather than a component, and a component file that
 * also exports one of those loses React Fast Refresh: every edit then reloads
 * the page, which resets the simulation and the circuit view mid-edit. The
 * provider that fills it is a component and stays in `AuraEdge.tsx`.
 *
 * The context carries this store, which never changes, rather than the paths
 * themselves. With the paths in context, one wire registering its route
 * re-rendered and re-routed every other wire on the canvas, and each of those
 * registering in turn did it again. Readers now subscribe to only what they
 * use: a wire to the wires it routes against, and to whether it is the one
 * hovered.
 */
export class EdgePathStore {
  private paths: EdgePaths = {};
  private hoveredEdgeId: string | null = null;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit() {
    for (const listener of this.listeners) listener();
  }

  getPaths = () => this.paths;

  registerPath = (id: string, points: Point[]) => {
    if (JSON.stringify(this.paths[id]) === JSON.stringify(points)) return;
    this.paths = { ...this.paths, [id]: points };
    this.emit();
  };

  unregisterPath = (id: string) => {
    if (!(id in this.paths)) return;
    const next = { ...this.paths };
    delete next[id];
    this.paths = next;
    this.emit();
  };

  getHoveredEdgeId = () => this.hoveredEdgeId;

  setHoveredEdgeId = (id: string | null) => {
    if (this.hoveredEdgeId === id) return;
    this.hoveredEdgeId = id;
    this.emit();
  };
}

export const EdgePathContext = createContext<EdgePathStore | null>(null);

const NO_PATHS: EdgePaths = {};
const noSubscription = () => () => {};

/** Every registered path, for readers that need the whole canvas. */
export function useEdgePaths(store: EdgePathStore | null): EdgePaths {
  return useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    store?.getPaths ?? (() => NO_PATHS),
  );
}

/**
 * The paths of the wires whose ids sort before `edgeId`.
 *
 * Those are the only ones the router reads (see `edgeRouting.ts`: soft
 * obstacles, trunk cells and sibling snapping all skip later-sorted wires —
 * that ordering is what lets the layout settle). So a wire needs to re-route
 * only when one of them moves, and the object returned here keeps its identity
 * until one does.
 */
export function selectEarlierPaths(all: EdgePaths, edgeId: string, previous: EdgePaths | null): EdgePaths {
  const earlier: EdgePaths = {};
  let count = 0;
  let same = previous !== null;
  for (const id in all) {
    if (id >= edgeId) continue;
    earlier[id] = all[id];
    count++;
    if (same && previous![id] !== all[id]) same = false;
  }
  if (same && Object.keys(previous!).length === count) return previous!;
  return earlier;
}

export function useEarlierEdgePaths(store: EdgePathStore | null, edgeId: string): EdgePaths {
  const cache = useRef<{ all: EdgePaths; edgeId: string; value: EdgePaths } | null>(null);
  const getSnapshot = useCallback(() => {
    const all = store ? store.getPaths() : NO_PATHS;
    const c = cache.current;
    if (c && c.all === all && c.edgeId === edgeId) return c.value;
    const value = selectEarlierPaths(all, edgeId, c && c.edgeId === edgeId ? c.value : null);
    cache.current = { all, edgeId, value };
    return value;
  }, [store, edgeId]);
  return useSyncExternalStore(store?.subscribe ?? noSubscription, getSnapshot);
}

export function useIsEdgeHovered(store: EdgePathStore | null, edgeId: string): boolean {
  return useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    () => store?.getHoveredEdgeId() === edgeId,
  );
}

export function useHoveredEdgeId(store: EdgePathStore | null): string | null {
  return useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    () => store?.getHoveredEdgeId() ?? null,
  );
}
