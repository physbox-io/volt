/**
 * A wire re-routes only when a wire it routes against moves.
 *
 * The drawn paths used to sit in React context, so one wire registering its
 * route re-rendered and re-routed every other wire. Each wire now watches only
 * the wires whose ids sort before its own, because those are the only ones the
 * router reads. That is safe only while it stays true, so the second half of
 * this file routes every preset's wires both ways and requires the same result.
 */
import { describe, it, expect } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { EdgePathStore, selectEarlierPaths, type EdgePaths } from '../src/components/edgePathContext';
import { getNodeDimensions, getSchematicPath } from '../src/utils/edgeRouting';
import { getHandleCoord } from '../src/utils/nodeGeometry';
import { presets } from '../src/utils/presets';

const run = (x: number) => [{ x, y: 0 }, { x, y: 10 }];

describe('selectEarlierPaths', () => {
  it('keeps its identity when only later wires, or the wire itself, move', () => {
    const all: EdgePaths = { a: run(1), m: run(2), z: run(3) };
    const first = selectEarlierPaths(all, 'm', null);
    expect(first).toEqual({ a: all.a });
    expect(selectEarlierPaths({ ...all, m: run(9), z: run(9), zz: run(9) }, 'm', first)).toBe(first);
  });

  it('changes when an earlier wire moves, arrives or leaves', () => {
    const all: EdgePaths = { a: run(1), m: run(2) };
    const first = selectEarlierPaths(all, 'm', null);
    expect(selectEarlierPaths({ ...all, a: run(5) }, 'm', first)).not.toBe(first);
    expect(selectEarlierPaths({ ...all, b: run(5) }, 'm', first)).toEqual({ a: all.a, b: run(5) });
    expect(selectEarlierPaths({ m: all.m }, 'm', first)).toEqual({});
  });
});

describe('EdgePathStore', () => {
  it('stays quiet when a wire re-registers the route it already has', () => {
    const store = new EdgePathStore();
    let calls = 0;
    store.subscribe(() => calls++);
    store.registerPath('a', run(1));
    const snapshot = store.getPaths();
    store.registerPath('a', run(1));
    store.setHoveredEdgeId(null);
    expect(calls).toBe(1);
    expect(store.getPaths()).toBe(snapshot);
    store.unregisterPath('a');
    store.unregisterPath('a');
    expect(calls).toBe(2);
  });
});

/** The side of its part a pin sits on, as React Flow would report it. */
function sideOf(node: Node, p: { x: number; y: number }): string {
  const { width, height } = getNodeDimensions(node.type ?? '', node.data);
  const w = node.measured?.width || width;
  const h = node.measured?.height || height;
  const d = {
    left: Math.abs(p.x - node.position.x),
    right: Math.abs(p.x - (node.position.x + w)),
    top: Math.abs(p.y - node.position.y),
    bottom: Math.abs(p.y - (node.position.y + h)),
  };
  return (Object.keys(d) as (keyof typeof d)[]).reduce((a, b) => (d[a] <= d[b] ? a : b));
}

function pointsOf(path: string) {
  return [...path.matchAll(/[ML]\s*(-?\d+\.?\d*)\s*[\s,]\s*(-?\d+\.?\d*)/g)]
    .map(m => ({ x: parseFloat(m[1]), y: parseFloat(m[2]) }));
}

describe('a wire routes the same against only the wires sorted before it', () => {
  const cases = Object.entries(presets)
    .map(([key, p]) => [key, p.nodes as Node[], p.edges as Edge[]] as const)
    .filter(([, nodes, edges]) => edges.length > 1 && nodes.length > 0);

  it.each(cases)('%s', (_key, nodes, edges) => {
    const byId = new Map(nodes.map(n => [n.id, n]));
    const routed = edges.filter(e => byId.has(e.source) && byId.has(e.target));
    const route = (edge: Edge, others: EdgePaths) => {
      const src = byId.get(edge.source)!;
      const tgt = byId.get(edge.target)!;
      const s = getHandleCoord(src, edge.sourceHandle || 'out');
      const t = getHandleCoord(tgt, edge.targetHandle || 'in');
      return getSchematicPath({
        sourceX: s.x, sourceY: s.y, sourcePosition: sideOf(src, s),
        targetX: t.x, targetY: t.y, targetPosition: sideOf(tgt, t),
        nodes, sourceId: edge.source, targetId: edge.target,
        edgeId: edge.id, allEdges: edges, otherEdgesPaths: others,
      });
    };

    // Walk the layout toward where the canvas settles, checking every pass:
    // the paths half-way there are what the wires route against on mount.
    let paths: EdgePaths = {};
    for (let pass = 0; pass < 3; pass++) {
      const next: EdgePaths = {};
      for (const edge of routed) {
        const full = route(edge, paths);
        expect(route(edge, selectEarlierPaths(paths, edge.id, null)), edge.id).toBe(full);
        next[edge.id] = pointsOf(full);
      }
      paths = next;
    }
  });
});
