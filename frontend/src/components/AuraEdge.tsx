import { BaseEdge, type EdgeProps, getSmoothStepPath, useReactFlow } from '@xyflow/react';
import { useEffect, useState, createContext, useContext, useMemo, useCallback, memo } from 'react';
import { playbackTicker, findIndexForTime } from '../utils/playbackTicker';

export const EdgePathContext = createContext<{
  registerPath: (id: string, points: {x: number; y: number}[]) => void;
  unregisterPath: (id: string) => void;
  junctions: {x: number; y: number}[];
  hoveredEdgeId: string | null;
  setHoveredEdgeId: (id: string | null) => void;
} | null>(null);

export function EdgePathProvider({ children, edges = [] }: { children: React.ReactNode; edges?: any[] }) {
  const [paths, setPaths] = useState<Record<string, {x: number; y: number}[]>>({});
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  const registerPath = useCallback((id: string, points: {x: number; y: number}[]) => {
    setPaths(prev => {
      if (JSON.stringify(prev[id]) === JSON.stringify(points)) return prev;
      return { ...prev, [id]: points };
    });
  }, []);

  const unregisterPath = useCallback((id: string) => {
    setPaths(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const junctions = useMemo(() => {
    const juncs: {x: number; y: number}[] = [];
    const edgeIds = Object.keys(paths);

    // 1. Group edges into connected nets (union-find)
    const parent: Record<string, string> = {};
    const find = (id: string): string => {
      if (!parent[id]) parent[id] = id;
      if (parent[id] === id) return id;
      return parent[id] = find(parent[id]);
    };
    const union = (id1: string, id2: string) => {
      const root1 = find(id1);
      const root2 = find(id2);
      if (root1 !== root2) {
        parent[root1] = root2;
      }
    };

    // Group edges by terminal key: "nodeId/handleId"
    const terminalToEdges: Record<string, string[]> = {};
    edges.forEach(e => {
      const term1 = `${e.source}/${e.sourceHandle || ''}`;
      const term2 = `${e.target}/${e.targetHandle || ''}`;
      if (!terminalToEdges[term1]) terminalToEdges[term1] = [];
      if (!terminalToEdges[term2]) terminalToEdges[term2] = [];
      terminalToEdges[term1].push(e.id);
      terminalToEdges[term2].push(e.id);
    });

    // Union edges that share a terminal
    Object.values(terminalToEdges).forEach(edgeIdsList => {
      for (let i = 1; i < edgeIdsList.length; i++) {
        union(edgeIdsList[0], edgeIdsList[i]);
      }
    });

    // 2. Identify all component terminals (source and target coordinates of all edges)
    // We should not place junction dots at component terminals.
    const terminalCoords: {x: number; y: number}[] = [];
    edgeIds.forEach(id => {
      const pts = paths[id];
      if (pts && pts.length > 0) {
        terminalCoords.push(pts[0]);
        terminalCoords.push(pts[pts.length - 1]);
      }
    });

    const isTerminalCoord = (p: {x: number; y: number}) => {
      return terminalCoords.some(tc => Math.abs(tc.x - p.x) < 1.5 && Math.abs(tc.y - p.y) < 1.5);
    };

    // 3. Convert paths to segments for each edge
    const edgeSegments: Record<string, { p1: {x: number; y: number}; p2: {x: number; y: number} }[]> = {};
    edgeIds.forEach(id => {
      const pts = paths[id];
      const segments: { p1: {x: number; y: number}; p2: {x: number; y: number} }[] = [];
      for (let i = 0; i < pts.length - 1; i++) {
        segments.push({ p1: pts[i], p2: pts[i + 1] });
      }
      edgeSegments[id] = segments;
    });

    // 4. Find intersections between horizontal segments of one edge and vertical segments of another connected edge
    const candidates: { x: number; y: number; netRoot: string }[] = [];
    const epsilon = 3;

    for (let i = 0; i < edgeIds.length; i++) {
      const id1 = edgeIds[i];
      const segs1 = edgeSegments[id1] || [];

      for (let j = i + 1; j < edgeIds.length; j++) {
        const id2 = edgeIds[j];
        // Only check if they are in the same net
        if (find(id1) !== find(id2)) continue;

        const segs2 = edgeSegments[id2] || [];

        segs1.forEach(s1 => {
          segs2.forEach(s2 => {
            const isS1Horiz = Math.abs(s1.p1.y - s1.p2.y) < 3;
            const isS1Vert = Math.abs(s1.p1.x - s1.p2.x) < 3;
            const isS2Horiz = Math.abs(s2.p1.y - s2.p2.y) < 3;
            const isS2Vert = Math.abs(s2.p1.x - s2.p2.x) < 3;

            if (isS1Horiz && isS2Vert) {
              const x = s2.p1.x;
              const y = s1.p1.y;
              const minX1 = Math.min(s1.p1.x, s1.p2.x);
              const maxX1 = Math.max(s1.p1.x, s1.p2.x);
              const minY2 = Math.min(s2.p1.y, s2.p2.y);
              const maxY2 = Math.max(s2.p1.y, s2.p2.y);

              if (x >= minX1 - epsilon && x <= maxX1 + epsilon && y >= minY2 - epsilon && y <= maxY2 + epsilon) {
                candidates.push({ x, y, netRoot: find(id1) });
              }
            } else if (isS1Vert && isS2Horiz) {
              const x = s1.p1.x;
              const y = s2.p1.y;
              const minY1 = Math.min(s1.p1.y, s1.p2.y);
              const maxY1 = Math.max(s1.p1.y, s1.p2.y);
              const minX2 = Math.min(s2.p1.x, s2.p2.x);
              const maxX2 = Math.max(s2.p1.x, s2.p2.x);

              if (x >= minX2 - epsilon && x <= maxX2 + epsilon && y >= minY1 - epsilon && y <= maxY1 + epsilon) {
                candidates.push({ x, y, netRoot: find(id1) });
              }
            }
          });
        });
      }
    }

    // 5. Filter candidates using topological check
    candidates.forEach(p => {
      if (isTerminalCoord(p)) return;

      const netEdges = edgeIds.filter(id => find(id) === p.netRoot);
      
      let hasLeft = false;
      let hasRight = false;
      let hasUp = false;
      let hasDown = false;

      netEdges.forEach(id => {
        const segs = edgeSegments[id] || [];
        segs.forEach(s => {
          const isHoriz = Math.abs(s.p1.y - s.p2.y) < 3;
          const isVert = Math.abs(s.p1.x - s.p2.x) < 3;

          if (isHoriz) {
            const minY = Math.min(s.p1.y, s.p2.y);
            const minX = Math.min(s.p1.x, s.p2.x);
            const maxX = Math.max(s.p1.x, s.p2.x);

            if (Math.abs(p.y - minY) < 3 && p.x >= minX - 3 && p.x <= maxX + 3) {
              if (minX < p.x - 3) hasLeft = true;
              if (maxX > p.x + 3) hasRight = true;
            }
          } else if (isVert) {
            const minX = Math.min(s.p1.x, s.p2.x);
            const minY = Math.min(s.p1.y, s.p2.y);
            const maxY = Math.max(s.p1.y, s.p2.y);

            if (Math.abs(p.x - minX) < 3 && p.y >= minY - 3 && p.y <= maxY + 3) {
              if (minY < p.y - 3) hasUp = true;
              if (maxY > p.y + 3) hasDown = true;
            }
          }
        });
      });

      const totalConnections = (hasLeft ? 1 : 0) + (hasRight ? 1 : 0) + (hasUp ? 1 : 0) + (hasDown ? 1 : 0);

      if (totalConnections >= 3) {
        if (!juncs.some(j => Math.abs(j.x - p.x) < 3 && Math.abs(j.y - p.y) < 3)) {
          juncs.push(p);
        }
      }
    });

    return juncs;
  }, [paths, edges]);

  const value = useMemo(() => ({ 
    registerPath, 
    unregisterPath, 
    junctions, 
    hoveredEdgeId, 
    setHoveredEdgeId 
  }), [registerPath, unregisterPath, junctions, hoveredEdgeId]);

  return (
    <EdgePathContext.Provider value={value}>
      {children}
    </EdgePathContext.Provider>
  );
}

export function getNodeDimensions(type: string, data: any) {
  const orientation = data?.orientation || 'horizontal';
  const isHorizontal = orientation === 'horizontal' || orientation === 'left';
  
  switch (type) {
    case 'resistor':
    case 'inductor':
      return isHorizontal ? { width: 40, height: 32 } : { width: 32, height: 40 };
    case 'capacitor':
      return isHorizontal ? { width: 36, height: 32 } : { width: 32, height: 36 };
    case 'diode':
    case 'zener':
      return isHorizontal ? { width: 36, height: 32 } : { width: 32, height: 36 };
    case 'led':
      return { width: 32, height: 32 };
    case 'switch':
      return isHorizontal ? { width: 48, height: 32 } : { width: 32, height: 48 };
    case 'voltage':
    case 'ground':
      return { width: 24, height: 24 };
    case 'timer555':
    case 'dFlipFlop':
      return { width: 128, height: 156 };
    case 'potentiometer':
      return { width: 48, height: 48 };
    case 'transistorNPN':
    case 'transistorPNP':
      return { width: 48, height: 48 };
    default:
      return { width: 48, height: 32 };
  }
}



interface Point {
  x: number;
  y: number;
}

interface Obstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

function manhattanDistance(p1: Point, p2: Point): number {
  return Math.abs(p1.x - p2.x) + Math.abs(p1.y - p2.y);
}

function snapToGrid(val: number, step = 8): number {
  return Math.round(val / step) * step;
}

class MinHeap<T extends { f: number }> {
  private data: T[] = [];
  get size() { return this.data.length; }
  push(item: T) {
    this.data.push(item);
    let i = this.data.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p].f <= this.data[i].f) break;
      [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
      i = p;
    }
  }
  pop(): T | undefined {
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0 && last !== undefined) {
      this.data[0] = last;
      let i = 0;
      const n = this.data.length;
      while (true) {
        let smallest = i;
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        if (l < n && this.data[l].f < this.data[smallest].f) smallest = l;
        if (r < n && this.data[r].f < this.data[smallest].f) smallest = r;
        if (smallest === i) break;
        [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
        i = smallest;
      }
    }
    return top;
  }
}

// Removes points that are redundant because their neighbors are already
// collinear with them (handles both same-list runs and points introduced by
// splicing separate point lists, e.g. lead-in + route + lead-out).
function simplifyCollinear(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1];
    const curr = points[i];
    const next = points[i + 1];
    const isCollinear = (prev.x === curr.x && curr.x === next.x) || (prev.y === curr.y && curr.y === next.y);
    if (!isCollinear) {
      result.push(curr);
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

function routeOrthogonal({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  obstacles = [],
  gridStep = 4,
  bendPenalty = 20,
  padding = 160,
  softObstacles,
  tieBreak = 0,
}: {
  sourceX: number;
  sourceY: number;
  sourcePosition: string;
  targetX: number;
  targetY: number;
  targetPosition: string;
  obstacles: Obstacle[];
  gridStep?: number;
  bendPenalty?: number;
  padding?: number;
  softObstacles?: Map<string, number>;
  tieBreak?: number;
}): string | null {
  const leadLength = 8;
  // Offset start and end points in their exit/entry directions to guarantee clean leads
  let startX = sourceX;
  let startY = sourceY;
  if (sourcePosition === 'right') startX += leadLength;
  else if (sourcePosition === 'left') startX -= leadLength;
  else if (sourcePosition === 'bottom') startY += leadLength;
  else if (sourcePosition === 'top') startY -= leadLength;

  let endX = targetX;
  let endY = targetY;
  if (targetPosition === 'right') endX += leadLength;
  else if (targetPosition === 'left') endX -= leadLength;
  else if (targetPosition === 'bottom') endY += leadLength;
  else if (targetPosition === 'top') endY -= leadLength;

  const start = { x: snapToGrid(startX, gridStep), y: snapToGrid(startY, gridStep) };
  const end = { x: snapToGrid(endX, gridStep), y: snapToGrid(endY, gridStep) };

  // Map handle positions to entry/exit directions
  const exitDirMap: Record<string, 'left' | 'right' | 'up' | 'down'> = {
    right: 'right',
    left: 'left',
    top: 'up',
    bottom: 'down',
  };
  const entryDirMap: Record<string, 'left' | 'right' | 'up' | 'down'> = {
    right: 'left',
    left: 'right',
    top: 'down',
    bottom: 'up',
  };

  const startDir = exitDirMap[sourcePosition] || 'none';
  const expectedEndDir = entryDirMap[targetPosition] || 'none';

  // Define search area boundary with padding
  const minX = Math.min(start.x, end.x) - padding;
  const maxX = Math.max(start.x, end.x) + padding;
  const minY = Math.min(start.y, end.y) - padding;
  const maxY = Math.max(start.y, end.y) + padding;

  const snappedObstacles = obstacles.map(o => ({
    x1: snapToGrid(o.x - 2, gridStep),
    y1: snapToGrid(o.y - 2, gridStep),
    x2: snapToGrid(o.x + o.width + 2, gridStep),
    y2: snapToGrid(o.y + o.height + 2, gridStep),
  }));

  function isBlocked(x: number, y: number): boolean {
    if ((x === start.x && y === start.y) || (x === end.x && y === end.y)) {
      return false;
    }
    if (x < minX || x > maxX || y < minY || y > maxY) return true;
    
    for (let i = 0; i < snappedObstacles.length; i++) {
      const obs = snappedObstacles[i];
      if (x >= obs.x1 && x <= obs.x2 && y >= obs.y1 && y <= obs.y2) {
        return true;
      }
    }
    return false;
  }

  interface State {
    x: number;
    y: number;
    dir: 'none' | 'left' | 'right' | 'up' | 'down';
    f: number;
  }

  const openSet = new MinHeap<State>();
  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, State>();
  const closedSet = new Set<string>();

  const startStateKey = `${start.x},${start.y},${startDir}`;
  gScore.set(startStateKey, 0);

  openSet.push({
    x: start.x,
    y: start.y,
    dir: startDir,
    f: 1.5 * manhattanDistance(start, end) + tieBreak,
  });

  const getNeighbors = (curr: State): State[] => {
    const dirs: { dx: number; dy: number; name: 'left' | 'right' | 'up' | 'down' }[] = [
      { dx: gridStep, dy: 0, name: 'right' },
      { dx: -gridStep, dy: 0, name: 'left' },
      { dx: 0, dy: gridStep, name: 'down' },
      { dx: 0, dy: -gridStep, name: 'up' },
    ];
    
    return dirs
      .map(d => ({
        x: curr.x + d.dx,
        y: curr.y + d.dy,
        dir: d.name,
        f: 0,
      }))
      .filter(n => !isBlocked(n.x, n.y));
  };

  let endState: State | null = null;
  let iterations = 0;
  const maxIterations = 8000;

  while (openSet.size > 0 && iterations < maxIterations) {
    iterations++;

    const curr = openSet.pop()!;

    if (curr.x === end.x && curr.y === end.y) {
      endState = curr;
      break;
    }

    const currKey = `${curr.x},${curr.y},${curr.dir}`;
    if (closedSet.has(currKey)) continue;
    closedSet.add(currKey);

    const currG = gScore.get(currKey) ?? Infinity;

    for (const neighbor of getNeighbors(curr)) {
      const isBend = curr.dir !== 'none' && curr.dir !== neighbor.dir;
      let stepCost = gridStep + (isBend ? bendPenalty : 0);

      // Check target entry direction alignment
      if (neighbor.x === end.x && neighbor.y === end.y) {
        if (expectedEndDir !== 'none' && neighbor.dir !== expectedEndDir) {
          stepCost += bendPenalty;
        }
      }

      // Soft-obstacle nudge to keep parallel wires from routing on top of
      // each other; exempt own start/end so a route is never repelled from
      // its own required entry/exit point.
      if (softObstacles && !(neighbor.x === end.x && neighbor.y === end.y) && !(neighbor.x === start.x && neighbor.y === start.y)) {
        stepCost += softObstacles.get(`${neighbor.x},${neighbor.y}`) || 0;
      }

      const tentativeG = currG + stepCost;

      const neighborKey = `${neighbor.x},${neighbor.y},${neighbor.dir}`;
      const neighborG = gScore.get(neighborKey) ?? Infinity;

      if (tentativeG < neighborG) {
        gScore.set(neighborKey, tentativeG);
        cameFrom.set(neighborKey, curr);

        openSet.push({
          x: neighbor.x,
          y: neighbor.y,
          dir: neighbor.dir,
          f: tentativeG + 1.5 * manhattanDistance(neighbor, end) + tieBreak,
        });
      }
    }
  }

  if (!endState) return null;

  const pathPoints: Point[] = [];
  let temp: State | null = endState;
  while (temp) {
    pathPoints.push({ x: temp.x, y: temp.y });
    const key = `${temp.x},${temp.y},${temp.dir}`;
    temp = cameFrom.get(key) || null;
  }
  pathPoints.reverse();

  if (pathPoints.length === 0) return null;

  // Simplify intermediate points
  const simplifiedPoints = simplifyCollinear(pathPoints);

  // Calculate orthogonal connector leads. Only insert an elbow point when the
  // diff from grid-snapping exceeds a full grid step — sub-grid rounding
  // diffs (1-3px) would otherwise produce phantom micro-jogs.
  const LEAD_EPS = gridStep;
  const startPts: Point[] = [{ x: sourceX, y: sourceY }];
  if (sourcePosition === 'left' || sourcePosition === 'right') {
    if (Math.abs(sourceY - start.y) >= LEAD_EPS) {
      startPts.push({ x: start.x, y: sourceY });
    }
  } else {
    if (Math.abs(sourceX - start.x) >= LEAD_EPS) {
      startPts.push({ x: sourceX, y: start.y });
    }
  }
  startPts.push(start);

  const endPts: Point[] = [end];
  if (targetPosition === 'left' || targetPosition === 'right') {
    if (Math.abs(targetY - end.y) >= LEAD_EPS) {
      endPts.push({ x: end.x, y: targetY });
    }
  } else {
    if (Math.abs(targetX - end.x) >= LEAD_EPS) {
      endPts.push({ x: targetX, y: end.y });
    }
  }
  endPts.push({ x: targetX, y: targetY });

  // Merge segments orthogonally
  const finalPoints: Point[] = [...startPts];
  for (let i = 1; i < simplifiedPoints.length - 1; i++) {
    finalPoints.push(simplifiedPoints[i]);
  }
  for (const pt of endPts) {
    if (finalPoints.length > 0) {
      const last = finalPoints[finalPoints.length - 1];
      if (last.x === pt.x && last.y === pt.y) continue;
    }
    finalPoints.push(pt);
  }

  // Collinear point reduction — run again post-merge since splicing
  // startPts/route/endPts together can introduce redundant points that
  // weren't collinear within any single sub-list.
  const resultPoints = simplifyCollinear(finalPoints);

  let d = `M ${resultPoints[0].x} ${resultPoints[0].y}`;
  for (let i = 1; i < resultPoints.length; i++) {
    d += ` L ${resultPoints[i].x} ${resultPoints[i].y}`;
  }
  return d;
}

export function getSchematicPath({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  sourceOffset = 24,
  allEdges = [],
  edgeId = '',
  nodes = [],
}: {
  sourceX: number;
  sourceY: number;
  sourcePosition: string;
  targetX: number;
  targetY: number;
  targetPosition: string;
  sourceOffset?: number;
  allEdges?: any[];
  edgeId?: string;
  nodes?: any[];
  sourceId?: string;
  targetId?: string;
  [key: string]: any;
}) {
  // Try obstacle-avoiding A* router first
  if (nodes && nodes.length > 0) {
    const obstacles: Obstacle[] = nodes
      .filter((n: any) => n.type !== 'junction')
      .map((n: any) => {
        const w = n.measured?.width || getNodeDimensions(n.type, n.data).width;
        const h = n.measured?.height || getNodeDimensions(n.type, n.data).height;
        return {
          x: n.position.x,
          y: n.position.y,
          width: w,
          height: h,
        };
      });

    const aStarPath = routeOrthogonal({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      obstacles,
      gridStep: 4,
      bendPenalty: 20,
    });
    
    if (aStarPath) {
      return aStarPath;
    }
  }

  // Fallback to step-path router if A* fails
  const dx = Math.abs(targetX - sourceX);
  const dy = Math.abs(targetY - sourceY);
  
  let offset = sourceOffset;
  
  let maxOffset = sourceOffset;
  if (sourcePosition === 'left' || sourcePosition === 'right') {
    if (targetPosition === 'left' || targetPosition === 'right') {
      maxOffset = dx / 2 - 4;
    } else {
      maxOffset = dx - 4;
    }
  } else {
    if (targetPosition === 'top' || targetPosition === 'bottom') {
      maxOffset = dy / 2 - 4;
    } else {
      maxOffset = dy - 4;
    }
  }

  const sortedEdgeIds = allEdges.map((e: any) => e.id).sort();
  const edgeIndex = Math.max(0, sortedEdgeIds.indexOf(edgeId));
  
  const shiftStep = 8;
  const shiftPattern = [0, 1, -1, 2, -2];
  const shiftMultiplier = shiftPattern[edgeIndex % shiftPattern.length];
  
  offset = offset + shiftMultiplier * shiftStep;
  
  if (maxOffset > 4) {
    offset = Math.min(maxOffset, Math.max(4, offset));
    if (offset === maxOffset && shiftMultiplier > 0) {
      offset = Math.max(4, maxOffset - shiftMultiplier * shiftStep);
    }
  } else {
    offset = Math.max(4, offset);
  }

  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition: sourcePosition as any,
    targetPosition: targetPosition as any,
    targetX,
    targetY,
    borderRadius: 0,
    offset,
  });
  return path;
}

