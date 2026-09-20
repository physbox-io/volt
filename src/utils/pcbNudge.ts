/**
 * Moving one part on a board that is already laid out.
 *
 * Placement is a search, and it answers the question it was asked — can this
 * arrangement be routed — which is not the same question as "is this the board
 * I want to solder". The connector wants to be on the edge the cable comes in
 * from; the regulator wants to be away from the crystal; the LED wants to be
 * where it can be seen. Until now the only way to say any of that was to move
 * the part in the schematic and pay for a whole new place-and-route, which
 * re-decides every *other* part at the same time and hands back a board with
 * nothing where it was.
 *
 * So this moves the one part and leaves the rest of the board alone. Only the
 * nets the part touches — plus any net whose copper it has been dropped on top
 * of — are ripped up and routed again, against the rest of the board stamped
 * into the grid as keepout. Everything else keeps the exact traces it had.
 *
 * Two things make that safe rather than merely fast:
 *
 * - The re-route runs on the same grid, at the same clearances, with the
 *   untouched copper as obstacles. A net that comes back routed is routed to
 *   the same rules a full pass would have held it to; one that cannot be is
 *   reported unrouted, exactly as the full pass reports it.
 * - Nothing downstream is reused. The edited {@link LayoutCore} goes back
 *   through `finishLayout` — copper flood, isolation toolpaths, drills,
 *   previews, DRC, G-code — so the board that comes out is built by the same
 *   arithmetic as one that was never touched.
 *
 * The move is also recorded in the options, as {@link PlacementOverride}, which
 * is what makes it survive: it is part of the board's fingerprint, so a
 * hand-placed board saves, restores and mills like any other, and a fresh
 * place-and-route (after a circuit edit, say) re-applies the same moves to the
 * new board rather than quietly throwing the user's work away.
 */

import type { Edge, Node } from '@xyflow/react';
import {
  DEFAULT_PCB_OPTIONS,
  effectivePadMarginMm,
  generatePcbLayout,
  layoutBoardKey,
  layoutIsMirrored,
  padOffset,
  padPolygon,
  rebuildLayoutFromCore,
  turnedSize,
  type BoardCutout,
  type LayoutCore,
  type LayoutProgress,
  type PcbLayoutResult,
  type PcbOptions,
  type PlacedComponent,
  type PlacedPad,
  type PlacementOverride,
  type PlacementOverrides,
  type Rotation,
  type TraceSegment,
} from './pcbExporter';
import type { Pt } from './pcbGeometry';
import {
  requiredConnections,
  routeBoard,
  type RouteObstacle,
  type RoutedTrace,
  type RoutePin,
  type RouteVia,
  type UnroutedConnection,
} from './pcbRouter';

/** Where a part is being put, in board-frame mm, in the core's own frame. */
export interface ComponentMove {
  componentId: string;
  /** Footprint origin, measured from the board's lower-left corner. */
  xMm: number;
  yMm: number;
  /** Left as it was when omitted. */
  rotationDeg?: Rotation;
}

/**
 * The edited board, or why it was refused.
 *
 * A pair rather than a discriminated union: this project compiles without
 * `strictNullChecks`, so a `ok: true | false` union does not narrow and every
 * caller would be casting.
 */
export interface NudgeOutcome {
  /** The board with the part moved, or null when the move was refused. */
  core: LayoutCore | null;
  /** What to tell the user, when `core` is null. */
  reason: string | null;
  /** Nets that had to be ripped up and routed again. */
  reroutedNets: string[];
}

const refused = (reason: string): NudgeOutcome => ({ core: null, reason, reroutedNets: [] });

/**
 * Budget for the re-route of a moved part's nets.
 *
 * Short on purpose. This is a handful of nets on a board whose every other
 * track is already a fixed obstacle, so there is very little for the router to
 * search — and it runs while the user is waiting to see where the part landed,
 * which is a different kind of deadline from the one a full layout works to.
 */
