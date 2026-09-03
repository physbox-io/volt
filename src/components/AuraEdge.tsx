import { BaseEdge, type EdgeProps, getSmoothStepPath, useReactFlow } from '@xyflow/react';
import { useEffect, useState, createContext, useContext, useMemo, useCallback, memo } from 'react';
import { playbackTicker, findIndexForTime } from '../utils/playbackTicker';
import { getHandleCoord } from '../utils/nodeGeometry';
import { getEffectiveMcuConfig } from '../utils/mcuConfig';
import { getPinHeaderSize } from './nodes/PinHeaderNode';
import { getCutoutSize } from './nodes/CutoutNode';

// Junction dots are owned entirely by JunctionNode.tsx: every real electrical
// T-tap in this app is created via the wire-drop-splice flow in App.tsx,
// which always inserts an explicit `type: 'junction'` node (JunctionNode
// renders its own dot). AuraEdge previously also tried to *infer* junction
// dots from where same-net wire paths geometrically crossed, but that was
// never able to trigger at a real JunctionNode (terminal coordinates were
// explicitly excluded) — it only produced false positives/negatives at
// incidental A* route crossings. That inference has been removed; if a
// future code path ever merges 3+ wires onto a net without going through a
// JunctionNode, dots for that case won't appear.
export const EdgePathContext = createContext<{
  registerPath: (id: string, points: {x: number; y: number}[]) => void;
  unregisterPath: (id: string) => void;
  paths: Record<string, {x: number; y: number}[]>;
  hoveredEdgeId: string | null;
  setHoveredEdgeId: (id: string | null) => void;
} | null>(null);

export function EdgePathProvider({ children }: { children: React.ReactNode; edges?: any[] }) {
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

  const value = useMemo(() => ({
    registerPath,
    unregisterPath,
    paths,
    hoveredEdgeId,
    setHoveredEdgeId
  }), [registerPath, unregisterPath, paths, hoveredEdgeId]);

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
      return { width: 128, height: 156 };
    // The registry spells these `dff`, `npn` and `pmos` — the old
    // `dFlipFlop`/`transistorNPN` spellings matched no node type, so every one
    // of these parts silently took the 48x32 default instead.
    case 'dff':
      return { width: 80, height: 80 };
    case 'potentiometer':
      return { width: 48, height: 48 };
    case 'npn':
    case 'pnp':
      return { width: 32, height: 32 };
    case 'nmos':
    case 'pmos':
      return { width: 48, height: 48 };
    case 'transformer':
      return { width: 48, height: 48 };
    case 'acvoltage':
    case 'currentsource':
      return { width: 40, height: 40 };
    case 'mcu': {
      const cfg = getEffectiveMcuConfig(data);
      const leftCount = cfg.pins.filter(p => p.side === 'left').length;
      const rightCount = cfg.pins.filter(p => p.side === 'right').length;
      const topCount = cfg.pins.filter(p => p.side === 'top').length;
      const bottomCount = cfg.pins.filter(p => p.side === 'bottom').length;
      const maxSidePins = Math.max(leftCount, rightCount, 4);
      const maxEdgePins = Math.max(topCount, bottomCount, 0);
      const width = Math.max(96, (maxEdgePins + 1) * 24);
      const height = Math.max(128, 28 + maxSidePins * 22);
      return { width, height };
    }
    case 'pinheader':
      return getPinHeaderSize(data);
    case 'via':
      return { width: 16, height: 16 };
    case 'mountinghole':
      return { width: 22, height: 22 };
    case 'jumper':
      return isHorizontal ? { width: 44, height: 24 } : { width: 24, height: 44 };
    case 'ldr':
      return { width: 48, height: 48 };
    case 'cutout':
      return getCutoutSize(data);
    /*
     * Everything else — the instrument cards, whose height follows their
     * content and so cannot be stated here honestly. This is only ever a
     * stand-in for code with no rendered node to measure; anything that can
     * reach `measured` must prefer it, and `clampToPin` refuses to work from
     * this figure at all.
     */
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

/**
 * Pull the first and last straight runs onto their handle's own axis.
 *
 * A* works on a snapped grid, so its first point can sit up to gridStep/2 off
 * the true pin coordinate on the cross axis. Joining them directly draws a
 * short diagonal off every pin; inserting an elbow instead draws a 1-3px jog.
 * Neither belongs on a schematic. Shifting the whole terminal run onto the pin
 * axis removes both: the wire leaves the pin perpendicular and stays on its
 * axis until the first real corner, which absorbs the remainder.
 */
function alignTerminalRuns(
  points: Point[],
  sourceX: number,
  sourceY: number,
  sourcePosition: string,
  targetX: number,
  targetY: number,
  targetPosition: string,
): Point[] {
  if (points.length < 3) return points;
  const pts = points.map(p => ({ ...p }));
  const isHorizontal = (pos: string) => pos === 'left' || pos === 'right';
  const isVertical = (pos: string) => pos === 'top' || pos === 'bottom';
  const same = (a: number, b: number) => Math.abs(a - b) < 0.01;

  // Leading run: every interior point sharing pts[1]'s cross-axis value. The
  // run's value is captured up front — the loop overwrites it as it goes.
  // Direction-agnostic endpoints (junction dots, position 'none') skip
  // alignment — there is no pin axis to pull the run onto.
  const last = pts.length - 1;
  if (isHorizontal(sourcePosition)) {
    const runY = pts[1].y;
    for (let i = 1; i < last && same(pts[i].y, runY); i++) pts[i].y = sourceY;
  } else if (isVertical(sourcePosition)) {
    const runX = pts[1].x;
    for (let i = 1; i < last && same(pts[i].x, runX); i++) pts[i].x = sourceX;
  }

  // Trailing run, walked back from the target end.
  if (isHorizontal(targetPosition)) {
    const runY = pts[last - 1].y;
    for (let i = last - 1; i > 0 && same(pts[i].y, runY); i--) pts[i].y = targetY;
  } else if (isVertical(targetPosition)) {
    const runX = pts[last - 1].x;
    for (let i = last - 1; i > 0 && same(pts[i].x, runX); i--) pts[i].x = targetX;
  }

  return pts;
}

/**
 * Insert a corner wherever a segment still runs diagonally.
 *
 * `alignTerminalRuns` can leave one when a path's leading and trailing runs are
 * the same run — a straight hop between two pins whose cross-axis coordinates
 * differ by a pixel or two. Both ends want that run on their own axis and the
 * second write wins, so the mismatch reappears as a slant. Giving it its own
 * corner turns it into a (tiny) step, which is what a schematic would draw.
 */
function squareOffDiagonals(points: Point[], sourcePosition: string): Point[] {
  const out: Point[] = [points[0]];
  let incomingHorizontal = sourcePosition === 'left' || sourcePosition === 'right';

  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const cur = points[i];
    const dx = Math.abs(cur.x - prev.x);
    const dy = Math.abs(cur.y - prev.y);

    if (dx > 0.01 && dy > 0.01) {
      out.push(incomingHorizontal ? { x: cur.x, y: prev.y } : { x: prev.x, y: cur.y });
      incomingHorizontal = !incomingHorizontal;
    } else if (dx > 0.01 || dy > 0.01) {
      incomingHorizontal = dx > dy;
    }
    out.push(cur);
  }

  return out;
}