function getOrthogonalPathThroughWaypoint(
  sourceX: number,
  sourceY: number,
  sourcePosition: string,
  targetX: number,
  targetY: number,
  targetPosition: string,
  W: { x: number; y: number }
) {
  const isSourceVert = sourcePosition === 'top' || sourcePosition === 'bottom';
  const isTargetVert = targetPosition === 'top' || targetPosition === 'bottom';

  let path = `M ${sourceX} ${sourceY}`;

  // S -> W
  if (isSourceVert) {
    path += ` L ${sourceX} ${W.y}`;
    path += ` L ${W.x} ${W.y}`;
  } else {
    path += ` L ${W.x} ${sourceY}`;
    path += ` L ${W.x} ${W.y}`;
  }

  // W -> T
  if (isTargetVert) {
    const minX = Math.min(sourceX, targetX);
    const maxX = Math.max(sourceX, targetX);
    const isOutside = W.x < minX || W.x > maxX;

    if (isOutside) {
      path += ` L ${W.x} ${targetY}`;
      path += ` L ${targetX} ${targetY}`;
    } else {
      path += ` L ${targetX} ${W.y}`;
      path += ` L ${targetX} ${targetY}`;
    }
  } else {
    const minY = Math.min(sourceY, targetY);
    const maxY = Math.max(sourceY, targetY);
    const isOutside = W.y < minY || W.y > maxY;

    if (isOutside) {
      path += ` L ${targetX} ${W.y}`;
      path += ` L ${targetX} ${targetY}`;
    } else {
      path += ` L ${W.x} ${targetY}`;
      path += ` L ${targetX} ${targetY}`;
    }
  }

  return path;
}