export const NUDGE_ROUTING_BUDGET_MS = 600;

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Stable pin key, the same one net extraction builds: `${nodeId}-${handleId}`. */
const pinKey = (pad: PlacedPad) => `${pad.componentId}-${pad.handleId || pad.pinNumber}`;

function padRadiusMm(pad: PlacedPad, comp: PlacedComponent, padMarginMm: number): number {
  const { w, h } = padOffset(pad.spec, comp.rotationDeg);
  return Math.max(w, h) / 2 + effectivePadMarginMm(comp.footprint, padMarginMm);
}

const isTht = (pad: PlacedPad) => !!pad.spec.drillDiameter && pad.spec.drillDiameter > 0;

/** Distance from a point to a line segment. */
function pointToSegmentMm(
  px: number, py: number,
  x1: number, y1: number, x2: number, y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Whether a trace runs closer than `clearMm` to a circle of radius `rMm`. */
function traceHitsDisc(trace: TraceSegment, x: number, y: number, rMm: number): boolean {
  const reach = rMm + trace.width / 2;
  if (trace.points.length === 1) {
    return Math.hypot(trace.points[0].x - x, trace.points[0].y - y) < reach;
  }
  for (let i = 0; i + 1 < trace.points.length; i++) {
    const p = trace.points[i];
    const q = trace.points[i + 1];
    if (pointToSegmentMm(x, y, p.x, p.y, q.x, q.y) < reach) return true;
  }
  return false;
}

/** Whether a trace runs through a rectangle, centre and size in mm. */
function traceHitsRect(trace: TraceSegment, cut: BoardCutout, marginMm: number): boolean {
  const hw = cut.widthMm / 2 + marginMm + trace.width / 2;
  const hh = cut.heightMm / 2 + marginMm + trace.width / 2;
  const inside = (x: number, y: number) =>
    Math.abs(x - cut.x) <= hw && Math.abs(y - cut.y) <= hh;
  for (let i = 0; i < trace.points.length; i++) {
    if (inside(trace.points[i].x, trace.points[i].y)) return true;
    if (i + 1 < trace.points.length) {
      // Sampled along the segment: a track can cross a small cutout without
      // either end being inside it.
      const p = trace.points[i];
      const q = trace.points[i + 1];
      const steps = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 0.25);
      for (let k = 1; k < steps; k++) {
        if (inside(p.x + ((q.x - p.x) * k) / steps, p.y + ((q.y - p.y) * k) / steps)) return true;
      }
    }
  }
  return false;
}

/**
 * Nets whose pads are not all joined by copper.
 *
 * The router reports what it could not route; this reports what the board
 * actually connects, which is not the same statement. A merge of freshly
 * routed tracks with kept ones can lose a track without any completion figure
 * moving — and that is the one failure mode of an incremental move that is
 * invisible: the pads are still in the right place and still the right
 * colour, and the board looks finished right up until it is soldered.
 *
 * Measured on nominal copper, before the flood. Flooding grows every net by up
 * to `copperFloodMm` and can bridge a gap the router left, which would make
 * whether a board is wired up depend on a setting that is only supposed to
 * decide how much copper survives.
 */
export function unjoinedNets(core: LayoutCore, options: PcbOptions): string[] {
  const padMargin = Math.max(0, options.padMarginMm ?? 0);
  const compById = new Map(core.placed.map(c => [c.id, c]));
  const out: string[] = [];

  for (const netId of new Set(core.pads.filter(p => p.netId).map(p => p.netId!))) {
    const pads = core.pads.filter(p => p.netId === netId);
    if (pads.length < 2) continue;
    /** A piece of this net's copper: a centre or a polyline, and a radius. */
    const blobs: { pts: Pt[]; r: number }[] = [
      ...pads.map(pad => {
        const comp = compById.get(pad.componentId)!;
        return { pts: [{ x: pad.x, y: pad.y }], r: padRadiusMm(pad, comp, padMargin) };
      }),
      ...core.traces.filter(t => t.netId === netId).map(t => ({ pts: t.points, r: t.width / 2 })),
      ...(core.vias ?? [])
        .filter(v => v.netId === netId)
        .map(v => ({ pts: [{ x: v.x, y: v.y }], r: v.padMm / 2 })),
    ];

    const parent = blobs.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < blobs.length; i++) {
      for (let j = i + 1; j < blobs.length; j++) {
        if (blobGapMm(blobs[i], blobs[j]) <= blobs[i].r + blobs[j].r + 1e-6) {
          parent[find(i)] = find(j);
        }
      }
    }
    // The pads are the first entries, and they all have to end up in one piece.
    if (new Set(pads.map((_, i) => find(i))).size > 1) out.push(netId);
  }
  return out;
}

