import { useCallback, useEffect, useRef, useState } from 'react';
import type { Node, Edge } from '@xyflow/react';

interface UseCircuitHistoryArgs {
  nodes: Node[];
  edges: Edge[];
  isSimulating: boolean;
  stopSimulation: () => void;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
}

/**
 * The one field an edge's data bag carries: the elbow a wire was dragged to.
 * Snapshots keep it and drop everything else, so an edge comes back out of the
 * history routed the way it was drawn.
 */
type Waypoint = { x: number; y: number };

const waypointsOf = (data: Edge['data']): Waypoint[] | undefined =>
  data?.waypoints as Waypoint[] | undefined;

/** Debounced undo/redo history for the circuit graph, capped at 50 snapshots. */
export function useCircuitHistory({ nodes, edges, isSimulating, stopSimulation, setNodes, setEdges }: UseCircuitHistoryArgs) {
  const historyRef = useRef<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const historyIndexRef = useRef<number>(-1);
  /*
   * Where in the stack we are, mirrored into state.
   *
   * The snapshots themselves live in refs so that a push does not re-render the
   * app, but `canUndo`/`canRedo` are read during render — and a render that
   * reads a ref is a render React is entitled to skip or reuse, so the buttons
   * could sit greyed out over a stack that had something in it. This is written
   * at exactly the three points that used to bump a re-render trigger.
   */
  const [position, setPosition] = useState({ index: -1, length: 0 });

  const pushHistory = useCallback((newNodes: Node[], newEdges: Edge[]) => {
    const cleanNewNodes = newNodes.map(n => ({
      id: n.id,
      type: n.type,
      position: { x: Math.round(n.position?.x ?? 0), y: Math.round(n.position?.y ?? 0) },
      data: {
        ...n.data,
        isSimulating: undefined,
        selected: undefined
      }
    }));
    const cleanNewEdges = newEdges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      data: waypointsOf(e.data) ? { waypoints: waypointsOf(e.data) } : undefined
    }));

    const lastState = historyRef.current[historyIndexRef.current];
    if (lastState) {
      const cleanLastNodes = lastState.nodes.map(n => ({
        id: n.id,
        type: n.type,
        position: { x: Math.round(n.position?.x ?? 0), y: Math.round(n.position?.y ?? 0) },
        data: {
          ...n.data,
          isSimulating: undefined,
          selected: undefined
        }
      }));
      const cleanLastEdges = lastState.edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        data: waypointsOf(e.data) ? { waypoints: waypointsOf(e.data) } : undefined
      }));

      const nodesEqual = JSON.stringify(cleanLastNodes) === JSON.stringify(cleanNewNodes);
      const edgesEqual = JSON.stringify(cleanLastEdges) === JSON.stringify(cleanNewEdges);
      if (nodesEqual && edgesEqual) {
        return;
      }
    }

    const nextHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
    nextHistory.push({
      nodes: newNodes.map(n => ({ ...n })),
      edges: newEdges.map(e => ({
        ...e,
        data: e.data ? {
          ...e.data,
          waypoints: waypointsOf(e.data)?.map(w => ({ ...w }))
        } : undefined
      }))
    });
    if (nextHistory.length > 50) {
      nextHistory.shift();
    }
    historyRef.current = nextHistory;
    historyIndexRef.current = nextHistory.length - 1;
    setPosition({ index: historyIndexRef.current, length: nextHistory.length });
  }, []);

  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current -= 1;
      const state = historyRef.current[historyIndexRef.current];
      stopSimulation();
      setNodes(state.nodes.map(n => ({ ...n })));
      setEdges(state.edges.map(e => ({ ...e })));
      setPosition({ index: historyIndexRef.current, length: historyRef.current.length });
    }
  }, [stopSimulation, setNodes, setEdges]);

  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current += 1;
      const state = historyRef.current[historyIndexRef.current];
      stopSimulation();
      setNodes(state.nodes.map(n => ({ ...n })));
      setEdges(state.edges.map(e => ({ ...e })));
      setPosition({ index: historyIndexRef.current, length: historyRef.current.length });
    }
  }, [stopSimulation, setNodes, setEdges]);

  // Track structural updates to push to history
  useEffect(() => {
    if (isSimulating) return;
    const timer = setTimeout(() => {
      pushHistory(nodes, edges);
    }, 400);
    return () => clearTimeout(timer);
  }, [nodes, edges, isSimulating, pushHistory]);

  return {
    undo,
    redo,
    canUndo: position.index > 0,
    canRedo: position.index < position.length - 1,
  };
}
