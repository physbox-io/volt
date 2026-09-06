// ---------------------------------------------------------------------------
// Maze Router (Single-Layer & Double-Layer with Auto-Vias)
//
// Routes each net on a uniform grid using A* with a bend penalty, treating
// other nets' copper as obstacles. This is what keeps a milled board from
// shorting: a trace is only ever emitted along a path that provably stays
// `clearance` away from every other net.
//
// In 2-layer mode (opts.layers === 2), the grid models Top (F.Cu) and
// Bottom (B.Cu) layers. Through-hole component pins exist on both layers,
// SMD pads on Top, and the router can transition between layers by dropping
// a plated via wherever clearances on both layers allow.
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
  /**
   * How hard to try before giving up, as a wall-clock budget in milliseconds
   * for the whole board. Ordering strategies and rip-up passes stop once it is
   * spent, and the best result so far is returned. Defaults to
   * DEFAULT_ROUTING_BUDGET_MS.
   */
  budgetMs?: number;
  /** Called after each ordering strategy so a host can show progress. */
  onProgress?: (info: RouteProgress) => void;
  /**
   * Copper-free regions no net may cross — drilled mounting holes, and any
   * other pad that carries no net. Without these a trace happily routes
   * straight through a hole, or shorts against an unused header pin.
   */
  obstacles?: RouteObstacle[];
  /**
   * Pairs of pin keys already joined by something that is not copper - a wire
   * jumper soldered across the board. The MST is free to use such a pair to
   * connect its two halves, and no trace is planned or required for it.
   */
  linkedPairs?: [string, string][];
  /** Number of copper routing layers: 1 for single-sided (default), 2 for double-sided. */
  layers?: 1 | 2;
  /** Via pad outer diameter in mm for 2-layer routing (default: 1.4mm). */
  viaPadMm?: number;
  /** Via drill hole diameter in mm for 2-layer routing (default: 0.8mm). */
  viaDrillMm?: number;
  /** A* step penalty for placing a layer-change via (default: 18). */
  viaCost?: number;
}

/**
 * A keepout that belongs to no net: circular when `radiusMm` is given,
 * rectangular when `widthMm`/`heightMm` are.
 */
export interface RouteObstacle {
  x: number;
  y: number;
  radiusMm?: number;
  widthMm?: number;
  heightMm?: number;
  layer?: 'top' | 'bottom' | 'both';
}

export interface RouteProgress {
  /** Strategy passes finished so far. */
  pass: number;
  /** Total passes this budget allows, as an upper bound. */
  totalPasses: number;
  /** Best completion fraction seen so far, 0..1. */
  completion: number;
  /** Milliseconds elapsed. */
  elapsedMs: number;
}

/** Via pad outer diameter used when the caller does not specify one. */
export const DEFAULT_VIA_PAD_MM = 1.4;

/** Via drill diameter used when the caller does not specify one. */
export const DEFAULT_VIA_DRILL_MM = 0.8;

/**
 * How far from a via's centre another net's trace *centreline* must stay.
 *
 * Same rule as a pad, and for the same reason: the clearance is a copper-to-
 * copper figure, so the trace's own half width has to be in the radius too.
 * Leaving it out mills a gap narrower than the clearance asked for - at the
 * defaults, narrow enough to be no gap at all.
 */
export function viaKeepoutRadiusMm(
  viaPadMm: number,
  clearanceMm: number,
  traceWidthMm: number
): number {
  return viaPadMm / 2 + clearanceMm + traceWidthMm / 2;
}

/** Wall-clock budget used when the caller does not specify one. */
export const DEFAULT_ROUTING_BUDGET_MS = 8000;

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
  /** Which layer(s) the pad exists on: 'both' for THT (default), 'top' for SMD. */
  layer?: 'top' | 'bottom' | 'both';
}

export interface RoutedTrace {
  netId: string;
  points: Pt[];
  widthMm: number;
  layer?: 'top' | 'bottom';
}

export interface RouteVia {
  netId: string;
  x: number;
  y: number;
  drillMm: number;
  padMm: number;
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
  /** Auto-placed layer-transition vias (2-layer mode). */
  vias?: RouteVia[];
}

interface Grid {
  cols: number;
  rows: number;
  layerCount: number;
  cells: Int32Array;
  gridMm: number;
}