export function routeOrthogonal({
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
  trunkCells,
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
  trunkCells?: Set<string>;
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

  // Barely-inflated heuristic: at 1.5 the search was greedy enough to commit
  // to corridor-hugging routes with extra lane-shift zigzags (each one two
  // needless bends) rather than exploring a clean 2-bend detour around a
  // component. 1.1 keeps most of the speedup without visibly suboptimal wires.
  const H_WEIGHT = 1.1;

  openSet.push({
    x: start.x,
    y: start.y,
    dir: startDir,
    f: H_WEIGHT * manhattanDistance(start, end) + tieBreak,
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
  const maxIterations = 24000;

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

      // Wires on the same net should share one trunk and branch late, not run
      // as parallel duplicates. Travelling along a cell an already-routed
      // same-net wire occupies is nearly free, so A* prefers to merge onto
      // it. Only the TRAVEL is discounted — discounting bends as well let
      // routes bounce on and off a trunk for free, drawing 4px zigzags along
      // pin rows wherever an obstacle interrupted the trunk.
      let travel = gridStep;
      if (trunkCells && trunkCells.has(`${neighbor.x},${neighbor.y}`)) {
        travel *= TRUNK_DISCOUNT;
      }
      let stepCost = travel + (isBend ? bendPenalty : 0);

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
          f: tentativeG + H_WEIGHT * manhattanDistance(neighbor, end) + tieBreak,
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

  // Join the routed grid path to the true (unsnapped) handle points. The
  // cross-axis gap here is only ever the grid-snapping remainder — at most
  // gridStep/2 — because `start`/`end` are the handle points offset along
  // their own axis and then snapped. `alignTerminalRuns` below absorbs that
  // remainder into the first real corner, so no elbow is needed here.
  const startPts: Point[] = [{ x: sourceX, y: sourceY }, start];
  const endPts: Point[] = [end, { x: targetX, y: targetY }];

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
  const resultPoints = simplifyCollinear(
    squareOffDiagonals(
      alignTerminalRuns(finalPoints, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition),
      sourcePosition,
    )
  );

  let d = `M ${resultPoints[0].x} ${resultPoints[0].y}`;
  for (let i = 1; i < resultPoints.length; i++) {
    d += ` L ${resultPoints[i].x} ${resultPoints[i].y}`;
  }
  return d;
}

const TRUNK_DISCOUNT = 0.12; // running along a same-net wire is near-free
const SOFT_PENALTY = 14; // < bendPenalty (20) so a lane-shift beats a new bend
const SELF_EXEMPT_RADIUS = 12; // px around own start/end; never soft-penalize there

function buildSoftObstacles(
  otherEdgesPaths: Record<string, Point[]>,
  edgeId: string,
  sameNetIds: Set<string>,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  gridStep: number
): Map<string, number> {
  const softObstacles = new Map<string, number>();
  const otherIds = Object.keys(otherEdgesPaths);
  if (otherIds.length === 0) return softObstacles;

  // Deterministic lower-id-only ordering: an edge only avoids edges that
  // sort before it. This makes avoidance a DAG (no A-avoids-B-avoids-A
  // flip-flop) so the layout provably settles instead of oscillating.
  const sortedIds = [...otherIds, edgeId].sort();
  const myRank = sortedIds.indexOf(edgeId);

  for (const otherId of otherIds) {
    if (sortedIds.indexOf(otherId) > myRank) continue;
    // Never repel a wire from its own net — that is what split a single trunk
    // into parallel duplicate runs.
    if (sameNetIds.has(otherId)) continue;
    const pts = otherEdgesPaths[otherId];
    if (!pts || pts.length < 2) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const isHoriz = p1.y === p2.y;
      const isVert = p1.x === p2.x;
      if (!isHoriz && !isVert) continue;
      const minX = Math.min(p1.x, p2.x);
      const maxX = Math.max(p1.x, p2.x);
      const minY = Math.min(p1.y, p2.y);
      const maxY = Math.max(p1.y, p2.y);
      for (let x = snapToGrid(minX, gridStep); x <= maxX; x += gridStep) {
        for (let y = snapToGrid(minY, gridStep); y <= maxY; y += gridStep) {
          if (isHoriz && y !== snapToGrid(p1.y, gridStep)) continue;
          if (isVert && x !== snapToGrid(p1.x, gridStep)) continue;
          if (manhattanDistance({ x, y }, { x: sourceX, y: sourceY }) < SELF_EXEMPT_RADIUS) continue;
          if (manhattanDistance({ x, y }, { x: targetX, y: targetY }) < SELF_EXEMPT_RADIUS) continue;
          const key = `${x},${y}`;
          softObstacles.set(key, Math.max(softObstacles.get(key) || 0, SOFT_PENALTY));
        }
      }
    }
  }
  return softObstacles;
}

/**
 * Merge near-miss parallel runs onto a same-net sibling's run.
 *
 * The A* trunk-cell discount only helps when the search actually expands the
 * trunk corridor — its heuristic prices all travel at full cost, so a
 * discounted lane a few px off the explored corridor is never reached, and
 * two same-net wires end up descending 4-8px apart ("two wires doing the
 * same thing"). This post-pass fixes that geometrically: any interior run
 * lying within SNAP_DIST of a parallel sibling run with substantial overlap
 * is shifted exactly onto it, provided the moved run and the small neighbor
 * extensions stay clear of obstacles. Only lower-sorted siblings are snapped
 * to (same rank order as trunk-following), and a snapped run lands exactly
 * on the sibling, so the pass is idempotent and the layout still settles.
 */
const SNAP_DIST = 8;

function snapRunsToSiblings(points: Point[], sibPaths: Point[][], obstacles: Obstacle[]): Point[] {
  const pts = points.map(p => ({ ...p }));

  for (let i = 1; i + 2 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const vertical = Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) > 0.01;
    const horizontal = Math.abs(a.y - b.y) < 0.01 && Math.abs(a.x - b.x) > 0.01;
    if (!vertical && !horizontal) continue;

    const runLo = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
    const runHi = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
    const runPos = vertical ? a.x : a.y;
    const minOverlap = Math.min(24, (runHi - runLo) / 2);

    let snapTo: number | null = null;
    let snapGap = SNAP_DIST + 1;
    for (const sib of sibPaths) {
      for (let s = 0; s < sib.length - 1; s++) {
        const p1 = sib[s];
        const p2 = sib[s + 1];
        const sibVertical = Math.abs(p1.x - p2.x) < 0.01;
        if (sibVertical !== vertical) continue;
        const sibPos = vertical ? p1.x : p1.y;
        const gap = Math.abs(sibPos - runPos);
        if (gap < 0.01 || gap > SNAP_DIST || gap >= snapGap) continue;
        const sibLo = vertical ? Math.min(p1.y, p2.y) : Math.min(p1.x, p2.x);
        const sibHi = vertical ? Math.max(p1.y, p2.y) : Math.max(p1.x, p2.x);
        if (Math.min(runHi, sibHi) - Math.max(runLo, sibLo) < minOverlap) continue;
        snapTo = sibPos;
        snapGap = gap;
      }
    }
    if (snapTo == null) continue;

    // The shift must not flip either neighbor segment's direction.
    const prev = pts[i - 1];
    const next = pts[i + 2];
    const prevAnchor = vertical ? prev.x : prev.y;
    const nextAnchor = vertical ? next.x : next.y;
    if ((prevAnchor - runPos) * (prevAnchor - snapTo) < 0) continue;
    if ((nextAnchor - runPos) * (nextAnchor - snapTo) < 0) continue;

    // The moved run plus the two tiny neighbor extensions must stay clear.
    const moved: [Point, Point] = vertical
      ? [{ x: snapTo, y: runLo }, { x: snapTo, y: runHi }]
      : [{ x: runLo, y: snapTo }, { x: runHi, y: snapTo }];
    const extA: [Point, Point] = vertical
      ? [{ x: Math.min(runPos, snapTo), y: a.y }, { x: Math.max(runPos, snapTo), y: a.y }]
      : [{ x: a.x, y: Math.min(runPos, snapTo) }, { x: a.x, y: Math.max(runPos, snapTo) }];
    const extB: [Point, Point] = vertical
      ? [{ x: Math.min(runPos, snapTo), y: b.y }, { x: Math.max(runPos, snapTo), y: b.y }]
      : [{ x: b.x, y: Math.min(runPos, snapTo) }, { x: b.x, y: Math.max(runPos, snapTo) }];
    if (
      segmentIntersectsObstacle(moved[0], moved[1], obstacles) ||
      segmentIntersectsObstacle(extA[0], extA[1], obstacles) ||
      segmentIntersectsObstacle(extB[0], extB[1], obstacles)
    ) continue;

    if (vertical) {
      a.x = snapTo;
      b.x = snapTo;
    } else {
      a.y = snapTo;
      b.y = snapTo;
    }
  }

  return simplifyCollinear(pts);
}

// Whether an orthogonal polyline passes within `tol` px of a point. For
// axis-aligned segments the inflated-bbox test IS the distance test.
function pathNearPoint(pts: Point[], p: Point, tol: number): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (
      p.x >= Math.min(a.x, b.x) - tol && p.x <= Math.max(a.x, b.x) + tol &&
      p.y >= Math.min(a.y, b.y) - tol && p.y <= Math.max(a.y, b.y) + tol
    ) return true;
  }
  return false;
}

