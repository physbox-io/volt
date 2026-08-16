import { useCallback } from 'react';
import type { Node, Edge } from '@xyflow/react';

interface UseCircuitFileArgs {
  nodes: Node[];
  edges: Edge[];
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  stopSimulation: () => void;
}

/** Export/import the circuit graph as a standalone JSON file. */
export function useCircuitFile({ nodes, edges, setNodes, setEdges, stopSimulation }: UseCircuitFileArgs) {
  const exportJson = useCallback(() => {
    try {
      const dataStr = JSON.stringify({ nodes, edges }, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'circuit_volt_scene.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to export JSON', e);
      alert('Failed to export JSON');
    }
  }, [nodes, edges]);

  const importJson = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target?.result as string);
          if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
            stopSimulation();
            setNodes(parsed.nodes);
            setEdges(parsed.edges);
          } else {
            alert('Invalid circuit JSON format. Must contain "nodes" and "edges" arrays.');
          }
        } catch (err) {
          alert('Failed to parse JSON file');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [stopSimulation, setNodes, setEdges]);

  return { exportJson, importJson };
}
