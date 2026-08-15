import type { Node, Edge } from '@xyflow/react';
import { getNodeDimensions, getSchematicPath } from '../components/AuraEdge';

// Two-terminal component types whose orientation can be flipped, and whose
// handle ids get remapped (anode<->cathode, in<->out) when that happens.
export const ORIENTABLE_NODE_TYPES = ['diode', 'zener', 'led', 'resistor', 'capacitor', 'inductor', 'switch'];

export const ORIENTATION_HANDLE_REMAP: Record<string, string> = {
  anode: 'cathode',
  cathode: 'anode',
  in: 'out',
  out: 'in',
};

export function getHandlesForNode(node: Node): string[] {
  if (node.type === 'timer555') {
    return ['1', '2', '3', '4', '5', '6', '7', '8'];
  }
  if (node.type === 'ground') {
    return ['in'];
  }
  if (node.type === 'voltage' || node.type === 'acvoltage') {
    return ['pos', 'neg'];
  }
  if (node.type === 'junction') {
    return ['in', 'out'];
  }
  return ['in', 'out'];
}

export function getHandleCoord(node: any, handleId: string): { x: number; y: number } {
  const orientation = node.data?.orientation || 'horizontal';
  const isLeft = orientation === 'left';
  const isUp = orientation === 'up';
  const isVertical = orientation === 'vertical' || isUp;

  const x = node.position.x;
  const y = node.position.y;
  const w = node.measured?.width || getNodeDimensions(node.type, node.data).width;
  const h = node.measured?.height || getNodeDimensions(node.type, node.data).height;

  // Diode/LED pins are electrically named but sit where in/out sit; without
  // this mapping they fell through to the node-center fallback, which put
  // edge hit-testing (junction drops) and overlap merging off by half a body.
  if (handleId === 'anode') handleId = 'in';
  else if (handleId === 'cathode') handleId = 'out';

  // Instrument cards (sig gen, mic, speaker) hang their ground pin off the
  // bottom edge; 'out'/'in' already resolve to the correct side below.
  if (handleId === 'gnd' && (node.type === 'signalgen' || node.type === 'microphone' || node.type === 'speaker')) {
    return { x: x + w / 2, y: y + h };
  }

  // Pins 1-4 run down the left, 8-5 down the right, on a fixed 16px pitch
  // starting 32px below the node origin. Timer555Node.tsx lays the rows out
  // with explicit heights so these constants stay true.
  if (node.type === 'timer555') {
    const row = parseInt(handleId);
    const PIN_ROW_TOP = 32;
    const PIN_PITCH = 16;
    if (row >= 1 && row <= 4) {
      return { x, y: y + PIN_ROW_TOP + (row - 1) * PIN_PITCH };
    }
    if (row >= 5 && row <= 8) {
      return { x: x + w, y: y + PIN_ROW_TOP + (8 - row) * PIN_PITCH };
    }
  }

  if (node.type === 'ground') {
    return { x: x + w / 2, y: y };
  }

  if (node.type === 'voltage' || node.type === 'acvoltage') {
    if (handleId === 'pos') return { x: x + w / 2, y: y };
    if (handleId === 'neg') return { x: x + w / 2, y: y + h };
  }

  if (node.type === 'junction') {
    return { x: x, y: y };
  }

  if (handleId === 'in') {
    if (isVertical) {
      return { x: x + w / 2, y: isUp ? y + h : y };
    } else {
      return { x: isLeft ? x + w : x, y: y + h / 2 };
    }
  }
  if (handleId === 'out') {
    if (isVertical) {
      return { x: x + w / 2, y: isUp ? y : y + h };
    } else {
      return { x: isLeft ? x : x + w, y: y + h / 2 };
    }
  }

  return { x: x + w / 2, y: y + h / 2 };
}

export const getHandlePosition = (node: any, handleId: string): string => {
  if (node.type === 'timer555') {
    const pin = parseInt(handleId);
    if (pin >= 1 && pin <= 4) return 'left';
    if (pin >= 5 && pin <= 8) return 'right';
  }
  if (node.type === 'opamp') {
    if (handleId === 'vcc') return 'top';
    if (handleId === 'vee') return 'bottom';
    if (handleId === 'out') return 'right';
    return 'left';
  }
  if (node.type === 'voltage' || node.type === 'acvoltage') {
    const isHorizontal = node.data?.orientation === 'horizontal';
    if (handleId === 'pos') return isHorizontal ? 'left' : 'top';
    if (handleId === 'neg') return isHorizontal ? 'right' : 'bottom';
  }
  if (node.type === 'ground') {
    return 'top';
  }
  if (node.type === 'junction') {
    return 'left';
  }
  if (node.type === 'scope') {
    return 'left';
  }
  if (node.type === 'multimeter') {
    return 'bottom';
  }
  if (handleId === 'gnd') {
    return 'bottom';
  }
  // Default components
  const orientation = node.data?.orientation || 'horizontal';
  const isLeft = orientation === 'left';
  const isUp = orientation === 'up';
  const isVertical = orientation === 'vertical' || isUp;
  if (handleId === 'in' || handleId === 'anode') {
    return isVertical ? (isUp ? 'bottom' : 'top') : (isLeft ? 'right' : 'left');
  }
  if (handleId === 'out' || handleId === 'cathode') {
    return isVertical ? (isUp ? 'top' : 'bottom') : (isLeft ? 'left' : 'right');
  }
  return 'right';
};

