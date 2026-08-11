// ---------------------------------------------------------------------------
// Single-Layer Maze Router
//
// Routes each net on a uniform grid using A* with a bend penalty, treating
// other nets' copper as obstacles. This is what keeps a milled single-sided
// board from shorting: a trace is only ever emitted along a path that provably
// stays `clearance` away from every other net.
//
// Occupancy model
// ---------------
// The grid stores, per cell, which net's *keepout* covers it:
//   FREE (0)        - no copper nearby, anyone may route here
//   <netIndex>      - within keepout of exactly that net
//   CONFLICT (-1)   - within keepout of two or more nets, nobody may route here
//
// A keepout is stamped at radius (copperRadius + clearance + traceWidth/2), so
// a cell is a legal *centreline* position for net N exactly when the cell is
// FREE or owned by N. A cell covered by two nets is illegal for both, which is
// why CONFLICT blocks everyone rather than being overwritten.
// ---------------------------------------------------------------------------

import type { Pt } from './pcbGeometry';

const FREE = 0;
const CONFLICT = -1;

export interface RouterOptions {
  boardWidthMm: number;
  boardHeightMm: number;
  /** Grid resolution. Smaller routes better but costs O(n^2) time. */
  gridMm: number;
  traceWidthMm: number;
  clearanceMm: number;
  /** Keepout from the board edge, so traces are not cut away by the profile. */
  edgeClearanceMm: number;
  /** Extra cost per 45-degree turn, in grid steps. Discourages staircasing. */
  bendPenalty: number;
}

/** A pin that must be connected, in board millimetres. */
export interface RoutePin {
  netId: string;
  /** Stable identifier, `${componentId}-${handleId}`. */
  key: string;
  componentId: string;
  x: number;
  y: number;
  /** Outer radius of the pad copper. */
  padRadiusMm: number;
}

export interface RoutedTrace {
  netId: string;
  points: Pt[];
  widthMm: number;
}

export interface UnroutedConnection {
  netId: string;
  from: string;
  to: string;
  reason: string;
}

export interface RouteResult {
  traces: RoutedTrace[];
  unrouted: UnroutedConnection[];
  /** Fraction of required connections that were successfully routed, 0..1. */
  completion: number;
}

interface Grid {
  cols: number;
  rows: number;
  cells: Int32Array;
  gridMm: number;
}

function makeGrid(opts: RouterOptions): Grid {
  const cols = Math.max(1, Math.ceil(opts.boardWidthMm / opts.gridMm));
  const rows = Math.max(1, Math.ceil(opts.boardHeightMm / opts.gridMm));
  return { cols, rows, cells: new Int32Array(cols * rows), gridMm: opts.gridMm };
}

const cellX = (g: Grid, gx: number) => (gx + 0.5) * g.gridMm;
const cellY = (g: Grid, gy: number) => (gy + 0.5) * g.gridMm;
const toGx = (g: Grid, x: number) => Math.floor(x / g.gridMm);
const toGy = (g: Grid, y: number) => Math.floor(y / g.gridMm);

/**
 * Marks a cell as belonging to `net`. A cell already owned by a different net
 * becomes CONFLICT, which blocks every net including the two that caused it.
 */
function claim(grid: Grid, idx: number, net: number): void {
  const cur = grid.cells[idx];
  if (cur === FREE) grid.cells[idx] = net;
  else if (cur !== net) grid.cells[idx] = CONFLICT;
}

/** Stamps the keepout disc of a pad. */
function stampDisc(grid: Grid, cx: number, cy: number, r: number, net: number): void {
  const gx0 = Math.max(0, toGx(grid, cx - r));
  const gx1 = Math.min(grid.cols - 1, toGx(grid, cx + r));
  const gy0 = Math.max(0, toGy(grid, cy - r));
  const gy1 = Math.min(grid.rows - 1, toGy(grid, cy + r));
  const r2 = r * r;
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const dx = cellX(grid, gx) - cx;
      const dy = cellY(grid, gy) - cy;
      if (dx * dx + dy * dy <= r2) claim(grid, gy * grid.cols + gx, net);
    }
  }
}

/** Squared distance from a point to a line segment. */
function distToSegSq(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2;
}

/** Stamps the keepout capsule of a trace segment. */
function stampSegment(
  grid: Grid,
  x1: number, y1: number, x2: number, y2: number,
  r: number, net: number
): void {
  const gx0 = Math.max(0, toGx(grid, Math.min(x1, x2) - r));
  const gx1 = Math.min(grid.cols - 1, toGx(grid, Math.max(x1, x2) + r));
  const gy0 = Math.max(0, toGy(grid, Math.min(y1, y2) - r));
  const gy1 = Math.min(grid.rows - 1, toGy(grid, Math.max(y1, y2) + r));
  const r2 = r * r;
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      if (distToSegSq(cellX(grid, gx), cellY(grid, gy), x1, y1, x2, y2) <= r2) {
        claim(grid, gy * grid.cols + gx, net);
      }
    }
  }
}