function segmentIntersectsObstacle(p1: Point, p2: Point, obstacles: Obstacle[]): boolean {
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);
  return obstacles.some(o => minX < o.x + o.width && maxX > o.x && minY < o.y + o.height && maxY > o.y);
}

function pathIntersectsObstacles(path: string, obstacles: Obstacle[]): boolean {
  const points: Point[] = [];
  const matches = path.matchAll(/[ML]\s*(-?\d+\.?\d*)\s*[\s,]\s*(-?\d+\.?\d*)/g);
  for (const match of matches) {
    points.push({ x: parseFloat(match[1]), y: parseFloat(match[2]) });
  }
  for (let i = 0; i < points.length - 1; i++) {
    if (segmentIntersectsObstacle(points[i], points[i + 1], obstacles)) return true;
  }
  return false;
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
  otherEdgesPaths = {},
  sourceIndex = 0,
  targetIndex = 0,
  sourceId,
  targetId,
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
  otherEdgesPaths?: Record<string, Point[]>;
  sourceIndex?: number;
  targetIndex?: number;
  [key: string]: any;
}) {
  // Try obstacle-avoiding A* router first
  if (nodes && nodes.length > 0) {
    // Straight shot: when the two pins already share an axis and nothing sits
    // between them, one segment is the answer. Worth special-casing because A*
    // must approach a pin perpendicular to its face, so a horizontal wire into
    // a top-facing pin (a resistor feeding the anode of a vertical LED, say)
    // would otherwise detour above the pin and come back down — a visible bump
    // on an otherwise straight run.
    // The two nodes being joined keep their bodies as obstacles too — a wire
    // must never run through its own component (a supply's pin-to-pin line
    // would otherwise cut straight across the symbol). Their boxes are only
    // shrunk enough that a wire terminating on the boundary pin still passes.
    const PIN_INSET = 5;
    const spanObstacles: Obstacle[] = nodes
      .filter((n: any) => n.type !== 'junction')
      .map((n: any) => {
        const w = n.measured?.width || getNodeDimensions(n.type, n.data).width;
        const h = n.measured?.height || getNodeDimensions(n.type, n.data).height;
        const own = n.id === sourceId || n.id === targetId;
        const i = own ? PIN_INSET : 0;
        return { x: n.position.x + i, y: n.position.y + i, width: w - 2 * i, height: h - 2 * i };
      })
      .filter((o: Obstacle) => o.width > 0 && o.height > 0);
    // React Flow insets an edge endpoint a couple of px into its handle, so
    // "same axis" is a small tolerance rather than equality; the run is then
    // snapped onto the source pin's axis so it stays perfectly straight.
    let sp = clampToPin(nodes, sourceX, sourceY, sourcePosition, sourceId);
    let tp = clampToPin(nodes, targetX, targetY, targetPosition, targetId);

    // A junction is a direction-agnostic dot, but its handles are declared
    // Position.Left, which made the router leave/enter it horizontally with
    // an 8px lead — a dog-leg around every junction that sits on a vertical
    // wire. Neutralize the direction and pin the endpoint exactly on the dot
    // (React Flow reports the handle center half a px off the 1px node).
    const srcJunction = nodes.find((n: any) => n.id === sourceId && n.type === 'junction');
    const tgtJunction = nodes.find((n: any) => n.id === targetId && n.type === 'junction');
    const srcPos = srcJunction ? 'none' : sourcePosition;
    const tgtPos = tgtJunction ? 'none' : targetPosition;
    if (srcJunction) sp = { x: srcJunction.position.x, y: srcJunction.position.y };
    if (tgtJunction) tp = { x: tgtJunction.position.x, y: tgtJunction.position.y };

    const AXIS_EPS = 4;
    const straight =
      Math.abs(sp.y - tp.y) <= AXIS_EPS && Math.abs(sp.x - tp.x) > 8
        ? { x: tp.x, y: sp.y }
        : Math.abs(sp.x - tp.x) <= AXIS_EPS && Math.abs(sp.y - tp.y) > 8
          ? { x: sp.x, y: tp.y }
          : null;
    if (straight && !segmentIntersectsObstacle(sp, straight, spanObstacles)) {
      return `M ${sp.x} ${sp.y} L ${straight.x} ${straight.y}`;
    }

    // Same own-node treatment as the straight-shot case above: the two nodes
    // being joined keep their bodies as obstacles, shrunk by PIN_INSET so a
    // wire can run along its own pin row. With full-size own boxes, a route
    // leaving a pin sideways had to hop 4px around its own component's
    // inflated box and back — a signature micro-zigzag at almost every pin.
    const obstacles: Obstacle[] = nodes
      .filter((n: any) => n.type !== 'junction')
      .map((n: any) => {
        const w = n.measured?.width || getNodeDimensions(n.type, n.data).width;
        const h = n.measured?.height || getNodeDimensions(n.type, n.data).height;
        const own = n.id === sourceId || n.id === targetId;
        const i = own ? PIN_INSET : 0;
        return { x: n.position.x + i, y: n.position.y + i, width: w - 2 * i, height: h - 2 * i };
      })
      .filter((o: Obstacle) => o.width > 0 && o.height > 0);

    const otherPaths: Record<string, Point[]> = {};
    for (const [id, pts] of Object.entries(otherEdgesPaths)) {
      if (id !== edgeId) otherPaths[id] = pts;
    }
    // Edges that share a port with this one carry the same net. They should
    // merge into a single trunk rather than each drawing its own parallel run,
    // so they are excluded from soft-repulsion and their already-routed cells
    // become cheap to travel along.
    const me = allEdges.find((e: any) => e.id === edgeId);
    const sameNetIds = new Set<string>();
    if (me) {
      const myPorts = new Set([
        `${me.source}-${me.sourceHandle || 'out'}`,
        `${me.target}-${me.targetHandle || 'in'}`,
      ]);
      for (const e of allEdges) {
        if (e.id === edgeId) continue;
        const a = `${e.source}-${e.sourceHandle || 'out'}`;
        const b = `${e.target}-${e.targetHandle || 'in'}`;
        if (myPorts.has(a) || myPorts.has(b)) sameNetIds.add(e.id);
      }
    }

    // Only follow trunks already laid by same-net edges that sort before this
    // one. The ordering is what makes the layout settle: following ALL
    // siblings lets two same-net wires leapfrog onto each other's previous
    // lane forever (each pass they swap — a live re-render loop). Rank makes
    // it a DAG: the first-sorted edge routes free and everyone later merges
    // onto it. Whether followers CAN merge is the router's job — the A*
    // heuristic has to be near-admissible or the leader picks a lane its
    // siblings are physically unable to join (e.g. one that dead-ends inside
    // a follower's own body), which is where parallel duplicate runs came
    // from historically.
    const trunkCells = new Set<string>();
    for (const sibId of sameNetIds) {
      if (sibId >= edgeId) continue;
      const pts = otherPaths[sibId];
      if (!pts || pts.length < 2) continue;
      for (let i = 0; i < pts.length - 1; i++) {
        const p1 = pts[i], p2 = pts[i + 1];
        if (p1.x !== p2.x && p1.y !== p2.y) continue;
        const x1 = snapToGrid(Math.min(p1.x, p2.x), 4), x2 = snapToGrid(Math.max(p1.x, p2.x), 4);
        const y1 = snapToGrid(Math.min(p1.y, p2.y), 4), y2 = snapToGrid(Math.max(p1.y, p2.y), 4);
        for (let x = x1; x <= x2; x += 4) for (let y = y1; y <= y2; y += 4) trunkCells.add(`${x},${y}`);
      }
    }

    const softObstacles = buildSoftObstacles(otherPaths, edgeId, sameNetIds, sourceX, sourceY, targetX, targetY, 4);
    const tieBreak = (sourceIndex + targetIndex) * 0.001;


    let aStarPath = routeOrthogonal({
      sourceX: sp.x,
      sourceY: sp.y,
      sourcePosition: srcPos,
      targetX: tp.x,
      targetY: tp.y,
      targetPosition: tgtPos,
      obstacles,
      gridStep: 4,
      bendPenalty: 20,
      padding: 160,
      softObstacles,
      trunkCells,
      tieBreak,
    });

    if (!aStarPath) {
      // Widen the search area once before giving up on A* entirely.
      aStarPath = routeOrthogonal({
        sourceX: sp.x,
        sourceY: sp.y,
        sourcePosition: srcPos,
        targetX: tp.x,
        targetY: tp.y,
        targetPosition: tgtPos,
        obstacles,
        gridStep: 4,
        bendPenalty: 20,
        padding: 500,
        softObstacles,
        trunkCells,
        tieBreak,
      });
    }

    if (aStarPath) {
      const sibPaths = [...sameNetIds]
        .filter(sid => sid < edgeId)
        .map(sid => otherPaths[sid])
        .filter((p): p is Point[] => !!p && p.length >= 2);
      if (sibPaths.length > 0) {
        const pts: Point[] = [];
        for (const m of aStarPath.matchAll(/[ML]\s*(-?\d+\.?\d*)\s*[\s,]\s*(-?\d+\.?\d*)/g)) {
          pts.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
        }
        const snapped = snapRunsToSiblings(pts, sibPaths, obstacles);
        aStarPath = `M ${snapped[0].x} ${snapped[0].y}`;
        for (let i = 1; i < snapped.length; i++) aStarPath += ` L ${snapped[i].x} ${snapped[i].y}`;
      }
      return aStarPath;
    }
  }

  // Fallback to step-path router if A* fails
  const dx = Math.abs(targetX - sourceX);
  const dy = Math.abs(targetY - sourceY);

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

  const obstacles: Obstacle[] = (nodes || [])
    .filter((n: any) => n.type !== 'junction')
    .map((n: any) => {
      const w = n.measured?.width || getNodeDimensions(n.type, n.data).width;
      const h = n.measured?.height || getNodeDimensions(n.type, n.data).height;
      return { x: n.position.x, y: n.position.y, width: w, height: h };
    });

  const computeOffset = (shiftMultiplier: number) => {
    let offset = sourceOffset + shiftMultiplier * shiftStep;
    if (maxOffset > 4) {
      offset = Math.min(maxOffset, Math.max(4, offset));
      if (offset === maxOffset && shiftMultiplier > 0) {
        offset = Math.max(4, maxOffset - shiftMultiplier * shiftStep);
      }
    } else {
      offset = Math.max(4, offset);
    }
    return offset;
  };

  // Try the deterministic offset for this edge first; if it clips an
  // obstacle (fallback has no built-in obstacle awareness), probe the rest
  // of the shift pattern for one that doesn't.
  const candidateOrder = [
    shiftPattern[edgeIndex % shiftPattern.length],
    ...shiftPattern.filter((_, i) => i !== edgeIndex % shiftPattern.length),
  ];

  let chosenPath: string | null = null;
  for (const shiftMultiplier of candidateOrder) {
    const offset = computeOffset(shiftMultiplier);
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
    if (obstacles.length === 0 || !pathIntersectsObstacles(path, obstacles)) {
      chosenPath = path;
      break;
    }
    if (chosenPath === null) chosenPath = path; // keep first as last-resort fallback
  }

  return chosenPath;
}