/** Closest approach between two pieces of copper, centreline to centreline. */
function blobGapMm(a: { pts: Pt[] }, b: { pts: Pt[] }): number {
  const segs = (p: { pts: Pt[] }): [Pt, Pt][] =>
    p.pts.length === 1
      ? [[p.pts[0], p.pts[0]]]
      : p.pts.slice(0, -1).map((pt, i) => [pt, p.pts[i + 1]] as [Pt, Pt]);
  let best = Infinity;
  for (const [a0, a1] of segs(a)) {
    for (const [b0, b1] of segs(b)) {
      best = Math.min(
        best,
        pointToSegmentMm(a0.x, a0.y, b0.x, b0.y, b1.x, b1.y),
        pointToSegmentMm(a1.x, a1.y, b0.x, b0.y, b1.x, b1.y),
        pointToSegmentMm(b0.x, b0.y, a0.x, a0.y, a1.x, a1.y),
        pointToSegmentMm(b1.x, b1.y, a0.x, a0.y, a1.x, a1.y)
      );
    }
  }
  return best;
}

/** The placement of a part as it stands, in the frame an override is stored in. */
export function placementOverrideFor(
  core: LayoutCore,
  componentId: string
): PlacementOverride | null {
  const comp = core.placed.find(c => c.id === componentId);
  if (!comp) return null;
  return {
    xMm: round3(comp.x - core.boardOriginMm),
    yMm: round3(comp.y - core.boardOriginMm),
    rotationDeg: comp.rotationDeg,
    type: comp.type,
  };
}

/**
 * A point read off a finished board, mapped back into the core it was built
 * from — which for a single-sided board is its mirror image.
 *
 * `xMm`/`yMm` are board-frame: measured from the board's lower-left corner,
 * not from the program origin.
 */
export function coreFrameMove(
  boardWidthMm: number,
  options: Partial<PcbOptions>,
  move: ComponentMove
): ComponentMove {
  if (!layoutIsMirrored(options)) return move;
  const rot = move.rotationDeg;
  return {
    componentId: move.componentId,
    xMm: boardWidthMm - move.xMm,
    yMm: move.yMm,
    // Reflecting about a vertical axis takes a heading of t to 180 - t.
    rotationDeg: rot === undefined ? undefined : ((((180 - rot) % 360) + 360) % 360) as Rotation,
  };
}

/**
 * Moves one part and routes the nets that move with it, in place on a copy of
 * `core`. The board keeps its size: a hand move is not a reason to re-crop the
 * laminate and shift every other feature to follow.
 */
