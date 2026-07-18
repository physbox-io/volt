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

  if (node.type === 'timer555') {
    const row = parseInt(handleId);
    if (row >= 1 && row <= 4) {
      return { x: x, y: y + 26 + (row - 1) * 32 };
    }
    if (row >= 5 && row <= 8) {
      const rightRow = 8 - row;
      return { x: x + w, y: y + 26 + rightRow * 32 };
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
 */
export function findNearestEdgeAtPoint(
  nodes: Node[],
  edges: Edge[],
  point: { x: number; y: number },
  excludeNodeId?: string,
  maxDist = 16
): { edge: Edge; projectionPoint: { x: number; y: number } } | null {
  const snapX = Math.round(point.x / 8) * 8;
  const snapY = Math.round(point.y / 8) * 8;

  for (const edge of edges) {
    if (excludeNodeId && (edge.source === excludeNodeId || edge.target === excludeNodeId)) {
      continue;
    }

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

    const points: { x: number; y: number }[] = [];
    const matches = pathD.matchAll(/[ML]\s*(-?\d+\.?\d*)\s*(-?\d+\.?\d*)/g);
    for (const match of matches) {
      points.push({ x: parseFloat(match[1]), y: parseFloat(match[2]) });
    }

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];

      if (Math.abs(p1.y - p2.y) < 1) {
        const minX = Math.min(p1.x, p2.x);
        const maxX = Math.max(p1.x, p2.x);
        if (point.x >= minX - 4 && point.x <= maxX + 4) {
          const dist = Math.abs(point.y - p1.y);
          if (dist < maxDist) {
            return { edge, projectionPoint: { x: snapX, y: Math.round(p1.y / 8) * 8 } };
          }
        }
      } else if (Math.abs(p1.x - p2.x) < 1) {
        const minY = Math.min(p1.y, p2.y);
        const maxY = Math.max(p1.y, p2.y);
        if (point.y >= minY - 4 && point.y <= maxY + 4) {
          const dist = Math.abs(point.x - p1.x);
          if (dist < maxDist) {
            return { edge, projectionPoint: { x: Math.round(p1.x / 8) * 8, y: snapY } };
          }
        }
      }
    }
  }

  return null;
}
