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

/** Debounced undo/redo history for the circuit graph, capped at 50 snapshots. */
export function useCircuitHistory({ nodes, edges, isSimulating, stopSimulation, setNodes, setEdges }: UseCircuitHistoryArgs) {
  const historyRef = useRef<{ nodes: Node[]; edges: Edge[] }[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const [, setHistoryTrigger] = useState(0);

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
      data: (e.data as any)?.waypoints ? { waypoints: (e.data as any).waypoints } : undefined
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
        data: (e.data as any)?.waypoints ? { waypoints: (e.data as any).waypoints } : undefined
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
          waypoints: (e.data as any).waypoints ? (e.data as any).waypoints.map((w: any) => ({ ...w })) : undefined
        } : undefined
      }))
    });
    if (nextHistory.length > 50) {
      nextHistory.shift();
    }
    historyRef.current = nextHistory;
    historyIndexRef.current = nextHistory.length - 1;
    setHistoryTrigger(prev => prev + 1);
  }, []);

  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current -= 1;
      const state = historyRef.current[historyIndexRef.current];
      stopSimulation();
      setNodes(state.nodes.map(n => ({ ...n })));
      setEdges(state.edges.map(e => ({ ...e })));
      setHistoryTrigger(prev => prev + 1);
    }
  }, [stopSimulation, setNodes, setEdges]);

  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current += 1;
      const state = historyRef.current[historyIndexRef.current];
      stopSimulation();
      setNodes(state.nodes.map(n => ({ ...n })));
      setEdges(state.edges.map(e => ({ ...e })));
      setHistoryTrigger(prev => prev + 1);
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
    canUndo: historyIndexRef.current > 0,
    canRedo: historyIndexRef.current < historyRef.current.length - 1,
  };
}