export function moveComponentInCore(
  core: LayoutCore,
  userOptions: Partial<PcbOptions> | undefined,
  move: ComponentMove,
  budgetMs = NUDGE_ROUTING_BUDGET_MS
): NudgeOutcome {
  const options: PcbOptions = { ...DEFAULT_PCB_OPTIONS, ...userOptions };
  const next: LayoutCore = structuredClone(core);
  const comp = next.placed.find(c => c.id === move.componentId);
  if (!comp) return refused(`No part "${move.componentId}" on this board.`);

  const rotationDeg = move.rotationDeg ?? comp.rotationDeg;
  const { widthMm, heightMm } = turnedSize(comp.footprint, rotationDeg);
  const o = next.boardOriginMm;
  const x = round3(o + move.xMm);
  const y = round3(o + move.yMm);

  // The profile cut runs a tool radius outside the finished edge and the
  // router keeps a tool width clear of it, so copper this close to the rim is
  // copper the job would mill off.
  const keepIn = Math.max(1.0, options.profileToolDiaMm);
  const padMargin = Math.max(0, options.padMarginMm ?? 0);
  const outside = (px: number, py: number) =>
    px < o + keepIn || py < o + keepIn ||
    px > o + next.boardWidthMm - keepIn || py > o + next.boardHeightMm - keepIn;

  const probe: PlacedComponent = { ...comp, x, y, rotationDeg, widthMm, heightMm };
  if (
    outside(x - widthMm / 2, y - heightMm / 2) ||
    outside(x + widthMm / 2, y + heightMm / 2)
  ) {
    return refused(`${comp.name} would hang over the edge of the board.`);
  }
  for (const spec of comp.footprint.pads) {
    const { dx, dy } = padOffset(spec, rotationDeg);
    const poly = padPolygon(
      { componentId: comp.id, handleId: '', pinNumber: spec.pinNumber, netId: null, x: x + dx, y: y + dy, spec },
      rotationDeg,
      effectivePadMarginMm(comp.footprint, padMargin)
    );
    if (poly.some(p => outside(p.x, p.y))) {
      return refused(`${comp.name}'s pads would run off the edge of the board.`);
    }
  }
  for (const other of next.placed) {
    if (other.id === comp.id) continue;
    if (
      Math.abs(probe.x - other.x) < (probe.widthMm + other.widthMm) / 2 - 0.01 &&
      Math.abs(probe.y - other.y) < (probe.heightMm + other.heightMm) / 2 - 0.01
    ) {
      return refused(`${comp.name} would sit on top of ${other.name}.`);
    }
  }

  // --- The part itself -----------------------------------------------------
  comp.x = x;
  comp.y = y;
  comp.rotationDeg = rotationDeg;
  comp.widthMm = widthMm;
  comp.heightMm = heightMm;

  const ownPads = next.pads.filter(p => p.componentId === comp.id);
  for (const pad of ownPads) {
    const spec = comp.footprint.pads.find(s => s.pinNumber === pad.pinNumber) ?? pad.spec;
    const { dx, dy } = padOffset(spec, rotationDeg);
    pad.spec = spec;
    pad.x = round3(x + dx);
    pad.y = round3(y + dy);
  }
  for (const cut of next.cutouts) {
    if (cut.componentId !== comp.id) continue;
    cut.x = x;
    cut.y = y;
    cut.widthMm = widthMm;
    cut.heightMm = heightMm;
  }

  // --- What has to be routed again -----------------------------------------
  // Its own nets, because its pads have moved; and any net whose copper is now
  // underneath it, because the part was dropped on top of a track that was
  // routed through empty laminate.
  const affected = new Set<string>();
  for (const pad of ownPads) if (pad.netId) affected.add(pad.netId);

  const clearance = options.clearanceMm;
  for (const trace of next.traces) {
    if (affected.has(trace.netId)) continue;
    const hitsPad = ownPads.some(pad =>
      traceHitsDisc(trace, pad.x, pad.y, padRadiusMm(pad, comp, padMargin) + clearance)
    );
    const hitsCutout =
      !hitsPad &&
      next.cutouts.some(c => c.componentId === comp.id && traceHitsRect(trace, c, clearance));
    if (hitsPad || hitsCutout) affected.add(trace.netId);
  }
  // A via is copper on both faces and a hole through the middle, so one under
  // the part's new pads is the same problem as a track under them.
  for (const via of next.vias ?? []) {
    if (affected.has(via.netId)) continue;
    const reach = via.padMm / 2 + clearance;
    if (ownPads.some(pad =>
      Math.hypot(via.x - pad.x, via.y - pad.y) < padRadiusMm(pad, comp, padMargin) + reach
    )) {
      affected.add(via.netId);
    }
  }

  const keptTraces = next.traces.filter(t => !affected.has(t.netId));
  const keptVias = (next.vias ?? []).filter(v => !affected.has(v.netId));

  // --- The re-route --------------------------------------------------------
  // In the board's own frame: the router grids from (0,0), while everything in
  // a core is inset by the origin offset so the profile pass starts on X0Y0.
  const compById = new Map(next.placed.map(c => [c.id, c]));
  const local = <T extends { x: number; y: number }>(v: T): T => ({ ...v, x: v.x - o, y: v.y - o });

  const allPins: RoutePin[] = [];
  const pins: RoutePin[] = [];
  /** Keepout for any pass: copper and holes that belong to no net at all. */
  const obstacles: RouteObstacle[] = [];
  /** Plus, for the incremental pass only, the pads of the nets it leaves alone. */
  const frozenPads: RouteObstacle[] = [];
  for (const pad of next.pads) {
    const owner = compById.get(pad.componentId);
    if (!owner) continue;
    const keepout: RouteObstacle = {
      x: pad.x - o,
      y: pad.y - o,
      radiusMm: padRadiusMm(pad, owner, padMargin),
      layer: isTht(pad) ? undefined : 'top',
    };
    if (!pad.netId) {
      obstacles.push(keepout);
      continue;
    }
    const pin: RoutePin = {
      netId: pad.netId,
      key: pinKey(pad),
      componentId: pad.componentId,
      x: pad.x,
      y: pad.y,
      padRadiusMm: keepout.radiusMm!,
      layer: isTht(pad) ? 'both' : 'top',
    };
    allPins.push(pin);
    if (affected.has(pad.netId)) pins.push(local(pin));
    // A pad on a net nobody is re-routing is another net's copper, and the
    // incremental pass has to keep clear of it exactly as it keeps clear of
    // that net's tracks. The full pass routes to it instead.
    else frozenPads.push(keepout);
  }
  for (const cut of next.cutouts) {
    obstacles.push(
      cut.shape === 'circle'
        ? { x: cut.x - o, y: cut.y - o, radiusMm: Math.max(cut.widthMm, cut.heightMm) / 2 }
        : { x: cut.x - o, y: cut.y - o, widthMm: cut.widthMm, heightMm: cut.heightMm }
    );
  }

  // Wire jumpers already on the board close a connection without copper, and
  // the MST has to know that or it plans a track the board does not need.
  const linkedPairs: [string, string][] = [];
  for (const c of next.placed) {
    if (!c.data?.autoJumper) continue;
    const jp = next.pads.filter(p => p.componentId === c.id);
    if (jp.length === 2) linkedPairs.push([pinKey(jp[0]), pinKey(jp[1])]);
  }

  const routerOpts = {
    boardWidthMm: next.boardWidthMm,
    boardHeightMm: next.boardHeightMm,
    gridMm: options.routingGridMm,
    traceWidthMm: options.traceWidthMm,
    clearanceMm: clearance,
    edgeClearanceMm: keepIn,
    bendPenalty: 1.5,
    obstacles,
    linkedPairs,
    layers: options.layers ?? 1,
    viaPadMm: options.viaPadMm,
    viaDrillMm: options.viaDrillMm,
  };

  const routed = routeBoard(pins, {
    ...routerOpts,
    obstacles: [...obstacles, ...frozenPads],
    budgetMs,
    keepTraces: keptTraces.map(t => ({
      netId: t.netId,
      points: t.points.map(p => ({ ...p, x: p.x - o, y: p.y - o })),
      widthMm: t.width,
      layer: t.layer,
    })),
    keepVias: keptVias.map(local),
  });

  /** Router output, back in the board's own frame. */
  const back = (traces: RoutedTrace[], vias: RouteVia[] | undefined) => ({
    traces: traces.map(t => ({
      netId: t.netId,
      points: t.points.map(p => ({ ...p, x: round3(p.x + o), y: round3(p.y + o) })),
      width: t.widthMm,
      layer: t.layer ?? 'top',
    })) as TraceSegment[],
    vias: (vias ?? []).map(v => ({ ...v, x: round3(v.x + o), y: round3(v.y + o) })),
  });

  const required = requiredConnections(allPins, linkedPairs);
  const settle = (traces: TraceSegment[], vias: RouteVia[], unrouted: UnroutedConnection[]) => {
    next.traces = traces;
    next.vias = vias.length > 0 ? vias : undefined;
    next.unrouted = unrouted;
    // Stated over the whole board, not over the handful of nets this pass
    // touched: a completion of 1 for two re-routed nets says nothing about the
    // board, and it is the board that gets milled.
    next.completion = required === 0 ? 1 : (required - unrouted.length) / required;
  };

  const incremental = back(routed.traces, routed.vias);
  settle(
    [...keptTraces, ...incremental.traces],
    [...keptVias, ...incremental.vias],
    [...next.unrouted.filter(u => !affected.has(u.netId)), ...routed.unrouted]
  );

  const wasUnjoined = new Set(unjoinedNets(core, options));
  /** What this pass has cost the board: a lost connection, however it shows. */
  const worseThanBefore = (c: LayoutCore) =>
    c.unrouted.length > core.unrouted.length ||
    unjoinedNets(c, options).some(netId => !wasUnjoined.has(netId));

  if (worseThanBefore(next)) {
    /*
     * The cheap pass has cost the board a connection, so try the expensive one
     * before handing that back.
     *
     * Freezing every other track is what makes a move instant, and it is also
     * what makes some moves impossible: those tracks were routed around where
     * the part used to be, so a part that lands among them can be walled in by
     * copper that would happily have gone the other way round. Routing the
     * whole board again — at the placement the drag just asked for, with no
     * placement search — costs one router pass and usually finds it.
     *
     * The placement is what a drag is about. Every part stays exactly where the
     * user put it; only the copper is redrawn.
     */
    const full = routeBoard(allPins.map(local), {
      ...routerOpts,
      budgetMs: Math.max(1000, Math.min(4000, options.routingBudgetMs)),
    });
    const redrawn = back(full.traces, full.vias);
    settle(redrawn.traces, redrawn.vias, full.unrouted);
    if (!worseThanBefore(next)) {
      for (const pin of allPins) affected.add(pin.netId);
    } else {
      /*
       * Neither pass can wire the board up with the part there, so nothing
       * moves. A board that quietly loses a connection is the one outcome
       * worth refusing outright: it does not look wrong on the preview — the
       * pads are still the right colour and in the right place — and the next
       * thing that happens to a board is that somebody mills it.
       */
      const lost = [
        ...new Set([
          ...full.unrouted.map(u => u.netId),
          ...unjoinedNets(next, options).filter(netId => !wasUnjoined.has(netId)),
        ]),
      ];
      return refused(
        `${comp.name} cannot go there — ` +
        `net ${lost.join(', ')} could not be wired up, so nothing was moved. ` +
        `Try a little further out, or turn the part.`
      );
    }
  }

  return { core: next, reason: null, reroutedNets: [...affected] };
}

