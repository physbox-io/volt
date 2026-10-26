import type { Node, Edge } from '@xyflow/react';

/**
 * The circuit as a standalone JSON file — the one Export JSON writes and
 * Import JSON reads back.
 */
export function downloadCircuitJson(nodes: Node[], edges: Edge[]): void {
  const dataStr = JSON.stringify({ nodes, edges }, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'circuit_volt_scene.json';
  a.click();
  URL.revokeObjectURL(url);
}

/*
 * The circuit on the canvas, as of the last render that committed.
 *
 * The canvas is React state in App, so a render error that unmounts App takes
 * it with it. This copy is a module, which outlives the tree, so the crash page
 * still has something to save.
 */
let openCircuit: { nodes: Node[]; edges: Edge[] } | null = null;

export function noteOpenCircuit(nodes: Node[], edges: Edge[]): void {
  openCircuit = { nodes, edges };
}

/** Downloads the last circuit the canvas showed. False when it never showed one. */
export function downloadOpenCircuit(): boolean {
  if (!openCircuit) return false;
  downloadCircuitJson(openCircuit.nodes, openCircuit.edges);
  return true;
}