/**
 * Finds the edge whose rendered schematic path passes within `maxDist` of
 * `point`, excluding edges connected to `excludeNodeId`. Used both for live
 * junction-preview while dragging a connection and for splitting an edge
 * when a junction/ground node is dropped onto it.
 *
 * Prefer passing `renderedPaths` (the EdgePathContext registry) — those are
 * the wires exactly as drawn. The fallback recomputes each path from this
 * file's hand-maintained handle geometry, which only approximates instrument
 * pins (scope/multimeter/MCU handles resolve to the node center), so hits on
 * those wires can land visibly off.
 */
export function findNearestEdgeAtPoint(
  nodes: Node[],
  edges: Edge[],
  point: { x: number; y: number },
  excludeNodeId?: string,
  maxDist = 16,
  renderedPaths?: Record<string, { x: number; y: number }[]>
): { edge: Edge; projectionPoint: { x: number; y: number } } | null {
  const snapX = Math.round(point.x / 8) * 8;
  const snapY = Math.round(point.y / 8) * 8;

  for (const edge of edges) {
    if (excludeNodeId && (edge.source === excludeNodeId || edge.target === excludeNodeId)) {
      continue;
    }

    let points = renderedPaths?.[edge.id];
    if (!points || points.length < 2) {
      const srcNode: any = nodes.find(n => n.id === edge.source);
      const tgtNode: any = nodes.find(n => n.id === edge.target);
      if (!srcNode || !tgtNode) continue;

      const sourceHandle = edge.sourceHandle || 'out';
      const targetHandle = edge.targetHandle || 'in';
      const pSrc = getHandleCoord(srcNode, sourceHandle);
      const pTgt = getHandleCoord(tgtNode, targetHandle);

      const pathD = getSchematicPath({
        sourceX: pSrc.x,
        sourceY: pSrc.y,
        sourcePosition: getHandlePosition(srcNode, sourceHandle),
        targetX: pTgt.x,
        targetY: pTgt.y,
        targetPosition: getHandlePosition(tgtNode, targetHandle),
        nodes,
        sourceId: edge.source,
        targetId: edge.target,
      });

      points = [];
      const matches = pathD.matchAll(/[ML]\s*(-?\d+\.?\d*)\s*(-?\d+\.?\d*)/g);
      for (const match of matches) {
        points.push({ x: parseFloat(match[1]), y: parseFloat(match[2]) });
      }
    }

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];

      // The projection point snaps to the grid only ALONG the wire; across the
      // wire it must keep the segment's exact coordinate. Wire runs are not
      // guaranteed to lie on the 8px grid (a pin at x=516, say), and snapping
      // the cross-axis used to shift the spliced junction a few px off the
      // wire — the dot floated beside the line and the replacement edges
      // picked up a permanent jog.
      if (Math.abs(p1.y - p2.y) < 1) {
        const minX = Math.min(p1.x, p2.x);
        const maxX = Math.max(p1.x, p2.x);
        if (point.x >= minX - 4 && point.x <= maxX + 4) {
          const dist = Math.abs(point.y - p1.y);
          if (dist < maxDist) {
            const along = Math.min(maxX, Math.max(minX, snapX));
            return { edge, projectionPoint: { x: along, y: p1.y } };
          }
        }
      } else if (Math.abs(p1.x - p2.x) < 1) {
        const minY = Math.min(p1.y, p2.y);
        const maxY = Math.max(p1.y, p2.y);
        if (point.y >= minY - 4 && point.y <= maxY + 4) {
          const dist = Math.abs(point.x - p1.x);
          if (dist < maxDist) {
            const along = Math.min(maxY, Math.max(minY, snapY));
            return { edge, projectionPoint: { x: p1.x, y: along } };
          }
        }
      }
    }
  }

  return null;
}