/**
 * Replays the hand placements recorded in `options` onto a freshly laid out
 * board.
 *
 * Applied after the search rather than inside it, and in the finished board's
 * own frame, because that is the only frame an override can be recorded in:
 * placement works on a board that has not been cropped yet, and the crop then
 * moves everything by an amount that depends on where the copper ended up.
 *
 * An override that no longer fits — the part is gone, it has become a
 * different kind of part, the board shrank under it, another part is now in
 * that spot — is dropped with a warning rather than forced. The board is then
 * the one the router decided, which is a board that works; silently milling a
 * part half off the edge because of something the user did three edits ago is
 * not.
 */
export function applyPlacementOverrides(
  core: LayoutCore,
  options: Partial<PcbOptions> | undefined
): LayoutCore {
  const overrides = options?.placementOverrides;
  if (!overrides) return core;
  // Sorted, so a board with several hand-placed parts comes out the same on
  // every machine whatever order the object happens to enumerate in.
  const ids = Object.keys(overrides).sort();
  let cur = core;
  const dropped: string[] = [];
  for (const id of ids) {
    const want = overrides[id];
    const comp = cur.placed.find(c => c.id === id);
    if (!comp || (want.type !== undefined && want.type !== comp.type)) continue;
    if (
      Math.abs(comp.x - (cur.boardOriginMm + want.xMm)) < 1e-6 &&
      Math.abs(comp.y - (cur.boardOriginMm + want.yMm)) < 1e-6 &&
      comp.rotationDeg === want.rotationDeg
    ) {
      continue;
    }
    const outcome = moveComponentInCore(cur, options, {
      componentId: id,
      xMm: want.xMm,
      yMm: want.yMm,
      rotationDeg: want.rotationDeg,
    });
    if (outcome.core) cur = outcome.core;
    else dropped.push(`${comp.name}: ${outcome.reason}`);
  }
  if (dropped.length > 0) {
    cur = cur === core ? structuredClone(core) : cur;
    cur.warnings = [
      ...cur.warnings,
      `Hand placement dropped for ${dropped.length} part(s) — ${dropped.join('; ')} ` +
      `They were placed automatically instead.`,
    ];
  }
  return cur;
}