function makeGrid(opts: RouterOptions): Grid {
  const cols = Math.max(1, Math.ceil(opts.boardWidthMm / opts.gridMm));
  const rows = Math.max(1, Math.ceil(opts.boardHeightMm / opts.gridMm));
  const layerCount = opts.layers === 2 ? 2 : 1;
  return { cols, rows, layerCount, cells: new Int32Array(cols * rows * layerCount), gridMm: opts.gridMm };
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

/** Stamps the keepout disc of a pad across requested layers (default: all layers). */
function stampDisc(grid: Grid, cx: number, cy: number, r: number, net: number, layer?: number): void {
  const gx0 = Math.max(0, toGx(grid, cx - r));
  const gx1 = Math.min(grid.cols - 1, toGx(grid, cx + r));
  const gy0 = Math.max(0, toGy(grid, cy - r));
  const gy1 = Math.min(grid.rows - 1, toGy(grid, cy + r));
  const r2 = r * r;
  const stride = grid.cols * grid.rows;
  const layers = layer !== undefined ? [layer] : grid.layerCount === 2 ? [0, 1] : [0];

  for (const l of layers) {
    const lOff = l * stride;
    for (let gy = gy0; gy <= gy1; gy++) {
      const rowOff = lOff + gy * grid.cols;
      for (let gx = gx0; gx <= gx1; gx++) {
        const dx = cellX(grid, gx) - cx;
        const dy = cellY(grid, gy) - cy;
        if (dx * dx + dy * dy <= r2) claim(grid, rowOff + gx, net);
      }
    }
  }
}

/** Stamps an axis-aligned rectangular keepout, centred on (cx, cy). */
function stampRect(grid: Grid, cx: number, cy: number, w: number, h: number, net: number, layer?: number): void {
  const gx0 = Math.max(0, toGx(grid, cx - w / 2));
  const gx1 = Math.min(grid.cols - 1, toGx(grid, cx + w / 2));
  const gy0 = Math.max(0, toGy(grid, cy - h / 2));
  const gy1 = Math.min(grid.rows - 1, toGy(grid, cy + h / 2));
  const stride = grid.cols * grid.rows;
  const layers = layer !== undefined ? [layer] : grid.layerCount === 2 ? [0, 1] : [0];

  for (const l of layers) {
    const lOff = l * stride;
    for (let gy = gy0; gy <= gy1; gy++) {
      const rowOff = lOff + gy * grid.cols;
      for (let gx = gx0; gx <= gx1; gx++) {
        claim(grid, rowOff + gx, net);
      }
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

/** Stamps the keepout capsule of a trace segment on a specific layer. */
function stampSegment(
  grid: Grid,
  x1: number, y1: number, x2: number, y2: number,
  r: number, net: number, layer: number = 0
): void {
  const gx0 = Math.max(0, toGx(grid, Math.min(x1, x2) - r));
  const gx1 = Math.min(grid.cols - 1, toGx(grid, Math.max(x1, x2) + r));
  const gy0 = Math.max(0, toGy(grid, Math.min(y1, y2) - r));
  const gy1 = Math.min(grid.rows - 1, toGy(grid, Math.max(y1, y2) + r));
  const r2 = r * r;
  const lOff = layer * grid.cols * grid.rows;

  for (let gy = gy0; gy <= gy1; gy++) {
    const rowOff = lOff + gy * grid.cols;
    for (let gx = gx0; gx <= gx1; gx++) {
      if (distToSegSq(cellX(grid, gx), cellY(grid, gy), x1, y1, x2, y2) <= r2) {
        claim(grid, rowOff + gx, net);
      }
    }
  }
}

/** Blocks a border of cells on all layers so traces never run into the profile cut. */
function stampBoardEdge(grid: Grid, opts: RouterOptions): void {
  const m = opts.edgeClearanceMm + opts.traceWidthMm / 2;
  const stride = grid.cols * grid.rows;
  for (let l = 0; l < grid.layerCount; l++) {
    const lOff = l * stride;
    for (let gy = 0; gy < grid.rows; gy++) {
      for (let gx = 0; gx < grid.cols; gx++) {
        const x = cellX(grid, gx);
        const y = cellY(grid, gy);
        if (
          x < m || y < m ||
          x > opts.boardWidthMm - m ||
          y > opts.boardHeightMm - m
        ) {
          grid.cells[lOff + gy * grid.cols + gx] = CONFLICT;
        }
      }
    }
  }
}

/**
 * Where `net` may drop a layer-transition via, as one byte per XY cell.
 *
 * A via needs its pad, plus clearance, to be free of every other net on *both*
 * layers. Testing that disc at each node expansion turned the 2-layer A* into
 * an O(cells x disc) crawl, so the whole board is answered once per connection
 * instead: mark the cells no net may share, then grow that mark by the via
 * radius. The growth is a square rather than a disc, which can only reject a
 * via the disc test would have allowed - never the other way round - and is
 * separable, so it costs two linear passes instead of a per-cell scan.
 */
function buildViaMask(grid: Grid, net: number, rViaMm: number): Uint8Array {
  const { cols, rows } = grid;
  const stride = cols * rows;
  const allowed = new Uint8Array(stride);
  if (grid.layerCount < 2) return allowed;

  const blocked = new Uint8Array(stride);
  for (let c = 0; c < stride; c++) {
    const c0 = grid.cells[c];
    const c1 = grid.cells[stride + c];
    if ((c0 !== FREE && c0 !== net) || (c1 !== FREE && c1 !== net)) blocked[c] = 1;
  }

  const r = Math.ceil(rViaMm / grid.gridMm);

  // Horizontal pass, then vertical, each over a running prefix sum.
  const rowGrown = new Uint8Array(stride);
  const prefix = new Int32Array(Math.max(cols, rows) + 1);
  for (let y = 0; y < rows; y++) {
    const off = y * cols;
    for (let x = 0; x < cols; x++) prefix[x + 1] = prefix[x] + blocked[off + x];
    for (let x = 0; x < cols; x++) {
      const lo = Math.max(0, x - r);
      const hi = Math.min(cols - 1, x + r);
      rowGrown[off + x] = prefix[hi + 1] - prefix[lo] > 0 ? 1 : 0;
    }
  }
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) prefix[y + 1] = prefix[y] + rowGrown[y * cols + x];
    for (let y = 0; y < rows; y++) {
      const lo = Math.max(0, y - r);
      const hi = Math.min(rows - 1, y + r);
      // The pad also has to fit inside the grid, so the border is out too.
      const onBorder = x < r || y < r || x >= cols - r || y >= rows - r;
      allowed[y * cols + x] = !onBorder && prefix[hi + 1] - prefix[lo] === 0 ? 1 : 0;
    }
  }
  return allowed;
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
 * Is any goal connected to any starts through cells this net may occupy?
 */
function isReachable(
  grid: Grid,
  starts: Set<number>,
  goals: Set<number>,
  net: number,
  scratch: Uint8Array,
  queue: Int32Array,
  viaMask?: Uint8Array
): boolean {
  const stride = grid.cols * grid.rows;
  const n = stride * grid.layerCount;
  scratch.fill(0);
  let tail = 0;
  for (const s of starts) {
    if (s < 0 || s >= n || scratch[s]) continue;
    const c = grid.cells[s];
    if (c !== FREE && c !== net) continue;
    scratch[s] = 1;
    queue[tail++] = s;
  }

  for (let head = 0; head < tail; head++) {
    const idx = queue[head];
    if (goals.has(idx)) return true;

    const layer = (idx / stride) | 0;
    const c2d = idx % stride;
    const x = c2d % grid.cols;
    const y = (c2d / grid.cols) | 0;
    const lOff = layer * stride;

    // 8 planar directions
    for (let d = 0; d < 8; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue;

      const nIdx = lOff + ny * grid.cols + nx;
      if (scratch[nIdx]) continue;
      const cell = grid.cells[nIdx];
      if (cell !== FREE && cell !== net) continue;

      // Same diagonal-squeeze rule as findPath
      if (d >= 4) {
        const sideA = grid.cells[lOff + y * grid.cols + nx];
        const sideB = grid.cells[lOff + ny * grid.cols + x];
        if (
          (sideA !== FREE && sideA !== net) ||
          (sideB !== FREE && sideB !== net)
        ) continue;
      }

      scratch[nIdx] = 1;
      queue[tail++] = nIdx;
    }

    // Layer transition (via)
    if (grid.layerCount === 2 && viaMask) {
      const otherLayer = 1 - layer;
      const otherIdx = otherLayer * stride + c2d;
      if (!scratch[otherIdx] && viaMask[c2d]) {
        scratch[otherIdx] = 1;
        queue[tail++] = otherIdx;
      }
    }
  }
  return false;
}

/**
 * Multi-source A*: from any cell in `starts` to any cell in `goals`, for a single net.
 * In 2-layer mode, searches across both Top and Bottom layers with layer-change via transitions.
 */
function findPath(
  grid: Grid,
  starts: Set<number>,
  goals: Set<number>,
  net: number,
  bendPenalty: number,
  hWeight: number = 1.0,
  viaMask?: Uint8Array,
  viaCost: number = 18
): number[] | null {
  const stride = grid.cols * grid.rows;
  const n = stride * grid.layerCount;
  const NDIR = 10; // 0..7 planar, 8 via transition, 9 start/none
  const size = n * NDIR;
  const gScore = new Float64Array(size).fill(Infinity);
  const cameFrom = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);

  // Heuristic: octile distance in XY to the nearest goal cell.
  const goalList = [...goals];
  const h = (idx: number): number => {
    if (hWeight <= 0) return 0;
    const c2d = idx % stride;
    const x = c2d % grid.cols;
    const y = (c2d / grid.cols) | 0;
    let best = Infinity;
    for (const g of goalList) {
      const g2d = g % stride;
      const gxx = g2d % grid.cols;
      const gyy = (g2d / grid.cols) | 0;
      const dx = Math.abs(x - gxx);
      const dy = Math.abs(y - gyy);
      const d = dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
      if (d < best) best = d;
    }
    return best * hWeight;
  };

  const open = new MinHeap();
  for (const s of starts) {
    if (s < 0 || s >= n) continue;
    const cell = grid.cells[s];
    if (cell !== FREE && cell !== net) continue;
    const state = s * NDIR + 9;
    gScore[state] = 0;
    open.push(h(s), state);
  }

  let expanded = 0;
  const MAX_EXPANDED = size + 1;

  while (open.size > 0) {
    if (++expanded > MAX_EXPANDED) {
      return null;
    }
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

    const layer = (idx / stride) | 0;
    const c2d = idx % stride;
    const x = c2d % grid.cols;
    const y = (c2d / grid.cols) | 0;
    const lOff = layer * stride;

    // 1. Planar moves on current layer
    for (let d = 0; d < 8; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue;

      const nIdx = lOff + ny * grid.cols + nx;
      const cell = grid.cells[nIdx];
      if (cell !== FREE && cell !== net) continue;

      // Disallow diagonal moves that squeeze between two blocked orthogonals.
      if (d >= 4) {
        const sideA = grid.cells[lOff + y * grid.cols + nx];
        const sideB = grid.cells[lOff + ny * grid.cols + x];
        if (
          (sideA !== FREE && sideA !== net) ||
          (sideB !== FREE && sideB !== net)
        ) continue;
      }

      const turn = dir === 9 || dir === 8 || dir === d ? 0 : bendPenalty;
      const tentative = gScore[state] + DIR_COST[d] + turn;
      const nState = nIdx * NDIR + d;
      if (tentative < gScore[nState]) {
        gScore[nState] = tentative;
        cameFrom[nState] = state;
        open.push(tentative + h(nIdx), nState);
      }
    }

    // 2. Layer transition via move (2-layer mode)
    if (grid.layerCount === 2 && viaMask) {
      const otherLayer = 1 - layer;
      const otherIdx = otherLayer * stride + c2d;
      if (viaMask[c2d]) {
        const tentative = gScore[state] + viaCost;
        const nState = otherIdx * NDIR + 8; // dir 8 = via transition
        if (tentative < gScore[nState]) {
          gScore[nState] = tentative;
          cameFrom[nState] = state;
          open.push(tentative + h(otherIdx), nState);
        }
      }
    }
  }

  return null;
}

/** Collapses a cell path into a polyline, dropping collinear interior points. */
function simplifyPath(grid: Grid, cells: number[]): Pt[] {
  const stride = grid.cols * grid.rows;
  const pts: Pt[] = cells.map(c => {
    const c2d = c % stride;
    return {
      x: cellX(grid, c2d % grid.cols),
      y: cellY(grid, (c2d / grid.cols) | 0),
    };
  });
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

/** Canonical key for an unordered pin pair. */
export function linkPairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/** Minimum spanning tree over pins, returned as index pairs (Prim's). */
function buildMst(pins: RoutePin[], links?: Set<string>): [number, number][] {
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
      const d =
        links && links.has(linkPairKey(pins[u].key, pins[v].key))
          ? 0
          : Math.hypot(pins[u].x - pins[v].x, pins[u].y - pins[v].y);
      if (d < best[v]) {
        best[v] = d;
        parent[v] = u;
      }
    }
  }
  return edges;
}

/**
 * Routes every net for a given net ordering.
 */
function singlePassRoute(
  pins: RoutePin[],
  opts: RouterOptions,
  order: [string, RoutePin[]][]
): RouteResult {
  const grid = makeGrid(opts);
  stampBoardEdge(grid, opts);

  const netIds = [...new Set(pins.map(p => p.netId))];
  const netIndex = new Map<string, number>();
  netIds.forEach((id, i) => netIndex.set(id, i + 1));

  const halfTrace = opts.traceWidthMm / 2;
  const keepout = opts.clearanceMm + halfTrace;
  const stride = grid.cols * grid.rows;

  const viaPad = opts.viaPadMm ?? DEFAULT_VIA_PAD_MM;
  const viaDrill = opts.viaDrillMm ?? DEFAULT_VIA_DRILL_MM;
  const rViaKeepout =
    opts.layers === 2
      ? viaKeepoutRadiusMm(viaPad, opts.clearanceMm, opts.traceWidthMm)
      : undefined;
  const viaCost = opts.viaCost ?? 18;

  // Netless keepouts first
  for (const ob of opts.obstacles ?? []) {
    const targetLayer = ob.layer === 'top' ? 0 : ob.layer === 'bottom' ? 1 : undefined;
    if (ob.widthMm !== undefined && ob.heightMm !== undefined) {
      stampRect(grid, ob.x, ob.y, ob.widthMm + keepout * 2, ob.heightMm + keepout * 2, CONFLICT, targetLayer);
    } else {
      stampDisc(grid, ob.x, ob.y, (ob.radiusMm ?? 0) + keepout, CONFLICT, targetLayer);
    }
  }

  // Stamp every pad's keepout before routing anything.
  for (const pin of pins) {
    const targetLayer = pin.layer === 'top' ? 0 : pin.layer === 'bottom' ? 1 : undefined;
    stampDisc(grid, pin.x, pin.y, pin.padRadiusMm + keepout, netIndex.get(pin.netId)!, targetLayer);
  }

  // Map each pin to its legal start/goal cells on the grid
  const padCells = new Map<string, number[]>();
  for (const pin of pins) {
    const net = netIndex.get(pin.netId)!;
    const gx0 = Math.max(0, toGx(grid, pin.x - pin.padRadiusMm));
    const gx1 = Math.min(grid.cols - 1, toGx(grid, pin.x + pin.padRadiusMm));
    const gy0 = Math.max(0, toGy(grid, pin.y - pin.padRadiusMm));
    const gy1 = Math.min(grid.rows - 1, toGy(grid, pin.y + pin.padRadiusMm));
    const r2 = pin.padRadiusMm * pin.padRadiusMm;

    const targetLayers = pin.layer === 'top' ? [0] : pin.layer === 'bottom' ? [1] : grid.layerCount === 2 ? [0, 1] : [0];

    for (const l of targetLayers) {
      const lOff = l * stride;
      for (let gy = gy0; gy <= gy1; gy++) {
        const rowOff = lOff + gy * grid.cols;
        for (let gx = gx0; gx <= gx1; gx++) {
          const dx = cellX(grid, gx) - pin.x;
          const dy = cellY(grid, gy) - pin.y;
          if (dx * dx + dy * dy <= r2) {
            grid.cells[rowOff + gx] = net;
          }
        }
      }
    }

    const gx = Math.max(0, Math.min(grid.cols - 1, toGx(grid, pin.x)));
    const gy = Math.max(0, Math.min(grid.rows - 1, toGy(grid, pin.y)));
    const c2d = gy * grid.cols + gx;

    const indices: number[] = [];
    for (const l of targetLayers) {
      const idx = l * stride + c2d;
      grid.cells[idx] = net;
      indices.push(idx);
    }
    padCells.set(pin.key, indices);
  }

  // A through-hole pin already joins both faces, so a path that changes layer
  // on top of one needs no via — drilling one there would only put a second
  // hole through a pad that is about to be soldered.
  const thtPadsByNet = new Map<number, { x: number; y: number; r: number }[]>();
  for (const pin of pins) {
    if (pin.layer === 'top' || pin.layer === 'bottom') continue;
    const net = netIndex.get(pin.netId)!;
    if (!thtPadsByNet.has(net)) thtPadsByNet.set(net, []);
    thtPadsByNet.get(net)!.push({ x: pin.x, y: pin.y, r: pin.padRadiusMm });
  }
  const transitionIsPin = (net: number, x: number, y: number): boolean =>
    (thtPadsByNet.get(net) ?? []).some(
      p => (x - p.x) ** 2 + (y - p.y) ** 2 <= p.r * p.r
    );

  const traces: RoutedTrace[] = [];
  const vias: RouteVia[] = [];
  const unrouted: UnroutedConnection[] = [];
  let required = 0;
  let achieved = 0;

  const totalCells = stride * grid.layerCount;
  const reachScratch = new Uint8Array(totalCells);
  const reachQueue = new Int32Array(totalCells);

  const links = new Set((opts.linkedPairs ?? []).map(([a, b]) => linkPairKey(a, b)));

  for (const [netId, netPins] of order) {
    const net = netIndex.get(netId)!;
    const mst = buildMst(netPins, links);
    const reached = new Set<number>();

    for (const [i, j] of mst) {
      const a = netPins[i];
      const b = netPins[j];
      const startIndices = padCells.get(a.key) ?? [];
      const goalIndices = padCells.get(b.key) ?? [];

      if (links.has(linkPairKey(a.key, b.key))) {
        startIndices.forEach(idx => reached.add(idx));
        goalIndices.forEach(idx => reached.add(idx));
        continue;
      }
      required++;

      const startSet = new Set<number>([...startIndices, ...reached]);
      const goalSet = new Set<number>(goalIndices);

      // Rebuilt per connection: the grid gains this net's copper as it goes.
      const viaMask =
        rViaKeepout !== undefined ? buildViaMask(grid, net, rViaKeepout) : undefined;

      const path = isReachable(grid, startSet, goalSet, net, reachScratch, reachQueue, viaMask)
        ? findPath(grid, startSet, goalSet, net, opts.bendPenalty, 1.0, viaMask, viaCost)
        : null;

      if (!path || path.length < 2) {
        unrouted.push({
          netId,
          from: a.key,
          to: b.key,
          reason: 'no clear path at this clearance and board size',
        });
        continue;
      }

      achieved++;

      // Slice path into continuous single-layer segments and place vias at transitions
      let segStart = 0;
      let curLayer = (path[0] / stride) | 0;

      for (let k = 1; k < path.length; k++) {
        const nextLayer = (path[k] / stride) | 0;
        if (nextLayer !== curLayer) {
          // Segment on curLayer finishes at k - 1
          const segCells = path.slice(segStart, k);
          const pts = simplifyPath(grid, segCells);
          const layerName = curLayer === 0 ? 'top' : 'bottom';
          traces.push({ netId, points: pts, widthMm: opts.traceWidthMm, layer: layerName });

          for (let p = 0; p + 1 < pts.length; p++) {
            stampSegment(grid, pts[p].x, pts[p].y, pts[p + 1].x, pts[p + 1].y, halfTrace + keepout, net, curLayer);
          }

          // Via placed at transition cell (which is at the same XY)
          const transC2d = path[k] % stride;
          const vx = cellX(grid, transC2d % grid.cols);
          const vy = cellY(grid, (transC2d / grid.cols) | 0);
          if (!transitionIsPin(net, vx, vy)) {
            vias.push({ netId, x: vx, y: vy, drillMm: viaDrill, padMm: viaPad });
            if (rViaKeepout !== undefined) {
              stampDisc(grid, vx, vy, rViaKeepout, net);
            }
          }

          segStart = k;
          curLayer = nextLayer;
        }
      }

      // Final segment
      const finalSegCells = path.slice(segStart);
      const finalPts = simplifyPath(grid, finalSegCells);
      const finalLayerName = curLayer === 0 ? 'top' : 'bottom';
      traces.push({ netId, points: finalPts, widthMm: opts.traceWidthMm, layer: finalLayerName });

      for (let p = 0; p + 1 < finalPts.length; p++) {
        stampSegment(grid, finalPts[p].x, finalPts[p].y, finalPts[p + 1].x, finalPts[p + 1].y, halfTrace + keepout, net, curLayer);
      }

      path.forEach(c => reached.add(c));
    }
  }

  return {
    traces,
    vias: vias.length > 0 ? vias : undefined,
    unrouted,
    completion: required === 0 ? 1 : achieved / required,
  };
}

/**
 * Routes every net using multi-order strategy exploration & rip-up retry.
 */
export function routeBoard(pins: RoutePin[], opts: RouterOptions): RouteResult {
  const byNet = new Map<string, RoutePin[]>();
  for (const pin of pins) {
    if (!byNet.has(pin.netId)) byNet.set(pin.netId, []);
    byNet.get(pin.netId)!.push(pin);
  }

  const netEntries = [...byNet.entries()];
  if (netEntries.length === 0) {
    return { traces: [], unrouted: [], completion: 1 };
  }

  const calcMstLen = (ps: RoutePin[]) =>
    buildMst(ps).reduce((s, [i, j]) => s + Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y), 0);

  const calcAvgY = (ps: RoutePin[]) =>
    ps.reduce((s, p) => s + p.y, 0) / Math.max(1, ps.length);

  const calcAvgX = (ps: RoutePin[]) =>
    ps.reduce((s, p) => s + p.x, 0) / Math.max(1, ps.length);

  // Strategy 1: Shortest MST first
  const orderShortest = [...netEntries].sort((a, b) => calcMstLen(a[1]) - calcMstLen(b[1]));

  // Strategy 2: Longest MST first (long outer routes get perimeter before interior fills)
  const orderLongest = [...netEntries].sort((a, b) => calcMstLen(b[1]) - calcMstLen(a[1]));

  // Strategy 3: Top to Bottom Y
  const orderTopDown = [...netEntries].sort((a, b) => calcAvgY(b[1]) - calcAvgY(a[1]));

  // Strategy 4: Bottom to Top Y
  const orderBottomUp = [...netEntries].sort((a, b) => calcAvgY(a[1]) - calcAvgY(b[1]));

  // Strategy 5: Left to Right X
  const orderLeftRight = [...netEntries].sort((a, b) => calcAvgX(a[1]) - calcAvgX(b[1]));

  const candidateOrders = [orderShortest, orderLongest, orderTopDown, orderBottomUp, orderLeftRight];

  // Deterministic pseudo-random, for the shuffle passes.
  let seed = 1337;
  const pseudoRandom = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const budgetMs = opts.budgetMs ?? DEFAULT_ROUTING_BUDGET_MS;
  const startedAt = Date.now();
  const RIP_UP_PASSES = 4;
  const SHUFFLE_PASSES = 8;
  const totalPasses = candidateOrders.length + RIP_UP_PASSES + SHUFFLE_PASSES;

  let bestResult: RouteResult | null = null;
  let pass = 0;

  const tryOrder = (order: [string, RoutePin[]][]): boolean => {
    const res = singlePassRoute(pins, opts, order);
    if (!bestResult || res.completion > bestResult.completion) bestResult = res;
    pass++;
    opts.onProgress?.({
      pass,
      totalPasses,
      completion: bestResult.completion,
      elapsedMs: Date.now() - startedAt,
    });
    return bestResult.completion < 1 && Date.now() - startedAt < budgetMs;
  };

  for (const order of candidateOrders) {
    if (!tryOrder(order)) return bestResult!;
  }

  let currentOrder = [...orderShortest];
  for (let ripIter = 0; ripIter < RIP_UP_PASSES; ripIter++) {
    const unroutedNetIds = new Set(bestResult!.unrouted.map(u => u.netId));
    if (unroutedNetIds.size === 0) break;

    currentOrder = [...currentOrder].sort((a, b) => {
      const aFailed = unroutedNetIds.has(a[0]);
      const bFailed = unroutedNetIds.has(b[0]);
      if (aFailed && !bFailed) return -1;
      if (!aFailed && bFailed) return 1;
      return 0;
    });

    if (ripIter > 0 && currentOrder.length > 1) {
      currentOrder.push(currentOrder.shift()!);
    }

    if (!tryOrder(currentOrder)) return bestResult!;
  }

  for (let iter = 0; iter < SHUFFLE_PASSES; iter++) {
    const shuffled = [...netEntries];
    for (let k = shuffled.length - 1; k > 0; k--) {
      const j = Math.floor(pseudoRandom() * (k + 1));
      [shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]];
    }
    if (!tryOrder(shuffled)) return bestResult!;
  }

  return bestResult!;
}
