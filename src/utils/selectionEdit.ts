// ---------------------------------------------------------------------------
// What the canvas hotkeys do to a selection.
//
// Rotating, duplicating and pasting are all the same shape of operation: take
// the nodes and edges as they are, hand back the nodes and edges as they should
// be. Keeping that here rather than inside the key handler is what makes the
// rules testable — that a copy is a copy and not a second reference to the same
// data, that a wire between two copied parts is copied with them, and that a
// wire out of the selection is not.
// ---------------------------------------------------------------------------

import type { Node, Edge } from '@xyflow/react';
import { ORIENTABLE_NODE_TYPES, rotateOrientation } from './nodeGeometry';

/** How far a duplicate or a paste lands from the original, in canvas units. */
export const DUPLICATE_OFFSET = { x: 24, y: 24 };

/**
 * A quarter turn right for every selected part that can be turned.
 *
 * Rotation is rigid — the pins go round with the body, carrying their wires —
 * so nothing has to be done to the edges. Parts with no orientation (an MCU, a
 * junction, a net label) are left exactly as they are rather than being given
 * a field their symbol does not read.
 */
export function rotateSelectedNodes(nodes: Node[]): Node[] {
  let turned = false;
  const next = nodes.map(node => {
    if (!node.selected) return node;
    if (!ORIENTABLE_NODE_TYPES.includes(node.type || '')) return node;
    turned = true;
    return {
      ...node,
      data: {
        ...node.data,
        orientation: rotateOrientation(node.type || '', (node.data as { orientation?: unknown })?.orientation),
      },
    };
  });
  // The same array back when nothing turned, so a stray R over an empty canvas
  // does not push an identical entry onto the undo history.
  return turned ? next : nodes;
}

/** A snapshot of a selection, detached from the canvas it came from. */
export interface ClipboardContents {
  nodes: Node[];
  edges: Edge[];
}

/**
 * The selected parts and the wires that run between two of them.
 *
 * A wire with one end outside the selection is left behind: pasting it would
 * tie the copy back to the original, which is never what copying half a circuit
 * means.
 */
export function copySelection(nodes: Node[], edges: Edge[]): ClipboardContents {
  const picked = nodes.filter(n => n.selected);
  const ids = new Set(picked.map(n => n.id));
  return {
    nodes: picked.map(cloneNode),
    edges: edges.filter(e => ids.has(e.source) && ids.has(e.target)).map(e => ({ ...e })),
  };
}

/**
 * Drops a copy of `clipboard` onto `nodes`/`edges`, offset and selected.
 *
 * The copies are what ends up selected — the same thing every editor does, so
 * that a paste can be dragged into place, or pasted again to walk a row of
 * parts across the canvas.
 */
export function pasteClipboard(
  nodes: Node[],
  edges: Edge[],
  clipboard: ClipboardContents,
  offset: { x: number; y: number } = DUPLICATE_OFFSET,
): { nodes: Node[]; edges: Edge[] } {
  if (!clipboard.nodes.length) return { nodes, edges };

  const used = new Set(nodes.map(n => n.id));
  const idMap = new Map<string, string>();

  const copies = clipboard.nodes.map(node => {
    const id = freshId(node.type || 'node', used);
    used.add(id);
    idMap.set(node.id, id);
    const copy = cloneNode(node);
    return {
      ...copy,
      id,
      position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
      selected: true,
      /*
       * A reference designator is derived from the id unless the part carries
       * its own `name`, so a copy of R4 becomes R7 by itself — but a copy of a
       * part that *was* renamed would otherwise arrive as a second R4. Drop the
       * override and let the copy be named after its own id.
       */
      data: stripName(copy.data),
    };
  });

  const edgeIds = new Set(edges.map(e => e.id));
  const copiedEdges = clipboard.edges.flatMap(edge => {
    const source = idMap.get(edge.source);
    const target = idMap.get(edge.target);
    if (!source || !target) return [];
    let id = `${edge.id}-copy`;
    for (let n = 2; edgeIds.has(id); n++) id = `${edge.id}-copy${n}`;
    edgeIds.add(id);
    return [{ ...edge, id, source, target, selected: true }];
  });

  return {
    nodes: [...nodes.map(deselect), ...copies],
    edges: [...edges.map(deselect), ...copiedEdges],
  };
}

/** Ctrl+D: copy the selection and paste it in one step, without the clipboard. */
export function duplicateSelection(
  nodes: Node[],
  edges: Edge[],
  offset: { x: number; y: number } = DUPLICATE_OFFSET,
): { nodes: Node[]; edges: Edge[] } {
  return pasteClipboard(nodes, edges, copySelection(nodes, edges), offset);
}

/**
 * An id of the shape the canvas already uses, `type-n`.
 *
 * Not `resistor-3-copy`: `getNodeDefaultName` reads the number out of the id to
 * call the part R3, and anything else about the shape leaves a part on the
 * schematic labelled with its whole node id.
 */
function freshId(type: string, used: Set<string>): string {
  let n = 1;
  while (used.has(`${type}-${n}`)) n++;
  return `${type}-${n}`;
}

function cloneNode(node: Node): Node {
  return {
    ...node,
    position: { ...node.position },
    // Deep, because a copy that shares `data` with its original is two symbols
    // wired to one set of properties: editing either would edit both.
    data: structuredClone(node.data),
  };
}

function stripName(data: Node['data']): Node['data'] {
  if (!data || typeof data !== 'object' || !('name' in data)) return data;
  const { name: _name, ...rest } = data as Record<string, unknown>;
  return rest;
}

function deselect<T extends { selected?: boolean }>(item: T): T {
  return item.selected ? { ...item, selected: false } : item;
}