/**
 * A board, laid out and then put where the user wants it.
 *
 * Every entry point that lays a board out from a circuit goes through here
 * rather than calling `generatePcbLayout` directly, so a hand-placed board
 * mills the same whether it came from the export panel, an agent over MCP, or
 * the machine controls.
 */
export function layoutWithOverrides(
  nodes: Node[],
  edges: Edge[],
  options?: Partial<PcbOptions>,
  onProgress?: (p: LayoutProgress) => void
): PcbLayoutResult {
  const base = generatePcbLayout(nodes, edges, options, onProgress);
  const core = base.snapshot?.core;
  if (!core || !options?.placementOverrides) return base;
  const moved = applyPlacementOverrides(core, options);
  if (moved === core) return base;
  return rebuildLayoutFromCore(moved, options, base.snapshot!.boardKey);
}

/**
 * Moves a part on a board that is already on screen.
 *
 * Hands back the new board *and* the options it belongs to — the move is only
 * real once it is in the fingerprint, and a caller that showed the board
 * without adopting the options would have a board nothing could reproduce.
 */
export interface NudgedLayout {
  /** The board with the part moved, or null when the move was refused. */
  result: PcbLayoutResult | null;
  /** The options that board belongs to — the move is in its fingerprint. */
  options: PcbOptions | null;
  reason: string | null;
}

