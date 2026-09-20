import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import {
  copySelection,
  duplicateSelection,
  pasteClipboard,
  rotateSelectedNodes,
  DUPLICATE_OFFSET,
} from '../src/utils/selectionEdit';
import { ORIENTABLE_NODE_TYPES, ORIENTATION_CYCLE, rotateOrientation } from '../src/utils/nodeGeometry';
import { getNodeDefaultName } from '../src/utils/nodeNaming';

const node = (id: string, type: string, data: Record<string, unknown> = {}, selected = false): Node => ({
  id, type, position: { x: 100, y: 200 }, data, selected,
});

const wire = (id: string, source: string, target: string): Edge => ({
  id, source, sourceHandle: 'out', target, targetHandle: 'in',
});

describe('R, over a selection', () => {
  it('turns every orientable part a quarter turn right, and nothing else', () => {
    for (const type of ORIENTABLE_NODE_TYPES) {
      for (const from of ORIENTATION_CYCLE) {
        const [turned] = rotateSelectedNodes([node('n1', type, { orientation: from }, true)]);
        expect(turned.data.orientation).toBe(rotateOrientation(type, from));
      }
    }
  });

  it('leaves parts that have no orientation alone rather than inventing one', () => {
    const nodes = [node('mcu-1', 'mcu', { code: 'x' }, true), node('junction-1', 'junction', {}, true)];
    expect(rotateSelectedNodes(nodes)).toBe(nodes);
    expect(nodes[0].data.orientation).toBeUndefined();
  });

  it('turns only what is selected', () => {
    const nodes = [
      node('resistor-1', 'resistor', { orientation: 'horizontal' }, true),
      node('resistor-2', 'resistor', { orientation: 'horizontal' }, false),
    ];
    const [a, b] = rotateSelectedNodes(nodes);
    expect(a.data.orientation).toBe('vertical');
    expect(b.data.orientation).toBe('horizontal');
  });

  it('comes back round to where it started after four presses', () => {
    let nodes = [node('led-1', 'led', { orientation: 'horizontal' }, true)];
    for (let i = 0; i < 4; i++) nodes = rotateSelectedNodes(nodes);
    expect(nodes[0].data.orientation).toBe('horizontal');
  });
});

describe('copy and paste', () => {
  const circuit = () => {
    const nodes = [
      node('resistor-1', 'resistor', { resistance: 1000, label: '1k' }, true),
      node('capacitor-1', 'capacitor', { capacitance: 1e-5 }, true),
      node('ground-1', 'ground', {}, false),
    ];
    const edges = [
      wire('e-in', 'resistor-1', 'capacitor-1'),
      wire('e-out', 'capacitor-1', 'ground-1'),
    ];
    return { nodes, edges };
  };

  it('takes the selected parts and the wires between two of them', () => {
    const { nodes, edges } = circuit();
    const clip = copySelection(nodes, edges);
    expect(clip.nodes.map(n => n.id)).toEqual(['resistor-1', 'capacitor-1']);
    expect(clip.edges.map(e => e.id)).toEqual(['e-in']);
  });

  it('pastes copies that share no state with their originals', () => {
    const { nodes, edges } = circuit();
    const next = pasteClipboard(nodes, edges, copySelection(nodes, edges));

    expect(next.nodes).toHaveLength(5);
    const copy = next.nodes.find(n => n.id !== 'resistor-1' && n.type === 'resistor')!;
    expect(copy.data).toEqual(nodes[0].data);
    expect(copy.data).not.toBe(nodes[0].data);

    copy.data.resistance = 47;
    expect(nodes[0].data.resistance).toBe(1000);
  });

  it('offsets the copies and hands them the selection', () => {
    const { nodes, edges } = circuit();
    const next = pasteClipboard(nodes, edges, copySelection(nodes, edges));
    const copies = next.nodes.filter(n => n.selected);

    expect(copies).toHaveLength(2);
    for (const c of copies) {
      expect(c.position).toEqual({ x: 100 + DUPLICATE_OFFSET.x, y: 200 + DUPLICATE_OFFSET.y });
    }
    expect(next.nodes.filter(n => !n.selected).map(n => n.id))
      .toEqual(['resistor-1', 'capacitor-1', 'ground-1']);
  });

  it('rewires the copied wire between the copies, never back to the originals', () => {
    const { nodes, edges } = circuit();
    const next = pasteClipboard(nodes, edges, copySelection(nodes, edges));
    const copiedIds = new Set(next.nodes.filter(n => n.selected).map(n => n.id));
    const newEdges = next.edges.filter(e => !edges.some(o => o.id === e.id));

    expect(newEdges).toHaveLength(1);
    expect(copiedIds.has(newEdges[0].source)).toBe(true);
    expect(copiedIds.has(newEdges[0].target)).toBe(true);
  });

  it('gives every copy an id nothing else on the canvas holds', () => {
    let nodes = [
      node('resistor-1', 'resistor', {}, true),
      node('resistor-2', 'resistor', {}, false),
      node('resistor-3', 'resistor', {}, false),
    ];
    let edges: Edge[] = [];
    for (let i = 0; i < 6; i++) {
      const next = duplicateSelection(nodes, edges);
      nodes = next.nodes;
      edges = next.edges;
      const ids = nodes.map(n => n.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(nodes).toHaveLength(9);
  });

  it('gives a copy an id the reference designator can still be read out of', () => {
    const nodes = [node('resistor-1', 'resistor', {}, true), node('resistor-2', 'resistor', {}, false)];
    const next = duplicateSelection(nodes, []);
    const copy = next.nodes.find(n => n.selected)!;
    expect(copy.id).toBe('resistor-3');
    expect(getNodeDefaultName(copy.id, 'resistor')).toBe('R3');
  });

  it('drops a renamed part\'s designator so the copy is not a second R4', () => {
    const nodes = [node('resistor-1', 'resistor', { name: 'R4', resistance: 10 }, true)];
    const copy = duplicateSelection(nodes, []).nodes.find(n => n.selected)!;
    expect(copy.data.name).toBeUndefined();
    expect(copy.data.resistance).toBe(10);
  });

  it('does nothing at all with an empty clipboard or an empty selection', () => {
    const { nodes, edges } = circuit();
    expect(pasteClipboard(nodes, edges, { nodes: [], edges: [] })).toEqual({ nodes, edges });

    const unselected = nodes.map(n => ({ ...n, selected: false }));
    const next = duplicateSelection(unselected, edges);
    expect(next.nodes).toEqual(unselected);
  });

  it('keeps a named net named, so a copied rail is the same rail', () => {
    const nodes = [node('powerrail-1', 'powerrail', { rail: '+5V', voltage: 5 }, true)];
    const copy = duplicateSelection(nodes, []).nodes.find(n => n.selected)!;
    expect(copy.data.rail).toBe('+5V');
  });
});