export const AuraEdge = memo(function AuraEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    style = {},
    markerEnd,
    type,
    source,
    target,
  } = props;
  const sourceHandle = (props as any).sourceHandleId || (props as any).sourceHandle;
  const targetHandle = (props as any).targetHandleId || (props as any).targetHandle;

  const { setEdges, screenToFlowPosition, getViewport, getEdges, getNodes } = useReactFlow();
  
  // Calculate distinct index for overlapping/sharing terminals to prevent wire overlaps
  const allEdges = getEdges();
  const allNodes = getNodes();
  
  const sharingSource = allEdges
    .filter(e => e.source === source && (e.sourceHandle === sourceHandle || (e as any).sourceHandleId === sourceHandle))
    .map(e => e.id)
    .sort();
  const sourceIndex = Math.max(0, sharingSource.indexOf(id));

  const sharingTarget = allEdges
    .filter(e => e.target === target && (e.targetHandle === targetHandle || (e as any).targetHandleId === targetHandle))
    .map(e => e.id)
    .sort();
  const targetIndex = Math.max(0, sharingTarget.indexOf(id));

  const minWireGap = 24;

  // Find the edge incoming to our source handle
  const incomingEdge = allEdges.find(e =>
    e.target === source &&
    (e.targetHandle === sourceHandle || (e as any).targetHandleId === sourceHandle)
  );

  let sourceOffset = minWireGap;
  if (incomingEdge) {
    // Get the source and target node of the incoming edge to see if they are facing
    const incSrcNode = allNodes.find(n => n.id === incomingEdge.source);
    const incTgtNode = allNodes.find(n => n.id === incomingEdge.target);
    if (incSrcNode && incTgtNode) {
      const incSrcOrient = incSrcNode.data?.orientation || 'horizontal';
      const incTgtOrient = incTgtNode.data?.orientation || 'horizontal';
      const incSrcVert = incSrcNode.type === 'timer555' ? false : (incSrcOrient === 'vertical' || incSrcOrient === 'up');
      const incTgtVert = incTgtNode.type === 'timer555' ? false : (incTgtOrient === 'vertical' || incTgtOrient === 'up');
      
      if (incSrcVert === incTgtVert) {
        // Facing connection — get their actual handle coordinates
        const getHandleCoord = (node: any, handleId: string) => {
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
          if (node.type === 'ground') return { x: x + w / 2, y: y };
          if (node.type === 'voltage' || node.type === 'acvoltage') {
            if (handleId === 'pos') return { x: x + w / 2, y: y };
            if (handleId === 'neg') return { x: x + w / 2, y: y + h };
          }
          if (node.type === 'junction') return { x: x, y: y };
          if (handleId === 'in') {
            if (isVertical) return { x: x + w / 2, y: isUp ? y + h : y };
            return { x: isLeft ? x + w : x, y: y + h / 2 };
          }
          if (handleId === 'out') {
            if (isVertical) return { x: x + w / 2, y: isUp ? y : y + h };
            return { x: isLeft ? x : x + w, y: y + h / 2 };
          }
          return { x: x + w / 2, y: y + h / 2 };
        };
        const pSrc = getHandleCoord(incSrcNode, incomingEdge.sourceHandle || 'out');
        const pTgt = getHandleCoord(incTgtNode, incomingEdge.targetHandle || 'in');
        
        if (incSrcVert) {
          sourceOffset = Math.abs(pSrc.y - pTgt.y) / 2;
        } else {
          sourceOffset = Math.abs(pSrc.x - pTgt.x) / 2;
        }
      }
    }
  }

  const waypoints: { x: number; y: number }[] = (data as any)?.waypoints || [];
  const [isDragging, setIsDragging] = useState(false);

  let edgePath = '';
  if (waypoints.length > 0) {
    edgePath = getOrthogonalPathThroughWaypoint(
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      waypoints[0]
    );
  } else {

    edgePath = getSchematicPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetPosition,
      targetX,
      targetY,
      sourceOffset,
      sourceIndex,
      targetIndex,
      nodes: allNodes,
      sourceId: source,
      targetId: target,
      edgeId: id,
      allEdges,
    });
  }

  const [current, setCurrent] = useState(0);
  
  useEffect(() => {
    const currentArray = data?.current_array as number[] | undefined;
    const timePoints = data?.time_points as number[] | undefined;

    if (!currentArray || !timePoints || timePoints.length === 0) {
      setCurrent(0);
      return;
    }

    const unsubscribe = playbackTicker.subscribe((elapsed) => {
      const idx = findIndexForTime(timePoints, elapsed);
      const I = Math.abs(currentArray[idx] || 0);
      setCurrent(I);
    });

    return unsubscribe;
  }, [data?.current_array, data?.time_points]);

  const points = useMemo(() => {
    const pts: {x: number; y: number}[] = [];
    const matches = edgePath.matchAll(/[ML]\s*(-?\d+\.?\d*)\s*[\s,]\s*(-?\d+\.?\d*)/g);
    for (const match of matches) {
      pts.push({ x: parseFloat(match[1]), y: parseFloat(match[2]) });
    }
    return pts;
  }, [edgePath]);

  const context = useContext(EdgePathContext);
  const { registerPath, unregisterPath } = context || {};

  const pointsKey = useMemo(() => JSON.stringify(points), [points]);

  useEffect(() => {
    if (registerPath) {
      registerPath(id, points);
      return () => {
        if (unregisterPath) unregisterPath(id);
      };
    }
  }, [id, pointsKey, registerPath, unregisterPath]);

  const myJunctions = useMemo(() => {
    if (!context) return [];
    
    // Convert current edge points to segments
    const segments: { p1: {x: number; y: number}; p2: {x: number; y: number} }[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      segments.push({ p1: points[i], p2: points[i + 1] });
    }

    // Filter junctions that lie on any of our segments
    return context.junctions.filter(j => {
      return segments.some(s => {
        const isHoriz = Math.abs(s.p1.y - s.p2.y) < 3;
        const isVert = Math.abs(s.p1.x - s.p2.x) < 3;
        if (isHoriz) {
          const minY = Math.min(s.p1.y, s.p2.y);
          const minX = Math.min(s.p1.x, s.p2.x);
          const maxX = Math.max(s.p1.x, s.p2.x);
          return Math.abs(j.y - minY) < 3 && j.x >= minX - 3 && j.x <= maxX + 3;
        } else if (isVert) {
          const minX = Math.min(s.p1.x, s.p2.x);
          const minY = Math.min(s.p1.y, s.p2.y);
          const maxY = Math.max(s.p1.y, s.p2.y);
          return Math.abs(j.x - minX) < 3 && j.y >= minY - 3 && j.y <= maxY + 3;
        }
        return false;
      });
    });
  }, [points, context]);

  const isAuraEnabled = type === 'aura';
  const auraClass = isAuraEnabled
    ? (current > 0.004 ? 'edge-aura' : (current > 0.0001 ? 'edge-aura-faint' : ''))
    : '';

  const isHovered = context?.hoveredEdgeId === id;

  const handleWireMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsDragging(true);

    const startX = e.clientX;
    const startY = e.clientY;

    const clickPos = screenToFlowPosition({ x: startX, y: startY });

    const initialW = waypoints[0] || { x: clickPos.x, y: clickPos.y };
    const initialX = initialW.x;
    const initialY = initialW.y;

    const { zoom } = getViewport();

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      
      const flowDx = dx / zoom;
      const flowDy = dy / zoom;

      const newX = Math.round((initialX + flowDx) / 4) * 4;
      const newY = Math.round((initialY + flowDy) / 4) * 4;

      setEdges((eds: any[]) => eds.map(edge => {
        if (edge.id !== id) return edge;
        return {
          ...edge,
          data: {
            ...edge.data,
            waypoints: [{ x: newX, y: newY }]
          }
        };
      }));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [id, waypoints, screenToFlowPosition, getViewport, setEdges]);

  const handleWireDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    setEdges((eds: any[]) => eds.map(edge => {
      if (edge.id !== id) return edge;
      return {
        ...edge,
        data: {
          ...edge.data,
          waypoints: []
        }
      };
    }));
  }, [id, setEdges]);
  
  return (
    <>
      <BaseEdge 
        path={edgePath} 
        markerEnd={markerEnd} 
        style={isHovered ? { 
          ...style, 
          stroke: '#10b981', 
          strokeWidth: 4,
          transition: 'stroke 0.15s ease, stroke-width 0.15s ease'
        } : style} 
        className={auraClass}
      />
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={15}
        style={{ cursor: isDragging ? 'grabbing' : 'grab', pointerEvents: 'all' }}
        onMouseDown={handleWireMouseDown}
        onDoubleClick={handleWireDoubleClick}
      />
      {myJunctions.map((pt, idx) => (
        <circle 
          key={idx}
          cx={pt.x} 
          cy={pt.y} 
          r={2} 
          fill={(style?.stroke as string) || '#555'}
          style={{ pointerEvents: 'none' }}
        />
      ))}
    </>
  );
});