export function nudgeLayout(
  result: PcbLayoutResult,
  nodes: Node[],
  edges: Edge[],
  options: PcbOptions,
  move: ComponentMove
): NudgedLayout {
  const core = result.snapshot ? result.snapshot.core : null;
  if (!core) {
    return { result: null, options: null, reason: 'This board has not finished routing yet.' };
  }

  const outcome = moveComponentInCore(core, options, move);
  if (!outcome.core) return { result: null, options: null, reason: outcome.reason };

  const placed = placementOverrideFor(outcome.core, move.componentId);
  if (!placed) {
    return { result: null, options: null, reason: `No part "${move.componentId}" on this board.` };
  }
  const nextOptions: PcbOptions = {
    ...options,
    placementOverrides: { ...options.placementOverrides, [move.componentId]: placed },
  };
  return {
    options: nextOptions,
    reason: null,
    result: rebuildLayoutFromCore(
      outcome.core,
      nextOptions,
      layoutBoardKey(nodes, edges, nextOptions)
    ),
  };
}

/** The overrides, less the parts named. Empty maps are dropped entirely. */
export function withoutOverrides(
  overrides: PlacementOverrides | undefined,
  componentIds?: string[]
): PlacementOverrides | undefined {
  if (!overrides) return undefined;
  if (!componentIds) return undefined;
  const out = { ...overrides };
  for (const id of componentIds) delete out[id];
  return Object.keys(out).length > 0 ? out : undefined;
}