/**
 * Pull an edge endpoint back onto the pin it belongs to.
 *
 * React Flow attaches an edge a couple of px *outside* the node along the pin
 * normal. For symbols whose handles sit on the box edge (every discrete part)
 * that leaves the wire short of the pin, so symbol leads would have to overhang
 * to meet it — and that overhang then shows as a stub whenever a wire arrives
 * perpendicular instead. Handles that genuinely sit inside their node
 * (instrument cards like the signal generator) attach inside the box and are
 * left alone.
 */
function clampToPin(nodes: any[], x: number, y: number, pos: string, id?: string): Point {
  const n = id ? nodes.find((q: any) => q.id === id) : null;
  if (!n) return { x, y };
  /*
   * Only ever clamp against a box React Flow has actually measured.
   *
   * The fallback table is a rough guide for layout code that has no rendered
   * node to ask, and it has no entry for most of the instrument cards — a
   * signal generator, 88px wide and about twice as tall as the 48x32 default,
   * came back as 48x32. Clamping to that put the ground wire's endpoint a third
   * of the way up the inside of the card, so the wire ran horizontally across
   * the middle of the part and stopped short of the pin it belonged to, which
   * is the break that shows up whenever a node is moved and its measurement is
   * momentarily unavailable. An unclamped endpoint is a couple of px out; a
   * wrongly clamped one is halfway into the symbol.
   */
  const w = n.measured?.width;
  const h = n.measured?.height;
  if (!w || !h) return { x, y };
  /*
   * Snap onto the boundary the pin sits on, from whichever side it lands.
   *
   * Pulling an endpoint that overshoots back in was only half of it: a card
   * whose handle is inset from its own edge — the instrument bodies — left the
   * wire starting inside the box, so it emerged through the card's background
   * and border partway up the part instead of meeting it at the edge. Moving
   * the endpoint onto the boundary plane in both directions makes the wire
   * finish exactly where the part does, and is a no-op for every symbol whose
   * handles already sit on the edge.
   */
  if (pos === 'right') return { x: n.position.x + w, y };
  if (pos === 'left') return { x: n.position.x, y };
  if (pos === 'bottom') return { x, y: n.position.y + h };
  if (pos === 'top') return { x, y: n.position.y };
  return { x, y };
}