/** Blocks a border of cells so traces never run into the profile cut. */
function stampBoardEdge(grid: Grid, opts: RouterOptions): void {
  const m = opts.edgeClearanceMm + opts.traceWidthMm / 2;
  for (let gy = 0; gy < grid.rows; gy++) {
    for (let gx = 0; gx < grid.cols; gx++) {
      const x = cellX(grid, gx);
      const y = cellY(grid, gy);
      if (
        x < m || y < m ||
        x > opts.boardWidthMm - m ||
        y > opts.boardHeightMm - m
      ) {
        grid.cells[gy * grid.cols + gx] = CONFLICT;
      }
    }
  }
}

// 8-way movement. Index pairs with DIR_COST below.
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const DIR_COST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

/**
 * Binary min-heap over (priority, value) pairs. A plain sorted array is far too
 * slow once the grid exceeds a few thousand cells.
 */
class MinHeap {
  private prio: number[] = [];
  private val: number[] = [];

  get size(): number { return this.val.length; }

  push(p: number, v: number): void {
    this.prio.push(p);
    this.val.push(v);
    let i = this.val.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= this.prio[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.val[0];
    const lastP = this.prio.pop()!;
    const lastV = this.val.pop()!;
    if (this.val.length > 0) {
      this.prio[0] = lastP;
      this.val[0] = lastV;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.val.length && this.prio[l] < this.prio[smallest]) smallest = l;
        if (r < this.val.length && this.prio[r] < this.prio[smallest]) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
    [this.val[a], this.val[b]] = [this.val[b], this.val[a]];
  }
}

/**
 * Multi-source A*: from any cell in `starts` to any cell in `goals`, for a
 * single net.
 *
 * Seeding every start cell into one search matters for multi-pin nets — the
 * new branch may legitimately begin anywhere on the copper already laid down
 * for this net. Running one search per start instead would repeat the same
 * exhaustive exploration once per reached cell whenever a net is unroutable.
 *
 * State is (cell, incoming direction) so that turns can be charged a penalty;
 * without it the router produces staircases that are legal but waste copper
 * and are ugly to mill.
 */
function findPath(
  grid: Grid,
  starts: Set<number>,
  goals: Set<number>,
  net: number,
  bendPenalty: number
): number[] | null {
  const n = grid.cols * grid.rows;
  const NDIR = 9; // 8 directions + 'no previous direction' at index 8
  const size = n * NDIR;
  const gScore = new Float64Array(size).fill(Infinity);
  const cameFrom = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);

  // Heuristic: octile distance to the nearest goal cell.
  const goalList = [...goals];
  const h = (idx: number): number => {
    const x = idx % grid.cols;
    const y = (idx / grid.cols) | 0;
    let best = Infinity;
    for (const g of goalList) {
      const gxx = g % grid.cols;
      const gyy = (g / grid.cols) | 0;
      const dx = Math.abs(x - gxx);
      const dy = Math.abs(y - gyy);
      const d = dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
      if (d < best) best = d;
    }
    return best;
  };

  const open = new MinHeap();
  for (const s of starts) {
    if (s < 0 || s >= n) continue;
    const cell = grid.cells[s];
    if (cell !== FREE && cell !== net) continue;
    const state = s * NDIR + 8;
    gScore[state] = 0;
    open.push(h(s), state);
  }

  while (open.size > 0) {
    const state = open.pop();
    if (closed[state]) continue;
    closed[state] = 1;

    const idx = (state / NDIR) | 0;
    const dir = state % NDIR;

    if (goals.has(idx)) {
      const path: number[] = [];
      let s = state;
      while (s !== -1) {
        path.push((s / NDIR) | 0);
        s = cameFrom[s];
      }
      return path.reverse();
    }

    const x = idx % grid.cols;
    const y = (idx / grid.cols) | 0;

    for (let d = 0; d < 8; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue;

      const nIdx = ny * grid.cols + nx;
      const cell = grid.cells[nIdx];
      if (cell !== FREE && cell !== net) continue;

      // Disallow diagonal moves that squeeze between two blocked orthogonals.
      if (d >= 4) {
        const sideA = grid.cells[y * grid.cols + nx];
        const sideB = grid.cells[ny * grid.cols + x];
        if (
          (sideA !== FREE && sideA !== net) ||
          (sideB !== FREE && sideB !== net)
        ) continue;
      }

      const turn = dir === 8 || dir === d ? 0 : bendPenalty;
      const tentative = gScore[state] + DIR_COST[d] + turn;
      const nState = nIdx * NDIR + d;
      if (tentative < gScore[nState]) {
        gScore[nState] = tentative;
        cameFrom[nState] = state;
        open.push(tentative + h(nIdx), nState);
      }
    }
  }