function getOrthogonalPathThroughWaypoint(
  sourceX: number,
  sourceY: number,
  sourcePosition: string,
  targetX: number,
  targetY: number,
  targetPosition: string,
  W: { x: number; y: number },
  nodes: any[] = [],
  sourceId?: string,
  targetId?: string,
) {
  const s = clampToPin(nodes, sourceX, sourceY, sourcePosition, sourceId);
  const t = clampToPin(nodes, targetX, targetY, targetPosition, targetId);
  const isSourceVert = sourcePosition === 'top' || sourcePosition === 'bottom';
  const isTargetVert = targetPosition === 'top' || targetPosition === 'bottom';

  const pts: Point[] = [s];

  // S -> W: leave the pin along its own normal, then turn once.
  if (isSourceVert) {
    pts.push({ x: s.x, y: W.y });
  } else {
    pts.push({ x: W.x, y: s.y });
  }
  pts.push({ x: W.x, y: W.y });

  // W -> T: mirror it, entering the target pin along its normal.
  if (isTargetVert) {
    const inSpan = W.x >= Math.min(s.x, t.x) && W.x <= Math.max(s.x, t.x);
    pts.push(inSpan ? { x: t.x, y: W.y } : { x: W.x, y: t.y });
  } else {
    const inSpan = W.y >= Math.min(s.y, t.y) && W.y <= Math.max(s.y, t.y);
    pts.push(inSpan ? { x: W.x, y: t.y } : { x: t.x, y: W.y });
  }
  pts.push(t);

  // Same clean-up the A* router gets: a dragged wire was previously emitted raw,
  // so it kept redundant collinear points and stopped short of its pins.
  const clean = simplifyCollinear(squareOffDiagonals(pts, sourcePosition));
  let path = `M ${clean[0].x} ${clean[0].y}`;
  for (let i = 1; i < clean.length; i++) path += ` L ${clean[i].x} ${clean[i].y}`;
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

  const waypoints: { x: number; y: number }[] = useMemo(() => (data as any)?.waypoints || [], [data]);
  const [isDragging, setIsDragging] = useState(false);

  const context = useContext(EdgePathContext);
  const { registerPath, unregisterPath } = context || {};

  const edgePath = useMemo(() => {
    const direct = getSchematicPath({
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
      otherEdgesPaths: context?.paths || {},
    });

    if (waypoints.length > 0) {
      // A wire whose pins already have a clear straight run between them has
      // nothing to route around, and both ends are pinned — so any waypoint can
      // only bend it into a pointless U. Dragging such a wire does nothing
      // rather than making the schematic worse.
      const isStraightRun = (direct.match(/[ML]/g) || []).length === 2;
      if (!isStraightRun) {
        return getOrthogonalPathThroughWaypoint(
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
          waypoints[0],
          allNodes,
          source,
          target,
        );
      }
    }

    return direct;
  }, [
    waypoints, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
    sourceOffset, sourceIndex, targetIndex, allNodes, source, target, id, allEdges,
    context?.paths,
  ]);


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

  const pointsKey = useMemo(() => JSON.stringify(points), [points]);

  useEffect(() => {
    if (registerPath) {
      registerPath(id, points);
      return () => {
        if (unregisterPath) unregisterPath(id);
      };
    }
  }, [id, pointsKey, registerPath, unregisterPath]);

  const isAuraEnabled = type === 'aura';
  const auraClass = isAuraEnabled
    ? (current > 0.004 ? 'edge-aura' : (current > 0.0001 ? 'edge-aura-faint' : ''))
    : '';

  const isHovered = context?.hoveredEdgeId === id;

  // Same-net wires deliberately route on top of each other (trunk sharing),
  // so "the wire" under the cursor is often a bundle of edges. Any waypoint
  // interaction has to hit every bundled edge at the grab point — moving just
  // one used to peel it out of the bundle, leaving two wires drawn for the
  // same net ("dragging the rail split it in two").
  const collectBundleIds = useCallback((clickPos: { x: number; y: number }) => {
    const ids = new Set<string>([id]);
    const paths = context?.paths || {};
    const myPorts = new Set([
      `${source}-${sourceHandle || 'out'}`,
      `${target}-${targetHandle || 'in'}`,
    ]);
    for (const e of getEdges()) {
      if (e.id === id) continue;
      const a = `${e.source}-${e.sourceHandle || 'out'}`;
      const b = `${e.target}-${e.targetHandle || 'in'}`;
      if (!myPorts.has(a) && !myPorts.has(b)) continue;
      const pts = paths[e.id];
      if (pts && pathNearPoint(pts, clickPos, 8)) ids.add(e.id);
    }
    return ids;
  }, [id, source, target, sourceHandle, targetHandle, context?.paths, getEdges]);

  const handleWireMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsDragging(true);

    const startX = e.clientX;
    const startY = e.clientY;

    const clickPos = screenToFlowPosition({ x: startX, y: startY });
    const bundleIds = collectBundleIds(clickPos);

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
        if (!bundleIds.has(edge.id)) return edge;
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
  }, [waypoints, screenToFlowPosition, getViewport, setEdges, collectBundleIds]);

  const handleWireDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const clickPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const bundleIds = collectBundleIds(clickPos);

    setEdges((eds: any[]) => eds.map(edge => {
      if (!bundleIds.has(edge.id)) return edge;
      return {
        ...edge,
        data: {
          ...edge.data,
          waypoints: []
        }
      };
    }));
  }, [setEdges, screenToFlowPosition, collectBundleIds]);
  
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
    </>
  );
});