  return null;
}

/** Collapses a cell path into a polyline, dropping collinear interior points. */
function simplifyPath(grid: Grid, cells: number[]): Pt[] {
  const pts: Pt[] = cells.map(c => ({
    x: cellX(grid, c % grid.cols),
    y: cellY(grid, (c / grid.cols) | 0),
  }));
  if (pts.length <= 2) return pts;

  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) > 1e-9) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Minimum spanning tree over pins, returned as index pairs (Prim's). */
function buildMst(pins: RoutePin[]): [number, number][] {
  const n = pins.length;
  if (n < 2) return [];
  const inTree = new Array(n).fill(false);
  const best = new Array(n).fill(Infinity);
  const parent = new Array(n).fill(-1);
  best[0] = 0;
  const edges: [number, number][] = [];

  for (let iter = 0; iter < n; iter++) {
    let u = -1;
    for (let i = 0; i < n; i++) {
      if (!inTree[i] && (u === -1 || best[i] < best[u])) u = i;
    }
    inTree[u] = true;
    if (parent[u] !== -1) edges.push([parent[u], u]);
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const d = Math.hypot(pins[u].x - pins[v].x, pins[u].y - pins[v].y);
      if (d < best[v]) {
        best[v] = d;
        parent[v] = u;
      }
    }
  }
  return edges;
}

/**
 * Routes every net. Nets are ordered shortest-first so that small local
 * connections claim their space before long hauls carve the board up.
 */
export function routeBoard(pins: RoutePin[], opts: RouterOptions): RouteResult {
  const grid = makeGrid(opts);
  stampBoardEdge(grid, opts);

  const netIds = [...new Set(pins.map(p => p.netId))];
  const netIndex = new Map<string, number>();
  netIds.forEach((id, i) => netIndex.set(id, i + 1));

  const halfTrace = opts.traceWidthMm / 2;
  const keepout = opts.clearanceMm + halfTrace;

  // Stamp every pad's keepout before routing anything.
  for (const pin of pins) {
    stampDisc(grid, pin.x, pin.y, pin.padRadiusMm + keepout, netIndex.get(pin.netId)!);
  }

  // A pad's own centre must stay reachable even if a neighbouring pad's
  // keepout spilled over it and turned it into CONFLICT.
  const padCell = new Map<string, number>();
  for (const pin of pins) {
    const gx = Math.max(0, Math.min(grid.cols - 1, toGx(grid, pin.x)));
    const gy = Math.max(0, Math.min(grid.rows - 1, toGy(grid, pin.y)));
    const idx = gy * grid.cols + gx;
    grid.cells[idx] = netIndex.get(pin.netId)!;
    padCell.set(pin.key, idx);
  }

  const byNet = new Map<string, RoutePin[]>();
  for (const pin of pins) {
    if (!byNet.has(pin.netId)) byNet.set(pin.netId, []);
    byNet.get(pin.netId)!.push(pin);
  }

  // Shortest total MST length first.
  const order = [...byNet.entries()].sort((a, b) => {
    const len = (ps: RoutePin[]) =>
      buildMst(ps).reduce(
        (s, [i, j]) => s + Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y),
        0
      );
    return len(a[1]) - len(b[1]);
  });

  const traces: RoutedTrace[] = [];
  const unrouted: UnroutedConnection[] = [];
  let required = 0;
  let achieved = 0;

  for (const [netId, netPins] of order) {
    const net = netIndex.get(netId)!;
    const mst = buildMst(netPins);
    required += mst.length;

    // Cells already reachable for this net; a new branch may terminate on any
    // of them, which is how a 3+ pin net becomes one connected copper region.
    const reached = new Set<number>();

    for (const [i, j] of mst) {
      const a = netPins[i];
      const b = netPins[j];
      const startIdx = padCell.get(a.key)!;
      const goalIdx = padCell.get(b.key)!;

      // Any copper already laid for this net is a valid place to branch from.
      const startSet = new Set<number>([startIdx, ...reached]);
      const path = findPath(grid, startSet, new Set([goalIdx]), net, opts.bendPenalty);

      if (!path || path.length < 2) {
        unrouted.push({
          netId,
          from: a.key,
          to: b.key,
          reason: 'no clear path at this clearance and board size',
        });
        continue;
      }

      const pts = simplifyPath(grid, path);
      traces.push({ netId, points: pts, widthMm: opts.traceWidthMm });
      achieved++;

      for (let k = 0; k + 1 < pts.length; k++) {
        stampSegment(
          grid,
          pts[k].x, pts[k].y, pts[k + 1].x, pts[k + 1].y,
          halfTrace + keepout,
          net
        );
      }
      path.forEach(c => reached.add(c));
    }
  }

  return {
    traces,
    unrouted,
    completion: required === 0 ? 1 : achieved / required,
  };
}
