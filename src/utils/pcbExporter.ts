// ---------------------------------------------------------------------------
// PCB CAM Engine & Multi-Tool G-Code Generator
//
// Pipeline:
//   schematic graph
//     -> nets            (pcbNets.ts, reuses the SPICE connectivity graph)
//     -> placement       (footprint-aware, collision-relaxed)
//     -> routing         (pcbRouter.ts, single-layer A* maze router)
//     -> copper geometry (pcbGeometry.ts, polygon booleans via clipper-lib)
//     -> isolation toolpaths + drills + edge profile
//     -> G-code
//
// The isolation stage is the safety-critical one: a toolpath is only emitted
// where it provably stays a tool radius away from every *other* net's copper,
// so milling the output cannot sever a trace.
// ---------------------------------------------------------------------------

import type { Node, Edge } from '@xyflow/react';
import { resolveFootprint, type ComponentFootprint, type PadSpec } from './pcbFootprints';
import { extractNets, isPhysical, resolveHandleToPin, type PcbNet } from './pcbNets';
import { minPadGapMm } from './pcbTooling';
import {
  circlePoly,
  differencePolys,
  intersectPolys,
  offsetPolys,
  ovalPoly,
  polysBounds,
  polysOverlap,
  polysToSvgPath,
  rectPoly,
  strokeToPoly,
  totalArea,
  unionPolys,
  type Poly,
  type Pt,
} from './pcbGeometry';
import {
  routeBoard,
  DEFAULT_ROUTING_BUDGET_MS,
  type RouteObstacle,
  type RoutePin,
  type RoutedTrace,
  type UnroutedConnection,
  type RouteProgress,
} from './pcbRouter';

export interface PcbOptions {
  boardWidthMm: number;        // Board width, or minimum width when auto-sizing
  boardHeightMm: number;       // Board height, or minimum height when auto-sizing
  traceWidthMm: number;        // Target trace width in mm (default 0.4)
  clearanceMm: number;         // Copper-to-copper clearance in mm (default 0.4)
  isolationPasses: number;     // Number of offset passes (1, 2, or 3)
  vBitAngleDeg: number;        // V-bit included angle in degrees
  vBitTipMm: number;           // V-bit tip width in mm
  routingGridMm: number;       // Maze router grid resolution (default 0.25)
  routingBudgetMs: number;     // Wall-clock budget for the maze router (default 8000)
  cutFeedrate: number;         // Feedrate for isolation milling (mm/min)
  travelFeedrate: number;      // Rapid feedrate (mm/min)
  plungeFeedrate: number;      // Z plunge rate (mm/min)
  drillFeedrate: number;       // Z drilling feedrate (mm/min)
  spindleRpm: number;          // Spindle RPM
  safeZ: number;               // Safe retract Z height in mm
  isolationDepthZ: number;     // Depth for isolation milling in mm (negative)
  drillDepthZ: number;         // Depth for drilling through-holes in mm
  profileDepthZ: number;       // Depth for board edge profiling in mm
  zStepdown: number;           // Depth per pass for profiling in mm
  profileToolDiaMm: number;    // End mill diameter for the profile cut
  tabCount: number;            // Holding tabs around the profile (0 disables)
  tabWidthMm: number;          // Width of each holding tab
  tabHeightMm: number;         // Height of uncut material left at each tab
  pauseOnToolChange: boolean;  // Insert T<N> M6 pauses
  autoGrowBoard: boolean;      // Size the board to the parts (never below the requested size)
  rampedPlunge?: boolean;      // Enable 3D ramped entry for plunges (default true)
  rubOutClearing?: boolean;    // Clear unassigned copper areas (default false)
  airCutZOffset?: number;      // Z offset for Air Cut dry runs (default 20mm)
  /**
   * Extra copper grown around every pad, per side, in mm. Footprint pads are
   * sized for a factory process; on a milled board a bigger annulus is easier
   * to solder by hand and survives a drill that wanders a little. 0 keeps the
   * footprint's own size.
   *
   * It is a ceiling, not a fixed amount: on a fine-pitch part the margin is
   * scaled back per-component so it never eats the gap the isolation tool has
   * to fit through. Growing a 0.5mm-pitch QFN's pads by 0.1mm a side would
   * short them together.
   */
  padMarginMm?: number;
  /**
   * Drill diameters within this span share one bit, sized to the largest hole
   * in the group. Footprints carry nominal lead diameters — 0.8, 0.9, 1.0, 1.1
   * — and drilling each with its own bit means a tool change per size for no
   * practical gain on a prototype. 0 keeps every nominal size separate.
   */
  drillConsolidationMm?: number;
  /**
   * Blank border left around the outermost copper when auto-sizing, per side,
   * in mm. This is handling and clamping room only — the isolation ring and
   * the profile kerf get their own space on top of it, so a small value here
   * cannot cut into the toolpaths.
   */
  boardMarginMm?: number;
  /**
   * Drill bits the user actually owns, keyed by the diameter the layout asks
   * for (as a string, e.g. "0.9") and mapped to the bit loaded instead. A hole
   * may only be drilled at or above its nominal size, so an override smaller
   * than the requested diameter is ignored.
   */
  drillBitOverridesMm?: Record<string, number>;
  /**
   * How far each net's copper may flood outward from its nominal geometry, per
   * side, in mm. 0 mills the nominal trace width and throws the rest away.
   *
   * Trace width is a *routing* figure — it decides where the router is willing
   * to put a track. On an isolation job it is a poor milling figure: every
   * micron of gap wider than the tool's own channel is copper that gets cut
   * away for nothing, and copper is what carries current and survives a
   * soldering iron. Flooding grows each net back out until it is one channel
   * width (plus {@link channelMarginMm}) from its neighbours, so the gaps end
   * up as narrow as the bit can cut and everything else stays copper.
   *
   * It is a ceiling, not a fixed amount: a net in open laminate takes the whole
   * figure, a net running beside another stops where the channel demands. Fat
   * copper means more coupling between adjacent nets, so keep it modest on
   * anything RF or oscillator-shaped.
   */
  copperFloodMm?: number;
  /**
   * Extra clearance kept on *each* side of the isolation channel when copper is
   * flooded, in mm. This is the flood's safety margin against an unlevelled
   * board and against Clipper's own rounding: at 0 the pass-0 ring would touch
   * the neighbouring copper's keepout and get truncated, which leaves the two
   * nets shorted.
   */
  channelMarginMm?: number;
}

export const DEFAULT_PCB_OPTIONS: PcbOptions = {
  // A floor, not a target: with auto-size on the board shrinks to the parts, so
  // this is deliberately small enough not to pad a simple board out.
  boardWidthMm: 20,
  boardHeightMm: 20,
  traceWidthMm: 0.4,
  clearanceMm: 0.4,
  isolationPasses: 1,
  vBitAngleDeg: 30,
  vBitTipMm: 0.1,
  routingGridMm: 0.25,
  routingBudgetMs: DEFAULT_ROUTING_BUDGET_MS,
  cutFeedrate: 300,
  travelFeedrate: 1500,
  plungeFeedrate: 100,
  drillFeedrate: 150,
  spindleRpm: 12000,
  safeZ: 2.0,
  isolationDepthZ: -0.16,
  drillDepthZ: -1.8,
  profileDepthZ: -1.6,
  zStepdown: 0.8,
  profileToolDiaMm: 1.5,
  tabCount: 4,
  tabWidthMm: 3.0,
  tabHeightMm: 0.6,
  pauseOnToolChange: true,
  autoGrowBoard: true,
  rampedPlunge: true,
  rubOutClearing: false,
  airCutZOffset: 20,
  padMarginMm: 0.1,
  drillConsolidationMm: 0.3,
  boardMarginMm: 1.5,
  copperFloodMm: 0.6,
  channelMarginMm: 0.05,
};

/**
 * Computes suggested board dimensions (widthMm, heightMm) to comfortably accommodate
 * all physical components and perimeter routing channels in a circuit.
 */
export function calculateSuggestedBoardSize(
  circuitNodes: Node[],
  options?: Partial<PcbOptions>
): { widthMm: number; heightMm: number } {
  const nodes = circuitNodes || [];
  const physicalNodes = nodes.filter(n => isPhysical(n.type));
  if (physicalNodes.length === 0) {
    return { widthMm: 45, heightMm: 35 };
  }

  const profileToolDia = options?.profileToolDiaMm ?? DEFAULT_PCB_OPTIONS.profileToolDiaMm;
  const traceWidth = options?.traceWidthMm ?? DEFAULT_PCB_OPTIONS.traceWidthMm;
  const clearance = options?.clearanceMm ?? DEFAULT_PCB_OPTIONS.clearanceMm;

  const gap = Math.max(3.5, traceWidth + clearance * 5);
  const edge = Math.max(7.0, profileToolDia + 4.5);

  const inputs = physicalNodes.map(node => {
    const data = (node.data ?? {}) as {
      orientation?: string;
      packageId?: string;
      pins?: number;
    };
    const orientation = data.orientation;
    const rotationDeg: 0 | 90 = orientation === 'vertical' || orientation === 'up' ? 90 : 0;
    const footprint = resolveFootprint(data.packageId, node.type, data.pins || 2, node.data);
    const widthMm = rotationDeg === 90 ? footprint.heightMm : footprint.widthMm;
    const heightMm = rotationDeg === 90 ? footprint.widthMm : footprint.heightMm;
    return { widthMm, heightMm };
  });

  const need = inputs.reduce((s, c) => s + (c.widthMm + gap) * (c.heightMm + gap), 0) * 1.7;
  const side = Math.sqrt(Math.max(need, 1));
  const minW = Math.max(...inputs.map(c => c.widthMm), 0) + edge * 2 + gap;
  const minH = Math.max(...inputs.map(c => c.heightMm), 0) + edge * 2 + gap;

  // Round up to nearest 5mm for standard clean stock sizing
  const rawW = Math.max(30, Math.ceil(Math.max(side + edge * 2, minW)));
  const rawH = Math.max(30, Math.ceil(Math.max(side + edge * 2, minH)));

  const widthMm = Math.ceil(rawW / 5) * 5;
  const heightMm = Math.ceil(rawH / 5) * 5;

  return { widthMm, heightMm };
}

export interface PlacedComponent {
  id: string;
  name: string;
  type: string;
  x: number;                 // Board absolute X of the footprint origin (mm)
  y: number;                 // Board absolute Y of the footprint origin (mm)
  rotationDeg: 0 | 90;
  footprint: ComponentFootprint;
  widthMm: number;           // Courtyard after rotation
  heightMm: number;
  data?: any;
}

export interface PlacedPad {
  componentId: string;
  handleId: string;
  pinNumber: string | number;
  netId: string | null;
  x: number;                 // Absolute board X (mm)
  y: number;                 // Absolute board Y (mm)
  spec: PadSpec;
}

/** A routed connection, as a polyline of board coordinates. */
export interface TraceSegment {
  netId: string;
  points: Pt[];
  width: number;
}

export interface IsolationPath {
  netId: string;
  pass: number;
  points: Pt[];
}

export interface DrillPoint {
  x: number;
  y: number;
  diameter: number;
  componentId: string;
  pinNumber: string | number;
}

/** A region milled clean through the board by the profile tool. */
export interface BoardCutout {
  componentId: string;
  shape: 'rect' | 'circle';
  /** Centre, in board coordinates. */
  x: number;
  y: number;
  widthMm: number;
  heightMm: number;
}

export interface DrcViolation {
  severity: 'error' | 'warning';
  message: string;
}

export interface PcbLayoutResult {
  success: boolean;
  boardWidthMm: number;
  boardHeightMm: number;
  /**
   * Offset from the program origin to the board's lower-left corner, in mm.
   * Every coordinate in this result already includes it; it is published so
   * renderers can draw the board rectangle in the right place and so the
   * profile pass knows where the finished edge is. See
   * {@link boardOriginOffsetMm}.
   */
  boardOriginMm: number;
  components: PlacedComponent[];
  pads: PlacedPad[];
  nets: PcbNet[];
  traces: TraceSegment[];
  isolationPaths: IsolationPath[];
  drills: DrillPoint[];
  cutouts: BoardCutout[];
  unrouted: UnroutedConnection[];
  violations: DrcViolation[];
  warnings: string[];
  /** Fraction of required connections routed, 0..1. */
  completion: number;
  /** Effective cutting width of the V-bit at the configured depth. */
  effectiveToolDiaMm: number;
  /**
   * How far copper was actually flooded past its nominal geometry, per side,
   * in mm. Below {@link PcbOptions.copperFloodMm} when the board ran out of
   * room before the budget did.
   */
  copperFloodMm: number;
  cycleTimeSec: number;
  travelDistanceMm: number;
  cutDistanceMm: number;
  svg: string;
  gcode: string;
  error?: string;
}

/**
 * Width a V-bit actually cuts at a given depth:
 *   tip + 2 * depth * tan(includedAngle / 2)
 */
export function vBitWidthAtDepth(
  tipMm: number,
  includedAngleDeg: number,
  depthMm: number
): number {
  const halfAngle = ((includedAngleDeg / 2) * Math.PI) / 180;
  return tipMm + 2 * Math.abs(depthMm) * Math.tan(halfAngle);
}

const minPadGapCache = new WeakMap<ComponentFootprint, number>();

/**
 * The pad margin actually applied to one component.
 *
 * `padMarginMm` is a hand-soldering convenience sized for through-hole work. On
 * a fine-pitch part the same figure closes the gap the isolation tool has to
 * fit through — grow a 0.5mm-pitch QFN's pads by 0.1mm a side and the pads
 * short together before the mill ever runs. So the request is capped at a fifth
 * of the part's own tightest pad gap, leaving at least 60% of that gap intact.
 */
export function effectivePadMarginMm(footprint: ComponentFootprint, requestedMm: number): number {
  if (requestedMm <= 0) return 0;
  let gap = minPadGapCache.get(footprint);
  if (gap === undefined) {
    gap = minPadGapMm(footprint.pads);
    minPadGapCache.set(footprint, gap);
  }
  if (!Number.isFinite(gap)) return requestedMm;
  return Math.max(0, Math.min(requestedMm, gap * 0.2));
}

/** Applies a footprint's pad offset, honouring 90-degree rotation. */
function padOffset(
  spec: PadSpec,
  rotationDeg: 0 | 90
): { dx: number; dy: number; w: number; h: number } {
  if (rotationDeg === 90) {
    return { dx: -spec.y, dy: spec.x, w: spec.padHeight, h: spec.padWidth };
  }
  return { dx: spec.x, dy: spec.y, w: spec.padWidth, h: spec.padHeight };
}

/**
 * Outer copper polygon of a placed pad.
 *
 * `marginMm` grows the pad on every side. It is clamped so the copper can never
 * be shrunk below the drill it surrounds — a pad smaller than its own hole is
 * an annulus that the drill removes entirely, leaving the joint with nothing to
 * solder to.
 */
function padPolygon(pad: PlacedPad, rotationDeg: 0 | 90, marginMm = 0): Poly {
  const { w: rawW, h: rawH } = padOffset(pad.spec, rotationDeg);
  const drill = pad.spec.drillDiameter || 0;
  const grow = Math.max(marginMm, 0);
  const w = Math.max(rawW + grow * 2, drill);
  const h = Math.max(rawH + grow * 2, drill);
  switch (pad.spec.shape) {
    case 'circle':
      return circlePoly(pad.x, pad.y, Math.max(w, h) / 2);
    case 'oval':
      return ovalPoly(pad.x, pad.y, w, h);
    default:
      return rectPoly(pad.x, pad.y, w, h);
  }
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

interface PlacementInput {
  id: string;
  name: string;
  type: string;
  schematicX: number;
  schematicY: number;
  rotationDeg: 0 | 90;
  footprint: ComponentFootprint;
  widthMm: number;
  heightMm: number;
  data?: any;
}

/**
 * Seeds positions from the schematic layout (so the board resembles what the
 * user drew), then relaxes overlaps by pushing colliding courtyards apart.
 */
function placeComponents(
  inputs: PlacementInput[],
  opts: PcbOptions,
  warnings: string[],
  spreadScale = 1
): { placed: PlacedComponent[]; boardWidthMm: number; boardHeightMm: number } {
  // Gap between courtyards: room for at least one trace plus clearances.
  // `spreadScale` loosens it on later attempts, when a tighter packing turned
  // out to leave the router nowhere to go.
  const gap = Math.max(3.5, opts.traceWidthMm + opts.clearanceMm * 5) * spreadScale;
  const edge = Math.max(7.0, opts.profileToolDiaMm + 4.5);

  // Auto-sizing on: the board is cropped to whatever the parts actually occupy,
  // but never shrinks below the requested dimensions — so the requested size
  // acts as a minimum, and raising it still grows the board.
  // Auto-sizing off: the board is exactly the size requested, and parts are
  // packed into it whether or not they fit.
  const autoSize = opts.autoGrowBoard;

  let boardW = opts.boardWidthMm;
  let boardH = opts.boardHeightMm;

  if (autoSize) {
    // Seed area: total courtyard area plus gaps, padded for routing channels.
    // This is only where the relaxation starts — the final size comes from the
    // packed result, not from here.
    const need =
      inputs.reduce((s, c) => s + (c.widthMm + gap) * (c.heightMm + gap), 0) * 1.7;
    const side = Math.sqrt(Math.max(need, 1));
    boardW = Math.ceil(side + edge * 2);
    boardH = Math.ceil(side + edge * 2);
    // Nothing may be narrower than the widest part.
    boardW = Math.max(boardW, Math.ceil(Math.max(...inputs.map(c => c.widthMm), 0) + edge * 2 + gap));
    boardH = Math.max(boardH, Math.ceil(Math.max(...inputs.map(c => c.heightMm), 0) + edge * 2 + gap));
  }

  // Normalise schematic coordinates into the usable board area.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of inputs) {
    minX = Math.min(minX, c.schematicX);
    maxX = Math.max(maxX, c.schematicX);
    minY = Math.min(minY, c.schematicY);
    maxY = Math.max(maxY, c.schematicY);
  }

  const pos = inputs.map((c, i) => {
    if (inputs.length === 1) return { x: boardW / 2, y: boardH / 2 };
    const usableW = Math.max(1, boardW - edge * 2 - c.widthMm);
    const usableH = Math.max(1, boardH - edge * 2 - c.heightMm);
    const normX = maxX > minX ? (c.schematicX - minX) / (maxX - minX) : 0.5;
    const normY = maxY > minY ? (c.schematicY - minY) / (maxY - minY) : 0.5;
    return {
      x: edge + c.widthMm / 2 + normX * usableW,
      y: edge + c.heightMm / 2 + normY * usableH + (i % 2) * 0.01,
    };
  });

  const ITERATIONS = 220;
  for (let iter = 0; iter < ITERATIONS; iter++) {
    let moved = false;
    for (let i = 0; i < inputs.length; i++) {
      for (let j = i + 1; j < inputs.length; j++) {
        const halfW = (inputs[i].widthMm + inputs[j].widthMm) / 2 + gap;
        const halfH = (inputs[i].heightMm + inputs[j].heightMm) / 2 + gap;
        const dx = pos[j].x - pos[i].x;
        const dy = pos[j].y - pos[i].y;
        const overlapX = halfW - Math.abs(dx);
        const overlapY = halfH - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;

        moved = true;
        // Separate along the axis needing the smaller correction.
        if (overlapX < overlapY) {
          const push = (overlapX / 2 + 0.01) * (dx < 0 ? -1 : 1);
          pos[i].x -= push;
          pos[j].x += push;
        } else {
          const push = (overlapY / 2 + 0.01) * (dy < 0 ? -1 : 1);
          pos[i].y -= push;
          pos[j].y += push;
        }
      }
    }
    for (let i = 0; i < inputs.length; i++) {
      const hw = inputs[i].widthMm / 2;
      const hh = inputs[i].heightMm / 2;
      pos[i].x = Math.min(boardW - edge - hw, Math.max(edge + hw, pos[i].x));
      pos[i].y = Math.min(boardH - edge - hh, Math.max(edge + hh, pos[i].y));
    }
    if (!moved) break;
  }

  // Crop to what the parts actually occupy. The relaxation spreads them across
  // the seed area, so without this the board would always come out at the seed
  // size however little copper it carries.
  if (autoSize && inputs.length > 0) {
    let minPX = Infinity, minPY = Infinity, maxPX = -Infinity, maxPY = -Infinity;
    for (let i = 0; i < inputs.length; i++) {
      minPX = Math.min(minPX, pos[i].x - inputs[i].widthMm / 2);
      maxPX = Math.max(maxPX, pos[i].x + inputs[i].widthMm / 2);
      minPY = Math.min(minPY, pos[i].y - inputs[i].heightMm / 2);
      maxPY = Math.max(maxPY, pos[i].y + inputs[i].heightMm / 2);
    }

    // Keep a routing channel around the outside of the parts, on top of the
    // edge margin, so perimeter traces still have somewhere to run.
    const margin = edge + gap;
    let shiftX = margin - minPX;
    let shiftY = margin - minPY;
    boardW = Math.ceil(maxPX - minPX + margin * 2);
    boardH = Math.ceil(maxPY - minPY + margin * 2);

    // The requested size is a floor, not a target. When it is the larger of the
    // two, centre the packed parts in it rather than leaving them in a corner.
    if (opts.boardWidthMm > boardW) {
      shiftX += (opts.boardWidthMm - boardW) / 2;
      boardW = opts.boardWidthMm;
    }
    if (opts.boardHeightMm > boardH) {
      shiftY += (opts.boardHeightMm - boardH) / 2;
      boardH = opts.boardHeightMm;
    }

    for (const p of pos) {
      p.x += shiftX;
      p.y += shiftY;
    }
  }

  const placed: PlacedComponent[] = inputs.map((c, i) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    x: pos[i].x,
    y: pos[i].y,
    rotationDeg: c.rotationDeg,
    footprint: c.footprint,
    widthMm: c.widthMm,
    heightMm: c.heightMm,
    data: c.data,
  }));

  // A fixed board that cannot physically hold the parts is worth saying plainly,
  // rather than letting it surface as a pile of routing failures.
  if (!autoSize) {
    const needW = Math.max(...inputs.map(c => c.widthMm), 0) + edge * 2;
    const needH = Math.max(...inputs.map(c => c.heightMm), 0) + edge * 2;
    if (boardW < needW || boardH < needH) {
      warnings.push(
        `Board is ${boardW} x ${boardH} mm but the largest part needs at least ` +
        `${Math.ceil(needW)} x ${Math.ceil(needH)} mm including edge clearance. ` +
        `Enlarge the board or turn auto-size on.`
      );
    }
  }

  // Report any collision the relaxation could not resolve.
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (
        Math.abs(a.x - b.x) < (a.widthMm + b.widthMm) / 2 - 0.01 &&
        Math.abs(a.y - b.y) < (a.heightMm + b.heightMm) / 2 - 0.01
      ) {
        warnings.push(
          `Footprints for ${a.name} and ${b.name} overlap — board is too small.`
        );
      }
    }
  }

  return { placed, boardWidthMm: boardW, boardHeightMm: boardH };
}

/**
 * Crops the board to the copper that actually got laid down, and shifts
 * everything into the cropped rectangle.
 *
 * Placement has to reserve routing channels it may not end up using: it sizes
 * the board from component courtyards plus a generous perimeter, before the
 * router has decided where a single trace goes. Once routing is done the real
 * extent of the board is known, and on a simple circuit that is far smaller
 * than what placement reserved — cutting the reserved size out of the stock
 * wastes both material and profiling time on blank laminate.
 *
 * Everything is mutated in board coordinates, so the caller's pads, traces,
 * cutouts and components all stay consistent with the returned size.
 *
 * The margin is not free space: the isolation ring runs outside the outermost
 * copper, and the profile kerf runs outside the board edge, so both get their
 * own allowance before `boardMarginMm` is added on top.
 */
function translateLayout(
  placed: PlacedComponent[],
  pads: PlacedPad[],
  traces: RoutedTrace[],
  cutouts: BoardCutout[],
  dx: number,
  dy: number
): void {
  for (const c of placed) { c.x += dx; c.y += dy; }
  for (const pad of pads) { pad.x += dx; pad.y += dy; }
  for (const co of cutouts) { co.x += dx; co.y += dy; }
  // Trace points may be shared with the router's own grid nodes, so replace
  // them rather than shifting in place.
  for (const t of traces) {
    t.points = t.points.map(pt => ({ ...pt, x: pt.x + dx, y: pt.y + dy }));
  }
}

/**
 * Distance from the program origin to the board's lower-left corner.
 *
 * The profile cut runs a tool radius *outside* the finished edge, so with the
 * board corner on X0Y0 the outline pass would be commanded to negative
 * coordinates — off the stock, into the clamps, and refused outright by a
 * machine with soft limits on. Insetting the board by exactly that radius puts
 * the outermost cut of the whole job on X0Y0, so work zero can be set to the
 * corner of the stock.
 */
export function boardOriginOffsetMm(opts: PcbOptions): number {
  return opts.profileToolDiaMm / 2;
}

function cropBoardToContent(
  placed: PlacedComponent[],
  pads: PlacedPad[],
  traces: RoutedTrace[],
  cutouts: BoardCutout[],
  opts: PcbOptions
): { boardWidthMm: number; boardHeightMm: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };

  const padMargin = Math.max(0, opts.padMarginMm ?? 0);
  const compById = new Map(placed.map(c => [c.id, c]));
  for (const pad of pads) {
    const comp = compById.get(pad.componentId);
    if (!comp) continue;
    for (const pt of padPolygon(pad, comp.rotationDeg, effectivePadMarginMm(comp.footprint, padMargin))) {
      grow(pt.x, pt.y);
    }
  }

  // The part body can overhang its own pads — a TO-220 tab, a relay case — and
  // it still has to sit on laminate.
  for (const c of placed) {
    grow(c.x - c.widthMm / 2, c.y - c.heightMm / 2);
    grow(c.x + c.widthMm / 2, c.y + c.heightMm / 2);
  }

  for (const t of traces) {
    const half = t.widthMm / 2;
    for (const pt of t.points) {
      grow(pt.x - half, pt.y - half);
      grow(pt.x + half, pt.y + half);
    }
  }

  for (const co of cutouts) {
    grow(co.x - co.widthMm / 2, co.y - co.heightMm / 2);
    grow(co.x + co.widthMm / 2, co.y + co.heightMm / 2);
  }

  if (!isFinite(minX)) return { boardWidthMm: opts.boardWidthMm, boardHeightMm: opts.boardHeightMm };


  // Room the toolpaths need outside the last piece of copper: the outermost
  // isolation pass is offset by a tool radius plus the stepovers, and that pass
  // is itself a tool-width wide.
  const isoDia = vBitWidthAtDepth(opts.vBitTipMm, opts.vBitAngleDeg, opts.isolationDepthZ);
  const passes = Math.max(1, Math.min(3, opts.isolationPasses));
  const isolationReach = isoDia + (passes - 1) * isoDia * 0.8;
  const margin =
    isolationReach +
    0.3 +
    Math.max(0, opts.copperFloodMm ?? 0) +
    Math.max(0, opts.boardMarginMm ?? 1.5);

  const origin = boardOriginOffsetMm(opts);
  let boardW = Math.ceil((maxX - minX + margin * 2) * 10) / 10;
  let boardH = Math.ceil((maxY - minY + margin * 2) * 10) / 10;
  let shiftX = origin + margin - minX;
  let shiftY = origin + margin - minY;

  // The requested size stays a floor; when it wins, the content is centred in
  // it rather than pinned to a corner.
  if (opts.boardWidthMm > boardW) {
    shiftX += (opts.boardWidthMm - boardW) / 2;
    boardW = opts.boardWidthMm;
  }
  if (opts.boardHeightMm > boardH) {
    shiftY += (opts.boardHeightMm - boardH) / 2;
    boardH = opts.boardHeightMm;
  }

  translateLayout(placed, pads, traces, cutouts, shiftX, shiftY);

  return { boardWidthMm: boardW, boardHeightMm: boardH };
}

/**
 * Grows every net's copper outward until it is one isolation channel away from
 * its neighbours, and no further than `maxFloodMm`.
 *
 * Why this is not one big offset per net: the gap between two nets belongs to
 * both of them. Offsetting net A first would let A take the whole gap and leave
 * B pinned at its nominal width, and which net won would depend on map order.
 * So the flood advances in equal steps with every net moving at once, each step
 * clipped against where the *other* nets stood when the step began — the two
 * sides of a gap therefore meet in the middle, wherever that middle happens to
 * be. It is a discrete distance transform, done in polygons.
 *
 * The keepout allows for a step of the neighbour's own growth on top of the
 * channel: within a step both sides move, so blocking at exactly the channel
 * width would let them close to a channel *minus* a step apart.
 *
 * Copper present on entry is never removed — a board whose nominal geometry is
 * already tighter than the tool can cut is a design-rule error to report, not
 * something to quietly shave.
 */
export function floodCopperByNet(
  copperByNet: Map<string, Poly[]>,
  opts: {
    /** Ceiling on outward growth, per side, in mm. */
    maxFloodMm: number;
    /** Width the isolation tool actually cuts, in mm. */
    channelMm: number;
    /** Extra clearance kept each side of that channel, in mm. */
    channelMarginMm?: number;
    /** Copper that must be kept clear but never grows: unassigned pads, cutouts. */
    blockers?: Poly[];
    /** Region copper is allowed to occupy, typically the board minus toolpath room. */
    bounds?: Poly[];
  }
): { copper: Map<string, Poly[]>; appliedMm: number } {
  const maxFlood = Math.max(0, opts.maxFloodMm);
  const netIds = [...copperByNet.keys()];
  if (maxFlood <= 0 || netIds.length === 0) {
    return { copper: copperByNet, appliedMm: 0 };
  }

  // Step count is a Clipper budget: every step offsets, clips and unions once
  // per net. A dense board gets coarser steps rather than a layout that takes
  // a minute to redraw — the step size is only the resolution at which the two
  // sides of a gap meet, so a coarse one costs a little copper, not safety.
  const budget = netIds.length > 40 ? 4 : netIds.length > 20 ? 6 : 8;
  const steps = Math.max(1, Math.min(budget, Math.round(maxFlood / 0.05)));
  const stepMm = maxFlood / steps;
  const keepClear =
    opts.channelMm + 2 * Math.max(0, opts.channelMarginMm ?? 0) + stepMm;

  // Blockers never move, so their keepout is offset once for the whole flood.
  const blockerKeepout =
    opts.blockers && opts.blockers.length > 0
      ? offsetPolys(unionPolys(opts.blockers), keepClear)
      : [];
  const bounds = opts.bounds && opts.bounds.length > 0 ? opts.bounds : null;
  const boundsBox = bounds ? polysBounds(bounds) : null;

  let cur = copperByNet;
  let applied = 0;
  // Growth is monotone — a neighbour's keepout only ever expands and the bounds
  // never move — so a net that failed to grow this step can never grow again.
  // Dropping it keeps the tail of a dense flood cheap.
  const live = new Set(netIds);

  for (let s = 0; s < steps && live.size > 0; s++) {
    // One keepout per net, rather than one union-of-everything-else per net:
    // offsetting each net's own copper once and letting the difference below
    // take all the pieces at once is the same geometry for a fraction of the
    // work.
    const keepout = new Map<string, Poly[]>();
    const keepoutBox = new Map<string, ReturnType<typeof polysBounds>>();
    for (const netId of netIds) {
      const ko = offsetPolys(cur.get(netId)!, keepClear);
      keepout.set(netId, ko);
      keepoutBox.set(netId, polysBounds(ko));
    }

    const next = new Map<string, Poly[]>(cur);
    let grewAny = false;
    for (const netId of netIds) {
      const own = cur.get(netId)!;
      if (!live.has(netId)) continue;

      let grown = offsetPolys(own, stepMm);
      const grownBox = polysBounds(grown);
      if (bounds && boundsBox) {
        // Clipping against the board is only needed once the net is close
        // enough to reach it.
        const box = grownBox;
        if (
          box.minX < boundsBox.minX ||
          box.minY < boundsBox.minY ||
          box.maxX > boundsBox.maxX ||
          box.maxY > boundsBox.maxY
        ) {
          grown = intersectPolys(grown, bounds);
        }
      }

      // Only the neighbours this net could actually reach this step matter, and
      // on any board bigger than a stamp that is a handful of them. Skipping
      // the rest keeps the clip small, which is where Clipper spends its time.
      const clip: Poly[] = [...blockerKeepout];
      for (const otherId of netIds) {
        if (otherId === netId) continue;
        const box = keepoutBox.get(otherId)!;
        if (
          box.minX > grownBox.maxX ||
          box.maxX < grownBox.minX ||
          box.minY > grownBox.maxY ||
          box.maxY < grownBox.minY
        ) {
          continue;
        }
        clip.push(...keepout.get(otherId)!);
      }
      if (clip.length > 0) grown = differencePolys(grown, clip);

      // Clipping can bite into copper that was already there on a board whose
      // nominal geometry is tighter than the channel. Never remove copper the
      // layout asked for; the DRC is what reports that case.
      grown = unionPolys([...grown, ...own]);

      if (totalArea(grown) > totalArea(own) + 1e-4) {
        grewAny = true;
        next.set(netId, grown);
      } else {
        live.delete(netId);
      }
    }
    cur = next;
    if (!grewAny) break;
    applied += stepMm;
  }

  return { copper: cur, appliedMm: parseFloat(applied.toFixed(3)) };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/** Progress from the routing stage, for hosts that run the layout off-thread. */
export interface LayoutProgress extends RouteProgress {
  /** Board-growth attempt this progress belongs to, 1-based. */
  attempt: number;
  totalAttempts: number;
}

export function generatePcbLayout(
  circuitNodes: Node[],
  circuitEdges: Edge[],
  userOptions?: Partial<PcbOptions>,
  onProgress?: (p: LayoutProgress) => void
): PcbLayoutResult {
  const options: PcbOptions = { ...DEFAULT_PCB_OPTIONS, ...userOptions };
  const warnings: string[] = [];
  const violations: DrcViolation[] = [];
  // Grown pad copper affects both the geometry and what the router treats as
  // occupied, so it is resolved once here and passed to both.
  const padMargin = Math.max(0, options.padMarginMm ?? 0);

  const nodes = circuitNodes || [];
  const edges = circuitEdges || [];

  const physicalNodes = nodes.filter(n => isPhysical(n.type));
  if (physicalNodes.length === 0) {
    return emptyResult(options, 'No placeable components in this circuit.');
  }

  // 1. Nets -------------------------------------------------------------
  const { nets, warnings: netWarnings } = extractNets(nodes, edges);
  warnings.push(...netWarnings);

  const inputs: PlacementInput[] = physicalNodes.map((node, idx) => {
    const data = (node.data ?? {}) as {
      orientation?: string;
      packageId?: string;
      pins?: number;
      label?: string;
      name?: string;
    };
    const orientation = data.orientation;
    const rotationDeg: 0 | 90 =
      orientation === 'vertical' || orientation === 'up' ? 90 : 0;
    const footprint = resolveFootprint(data.packageId, node.type, data.pins || 2, node.data);
    return {
      id: node.id || `comp_${idx}`,
      name: data.label || data.name || node.id || `C${idx + 1}`,
      type: node.type || 'unknown',
      schematicX: node.position?.x ?? 0,
      schematicY: node.position?.y ?? 0,
      rotationDeg,
      footprint,
      widthMm: rotationDeg === 90 ? footprint.heightMm : footprint.widthMm,
      heightMm: rotationDeg === 90 ? footprint.widthMm : footprint.heightMm,
      data: node.data,
    };
  });

  // 2-4. Place and route. An unroutable net is usually a space problem, so
  // retry on a progressively larger board and keep the best attempt.
  // The budget covers all three attempts together, so a bigger budget buys more
  // search rather than three times the wait.
  const ATTEMPTS = 3;
  const deadline = Date.now() + Math.max(0, options.routingBudgetMs);

  let best: LayoutAttempt | null = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    // Attempt 1 packs as tightly as the parts allow. Only if that cannot be
    // routed do later attempts trade board area for routing channels.
    const spreadScale = 1 + attempt * 0.4;
    const candidate = placeAndRoute(
      inputs,
      nets,
      options,
      Math.max(0, deadline - Date.now()),
      onProgress
        ? p => onProgress({ ...p, attempt: attempt + 1, totalAttempts: ATTEMPTS })
        : undefined,
      spreadScale
    );
    // A later attempt only wins if it routes strictly more; an equally complete
    // but larger board is a worse board.
    if (!best || candidate.routing.completion > best.routing.completion) {
      best = candidate;
    }
    if (best.routing.completion >= 1) break;
  }

  const { placed, pads, cutouts, routing } = best!;
  let { boardWidthMm, boardHeightMm } = best!;
  const compById = new Map(placed.map(c => [c.id, c]));
  violations.push(...best!.violations);
  warnings.push(...best!.warnings);

  // Placement had to reserve routing space before the router ran. Now that the
  // traces exist, crop the blank laminate back off the outside.
  const boardOriginMm = boardOriginOffsetMm(options);
  if (options.autoGrowBoard) {
    ({ boardWidthMm, boardHeightMm } =
      cropBoardToContent(placed, pads, routing.traces, cutouts, options));
  } else {
    // Fixed size: nothing to crop, but the board still has to sit clear of the
    // origin so the profile pass does not run negative.
    translateLayout(placed, pads, routing.traces, cutouts, boardOriginMm, boardOriginMm);
  }

  if (
    options.autoGrowBoard &&
    (boardWidthMm !== options.boardWidthMm || boardHeightMm !== options.boardHeightMm)
  ) {
    warnings.push(
      `Board auto-sized to ${boardWidthMm} x ${boardHeightMm} mm for ${inputs.length} parts ` +
      `(requested ${options.boardWidthMm} x ${options.boardHeightMm} mm).`
    );
  }

  const traces: TraceSegment[] = routing.traces.map((t: RoutedTrace) => ({
    netId: t.netId,
    points: t.points,
    width: t.widthMm,
  }));

  for (const u of routing.unrouted) {
    violations.push({
      severity: 'error',
      message:
        `Net ${u.netId}: could not route ${u.from} to ${u.to} — ${u.reason}. ` +
        `A single-layer board may need a wire jumper here.`,
    });
  }

  // 5. Copper geometry per net -----------------------------------------
  // The channel the bit cuts is needed before the copper is final: it is what
  // the flood below leaves between nets.
  const effectiveToolDiaMm = vBitWidthAtDepth(
    options.vBitTipMm,
    options.vBitAngleDeg,
    options.isolationDepthZ
  );
  let copperByNet = new Map<string, Poly[]>();
  const addCopper = (netId: string, polys: Poly[]) => {
    copperByNet.set(netId, (copperByNet.get(netId) || []).concat(polys));
  };

  for (const pad of pads) {
    if (!pad.netId) continue;
    const comp = compById.get(pad.componentId)!;
    addCopper(pad.netId, [
      padPolygon(pad, comp.rotationDeg, effectivePadMarginMm(comp.footprint, padMargin)),
    ]);
  }
  for (const trace of traces) {
    addCopper(trace.netId, strokeToPoly(trace.points, trace.width));
  }
  for (const [netId, polys] of copperByNet) {
    copperByNet.set(netId, unionPolys(polys));
  }

  // 5b. Copper flood ----------------------------------------------------
  // Everything outside the nominal trace is about to be milled away, so any gap
  // wider than the bit's channel is copper thrown out for nothing. Grow it back.
  const floodBudgetMm = Math.max(0, options.copperFloodMm ?? 0);
  let appliedFloodMm = 0;
  if (floodBudgetMm > 0 && copperByNet.size > 0) {
    // A pad with no net is never isolated, so it is not copper to grow — but
    // flooding across one would bury a hole that still has to be soldered.
    const blockers: Poly[] = [];
    for (const pad of pads) {
      if (pad.netId) continue;
      const comp = compById.get(pad.componentId);
      if (!comp) continue;
      blockers.push(
        padPolygon(pad, comp.rotationDeg, effectivePadMarginMm(comp.footprint, padMargin))
      );
    }
    // Copper over a cutout would be milled off with the slug it sits on.
    for (const co of cutouts) {
      blockers.push(
        co.shape === 'circle'
          ? circlePoly(co.x, co.y, Math.max(co.widthMm, co.heightMm) / 2)
          : rectPoly(co.x, co.y, co.widthMm, co.heightMm)
      );
    }

    // Copper may not run out past the room the isolation passes need inside the
    // board edge, or the outermost ring would be commanded off the stock.
    const floodPasses = Math.max(1, Math.min(3, options.isolationPasses));
    const edgeKeepout =
      effectiveToolDiaMm + (floodPasses - 1) * effectiveToolDiaMm * 0.8 + 0.2;
    const bounds = [
      rectPoly(
        boardOriginMm + boardWidthMm / 2,
        boardOriginMm + boardHeightMm / 2,
        Math.max(0.1, boardWidthMm - edgeKeepout * 2),
        Math.max(0.1, boardHeightMm - edgeKeepout * 2)
      ),
    ];

    const flooded = floodCopperByNet(copperByNet, {
      maxFloodMm: floodBudgetMm,
      channelMm: effectiveToolDiaMm,
      channelMarginMm: Math.max(0, options.channelMarginMm ?? 0.05),
      blockers,
      bounds,
    });
    copperByNet = flooded.copper;
    appliedFloodMm = flooded.appliedMm;
  }

  // 6. Design rule check: no two nets' copper may touch.
  const netIdList = [...copperByNet.keys()];
  for (let i = 0; i < netIdList.length; i++) {
    for (let j = i + 1; j < netIdList.length; j++) {
      if (polysOverlap(copperByNet.get(netIdList[i])!, copperByNet.get(netIdList[j])!, 1e-5)) {
        violations.push({
          severity: 'error',
          message: `Short circuit: copper for ${netIdList[i]} touches ${netIdList[j]}.`,
        });
      }
    }
  }

  // 7. Isolation toolpaths ---------------------------------------------
  const toolRadius = effectiveToolDiaMm / 2;

  if (effectiveToolDiaMm >= options.clearanceMm) {
    violations.push({
      severity: 'warning',
      message:
        `V-bit cuts ${effectiveToolDiaMm.toFixed(3)}mm wide at Z${options.isolationDepthZ}, ` +
        `wider than the ${options.clearanceMm}mm clearance. Reduce isolation depth ` +
        `or increase clearance.`,
    });
  }

  // A part's own pad-to-pad gap can be far tighter than the board-wide
  // clearance setting — a 0.5mm-pitch QFN leaves about 0.25mm between pads.
  // Checking only the global figure would pass a board the tool cannot cut.
  const requestedPadMargin = Math.max(0, options.padMarginMm ?? 0);
  for (const comp of placed) {
    const padMarginForCheck = effectivePadMarginMm(comp.footprint, requestedPadMargin);
    if (comp.footprint.isFallback) {
      violations.push({
        severity: 'error',
        message:
          `${comp.name}: package "${comp.footprint.requestedPackageId}" is not in the footprint ` +
          `library. A ${comp.footprint.packageId} was substituted — its pads and drills are ` +
          `almost certainly wrong. Pick a known package or define custom footprint parameters.`,
      });
    }

    const checkPads = comp.footprint.pads.map(p => ({
      x: p.x,
      y: p.y,
      // Isolation runs around the grown copper, not the nominal pad.
      padWidth: p.padWidth + padMarginForCheck * 2,
      padHeight: p.padHeight + padMarginForCheck * 2,
      pinNumber: p.pinNumber,
    }));
    const gap = minPadGapMm(checkPads);
    if (gap === Infinity) continue;

    if (gap <= 0) {
      violations.push({
        severity: 'error',
        message:
          `${comp.name} (${comp.footprint.packageId}): pads on different pins overlap. ` +
          `No tool can isolate them.`,
      });
    } else if (gap < effectiveToolDiaMm) {
      violations.push({
        severity: 'error',
        message:
          `${comp.name} (${comp.footprint.packageId}): pads are ${gap.toFixed(3)}mm apart but the ` +
          `bit cuts ${effectiveToolDiaMm.toFixed(3)}mm wide at Z${options.isolationDepthZ}. ` +
          `Use a sharper V-bit, cut shallower, or reduce the pad margin.`,
      });
    } else if (gap < effectiveToolDiaMm * 1.3) {
      violations.push({
        severity: 'warning',
        message:
          `${comp.name} (${comp.footprint.packageId}): only ${gap.toFixed(3)}mm between pads for a ` +
          `${effectiveToolDiaMm.toFixed(3)}mm cut. This will work only on a well-levelled board — ` +
          `run the height map first.`,
      });
    }
  }

  const isolationPaths: IsolationPath[] = [];
  const stepover = effectiveToolDiaMm * 0.8;
  const passes = Math.max(1, Math.min(3, options.isolationPasses));

  for (const [netId, copper] of copperByNet) {
    // Copper belonging to every other net, grown by a tool radius. The cutter
    // centre may never enter this region or it would bite into a live trace.
    const others: Poly[] = [];
    for (const [otherId, otherCopper] of copperByNet) {
      if (otherId !== netId) others.push(...otherCopper);
    }
    const forbidden = others.length > 0 ? offsetPolys(unionPolys(others), toolRadius) : [];

    for (let pass = 0; pass < passes; pass++) {
      const loop = offsetPolys(copper, toolRadius + pass * stepover);
      const safe = forbidden.length > 0 ? differencePolys(loop, forbidden) : loop;
      for (const ring of safe) {
        if (ring.length < 3) continue;
        isolationPaths.push({ netId, pass, points: [...ring, ring[0]] });
      }
    }
  }

  // 8. Drills -----------------------------------------------------------
  const drills: DrillPoint[] = [];
  for (const pad of pads) {
    if (pad.spec.drillDiameter > 0) {
      drills.push({
        x: pad.x,
        y: pad.y,
        diameter: pad.spec.drillDiameter,
        componentId: pad.componentId,
        pinNumber: pad.spec.pinNumber,
      });
    }
  }

  const sortedIsolationPaths = sortPathsNearestNeighbor(isolationPaths);

  const result: PcbLayoutResult = {
    success: violations.filter(v => v.severity === 'error').length === 0,
    boardWidthMm,
    boardHeightMm,
    boardOriginMm,
    components: placed,
    pads,
    nets,
    traces,
    isolationPaths: sortedIsolationPaths,
    drills,
    cutouts,
    unrouted: routing.unrouted,
    violations,
    warnings,
    completion: routing.completion,
    effectiveToolDiaMm,
    copperFloodMm: appliedFloodMm,
    cycleTimeSec: 0,
    travelDistanceMm: 0,
    cutDistanceMm: 0,
    svg: '',
    gcode: '',
  };

  result.svg = renderPcbSvg(result, copperByNet, options);
  result.gcode = generatePcbGcode(result, options);
  const metrics = estimatePcbMachiningMetrics(result.gcode, options);
  result.cycleTimeSec = metrics.cycleTimeSec;
  result.travelDistanceMm = metrics.travelDistanceMm;
  result.cutDistanceMm = metrics.cutDistanceMm;
  return result;
}

interface LayoutAttempt {
  placed: PlacedComponent[];
  boardWidthMm: number;
  boardHeightMm: number;
  pads: PlacedPad[];
  cutouts: BoardCutout[];
  routing: ReturnType<typeof routeBoard>;
  violations: DrcViolation[];
  warnings: string[];
}

/**
 * One placement + routing attempt at a given board size. Pure with respect to
 * the caller, so attempts at different board sizes can be compared and the
 * losing ones discarded without leaking warnings into the result.
 */
function placeAndRoute(
  inputs: PlacementInput[],
  nets: PcbNet[],
  opts: PcbOptions,
  budgetMs?: number,
  onProgress?: (p: RouteProgress) => void,
  spreadScale = 1
): LayoutAttempt {
  const violations: DrcViolation[] = [];
  const warnings: string[] = [];
  // Grown pad copper has to reach the router too, or a trace gets planned
  // through the annulus the margin just added.
  const padMargin = Math.max(0, opts.padMarginMm ?? 0);

  const { placed, boardWidthMm, boardHeightMm } =
    placeComponents(inputs, opts, warnings, spreadScale);
  const compById = new Map(placed.map(c => [c.id, c]));

  // Pads, each bound to its net via the handle -> pin mapping.
  const pads: PlacedPad[] = [];
  const padByPort = new Map<string, PlacedPad>();

  for (const comp of placed) {
    for (const spec of comp.footprint.pads) {
      const { dx, dy } = padOffset(spec, comp.rotationDeg);
      pads.push({
        componentId: comp.id,
        handleId: '',
        pinNumber: spec.pinNumber,
        netId: null,
        x: comp.x + dx,
        y: comp.y + dy,
        spec,
      });
    }
  }

  for (const net of nets) {
    for (const port of net.ports) {
      const comp = compById.get(port.nodeId);
      if (!comp) continue;
      const mapping = resolveHandleToPin(comp.type, port.handleId, comp.footprint, comp.data);
      if (!mapping) {
        violations.push({
          severity: 'error',
          message:
            `Cannot map pin '${port.handleId}' of ${comp.name} (${comp.type}) onto ` +
            `footprint ${comp.footprint.packageId} — connection dropped.`,
        });
        continue;
      }
      const pad = pads.find(
        p => p.componentId === comp.id && p.pinNumber === mapping.pinNumber
      );
      if (!pad) continue;
      if (pad.netId && pad.netId !== net.id) {
        violations.push({
          severity: 'error',
          message:
            `Pad ${comp.name}.${mapping.pinNumber} is claimed by both ${pad.netId} ` +
            `and ${net.id}.`,
        });
        continue;
      }
      pad.netId = net.id;
      pad.handleId = port.handleId;
      padByPort.set(port.key, pad);
    }
  }

  // Routing.
  const routePins: RoutePin[] = [];
  for (const net of nets) {
    for (const port of net.ports) {
      const pad = padByPort.get(port.key);
      if (!pad) continue;
      const comp = compById.get(pad.componentId)!;
      const { w, h } = padOffset(pad.spec, comp.rotationDeg);
      routePins.push({
        netId: net.id,
        key: port.key,
        componentId: pad.componentId,
        x: pad.x,
        y: pad.y,
        padRadiusMm:
          Math.max(w, h) / 2 + effectivePadMarginMm(comp.footprint, padMargin),
      });
    }
  }

  // Every pad that ended up on no net is still physical copper or a drilled
  // hole, so the router has to keep clear of it.
  const obstacles: RouteObstacle[] = pads
    .filter(p => !p.netId)
    .map(p => {
      const comp = compById.get(p.componentId)!;
      const { w, h } = padOffset(p.spec, comp.rotationDeg);
      // Same margin the copper is grown by, or the router would happily run a
      // trace through the annulus this pad just gained.
      return {
        x: p.x,
        y: p.y,
        radiusMm: Math.max(w, h) / 2 + effectivePadMarginMm(comp.footprint, padMargin),
      };
    });

  // Cutouts have no pads at all — they are pure keepout, and are milled by the
  // profile tool rather than the isolation tool.
  const cutouts: BoardCutout[] = [];
  for (const comp of placed) {
    if (comp.type !== 'cutout') continue;
    const shape = comp.data?.cutoutShape === 'circle' ? 'circle' : 'rect';
    cutouts.push({
      componentId: comp.id,
      shape,
      x: comp.x,
      y: comp.y,
      widthMm: comp.widthMm,
      heightMm: comp.heightMm,
    });
    if (shape === 'circle') {
      obstacles.push({ x: comp.x, y: comp.y, radiusMm: Math.max(comp.widthMm, comp.heightMm) / 2 });
    } else {
      obstacles.push({ x: comp.x, y: comp.y, widthMm: comp.widthMm, heightMm: comp.heightMm });
    }
  }

  const routing = routeBoard(routePins, {
    obstacles,
    boardWidthMm,
    boardHeightMm,
    gridMm: opts.routingGridMm,
    traceWidthMm: opts.traceWidthMm,
    clearanceMm: opts.clearanceMm,
    edgeClearanceMm: Math.max(1.0, opts.profileToolDiaMm),
    bendPenalty: 1.5,
    budgetMs,
    onProgress,
  });

  return { placed, boardWidthMm, boardHeightMm, pads, cutouts, routing, violations, warnings };
}

/** A well-formed but empty layout, used for errors and as a placeholder. */
export function emptyPcbLayout(
  userOptions?: Partial<PcbOptions>,
  error = 'No layout yet.'
): PcbLayoutResult {
  return emptyResult({ ...DEFAULT_PCB_OPTIONS, ...userOptions }, error);
}

function emptyResult(options: PcbOptions, error: string): PcbLayoutResult {
  return {
    success: false,
    boardWidthMm: options.boardWidthMm,
    boardHeightMm: options.boardHeightMm,
    boardOriginMm: boardOriginOffsetMm(options),
    components: [],
    pads: [],
    nets: [],
    traces: [],
    isolationPaths: [],
    drills: [],
    cutouts: [],
    unrouted: [],
    violations: [{ severity: 'error', message: error }],
    warnings: [],
    completion: 0,
    effectiveToolDiaMm: 0,
    copperFloodMm: 0,
    cycleTimeSec: 0,
    travelDistanceMm: 0,
    cutDistanceMm: 0,
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${options.boardWidthMm} ` +
      `${options.boardHeightMm}" width="100%" height="100%"></svg>`,
    gcode: `; ${error}\n`,
    error,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const NET_COLORS = [
  '#d4af37', '#4fc3f7', '#ba68c8', '#ff8a65',
  '#81c784', '#f06292', '#9575cd', '#4db6ac',
];

export function renderPcbSvg(
  result: PcbLayoutResult,
  copperByNet: Map<string, Poly[]>,
  options: PcbOptions
): string {
  const w = result.boardWidthMm;
  const h = result.boardHeightMm;
  const colorFor = (netId: string) => {
    if (netId === 'GND') return '#8d6e63';
    const idx = result.nets.findIndex(n => n.id === netId);
    return NET_COLORS[(idx < 0 ? 0 : idx) % NET_COLORS.length];
  };

  // Everything in the result is in program coordinates, where the board is
  // inset from the origin so the profile pass starts on X0Y0. The view has to
  // start at the origin too, or the outline falls outside it.
  const o = result.boardOriginMm;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w + o * 2} ${h + o * 2}" width="100%" height="100%">\n`;
  svg += `  <rect x="${o}" y="${o}" width="${w}" height="${h}" fill="#1b4d2e" stroke="#2e7d42" stroke-width="0.4" rx="1.5" />\n`;

  // Copper, per net, with holes honoured.
  for (const [netId, polys] of copperByNet) {
    const d = polysToSvgPath(polys);
    if (!d) continue;
    svg += `  <path d="${d}" fill="${colorFor(netId)}" fill-rule="evenodd" opacity="0.95" />\n`;
  }

  // Isolation toolpaths.
  for (const path of result.isolationPaths) {
    const pts = path.points.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ');
    svg += `  <polyline points="${pts}" fill="none" stroke="#ff5252" stroke-width="0.08" stroke-dasharray="0.5,0.35" opacity="0.85" />\n`;
  }

  // Drill holes.
  for (const d of result.drills) {
    svg += `  <circle cx="${d.x.toFixed(3)}" cy="${d.y.toFixed(3)}" r="${(d.diameter / 2).toFixed(3)}" fill="#0d0d0d" />\n`;
  }

  // Courtyards and reference designators.
  for (const comp of result.components) {
    const hw = comp.widthMm / 2;
    const hh = comp.heightMm / 2;
    svg += `  <rect x="${(comp.x - hw).toFixed(3)}" y="${(comp.y - hh).toFixed(3)}" width="${comp.widthMm.toFixed(3)}" height="${comp.heightMm.toFixed(3)}" fill="none" stroke="#ffffff" stroke-width="0.15" opacity="0.55" rx="0.4" />\n`;
    const label = String(comp.name).replace(/[<>&]/g, '');
    svg += `  <text x="${comp.x.toFixed(3)}" y="${(comp.y - hh - 0.4).toFixed(3)}" fill="#ffffff" font-size="1.4" font-family="monospace" text-anchor="middle">${label}</text>\n`;
  }

  // Cutouts: milled clean through, so show them as holes in the substrate.
  for (const cut of result.cutouts) {
    if (cut.shape === 'circle') {
      svg += `  <circle cx="${cut.x}" cy="${cut.y}" r="${Math.max(cut.widthMm, cut.heightMm) / 2}" ` +
        `fill="#0b0f14" stroke="#ef5350" stroke-width="0.15" stroke-dasharray="0.8,0.5" />\n`;
    } else {
      svg += `  <rect x="${cut.x - cut.widthMm / 2}" y="${cut.y - cut.heightMm / 2}" ` +
        `width="${cut.widthMm}" height="${cut.heightMm}" ` +
        `fill="#0b0f14" stroke="#ef5350" stroke-width="0.15" stroke-dasharray="0.8,0.5" />\n`;
    }
  }

  // Profile cut path (tool centreline).
  const profR = options.profileToolDiaMm / 2;
  svg += `  <rect x="${o - profR}" y="${o - profR}" width="${w + options.profileToolDiaMm}" height="${h + options.profileToolDiaMm}" fill="none" stroke="#64b5f6" stroke-width="0.1" stroke-dasharray="1,0.6" opacity="0.7" />\n`;

  svg += `</svg>`;
  return svg;
}

// ---------------------------------------------------------------------------
// G-code & Traversal Optimization
// ---------------------------------------------------------------------------

const f3 = (n: number) => n.toFixed(3);

/**
 * Transforms a PCB G-code program into an Air Cut dry run program by shifting
 * all Z-axis plunge and cutting moves upward by `zOffsetMm` (default +20mm).
 *
 * Tool changes and the spindle are stripped out. A dry run exists to watch the
 * whole program trace out in the air, and the board profile is the *last*
 * operation — behind every drill-bit change. Leaving the `M6` pauses in meant
 * the run stopped several times before it ever reached the outline, so the one
 * pass most worth previewing was the one nobody ever saw. Nothing is being cut,
 * so there is no bit to change and no reason to spin the spindle up either.
 */
export function generateAirCutGcode(gcode: string, zOffsetMm = 20): string {
  if (!gcode) return gcode;
  const lines = gcode.split('\n');
  const transformed = lines.map((line) => {
    const semiIdx = line.indexOf(';');
    const codePart = semiIdx !== -1 ? line.slice(0, semiIdx) : line;
    const commentPart = semiIdx !== -1 ? line.slice(semiIdx) : '';

    // A tool change line is dropped to a bare comment: the run must not pause,
    // but the operator still wants to see where the change would have been.
    if (/\bM0?6\b/.test(codePart) || /^\s*T\d+\s*$/.test(codePart)) {
      return `; [air cut] tool change skipped:${codePart.trim() ? ' ' + codePart.trim() : ''}${commentPart}`;
    }
    // M3/M4 start the spindle; M0 is an unconditional stop. Neither belongs in
    // a dry run, and a spinning cutter 20mm above the stock is just a hazard.
    if (/\bM[34]\b/.test(codePart) || /\bM0{1,2}\b/.test(codePart)) {
      return `; [air cut] skipped: ${codePart.trim()}${commentPart}`;
    }

    const transformedCode = codePart.replace(/\bZ(-?\d+(?:\.\d+)?)\b/gi, (_, zVal) => {
      const z = parseFloat(zVal);
      const newZ = z + zOffsetMm;
      return `Z${newZ.toFixed(3)}`;
    });

    return transformedCode + commentPart;
  });

  return `; --- AIR CUT DRY RUN PROGRAM (+${zOffsetMm}mm Z-Offset) ---\n` + transformed.join('\n');
}

/**
 * Sorts isolation paths using a greedy nearest-neighbor algorithm to minimize rapid travel distances.
 */
export function sortPathsNearestNeighbor(paths: IsolationPath[]): IsolationPath[] {
  if (paths.length <= 1) return paths;

  const remaining = [...paths];
  const sorted: IsolationPath[] = [];

  let currentPt: Pt = { x: 0, y: 0 };

  while (remaining.length > 0) {
    let bestIdx = -1;
    let bestDist = Infinity;
    let reverseBest = false;

    for (let i = 0; i < remaining.length; i++) {
      const path = remaining[i];
      if (!path.points || path.points.length === 0) continue;
      const startPt = path.points[0];
      const endPt = path.points[path.points.length - 1];

      const dStart = Math.hypot(startPt.x - currentPt.x, startPt.y - currentPt.y);
      const dEnd = Math.hypot(endPt.x - currentPt.x, endPt.y - currentPt.y);

      if (dStart < bestDist) {
        bestDist = dStart;
        bestIdx = i;
        reverseBest = false;
      }
      if (dEnd < bestDist) {
        bestDist = dEnd;
        bestIdx = i;
        reverseBest = true;
      }
    }

    if (bestIdx < 0) break;

    const chosen = remaining.splice(bestIdx, 1)[0];
    if (reverseBest) {
      chosen.points = [...chosen.points].reverse();
    }
    sorted.push(chosen);
    currentPt = chosen.points[chosen.points.length - 1];
  }

  return sorted;
}

export interface PcbMachiningMetrics {
  cycleTimeSec: number;
  travelDistanceMm: number;
  cutDistanceMm: number;
}

/**
 * Estimates total machining cycle time, rapid travel distance, and cut distance.
 */
export function estimatePcbMachiningMetrics(
  gcode: string,
  options: PcbOptions
): PcbMachiningMetrics {
  const lines = gcode.split('\n');
  let travelDistance = 0;
  let cutDistance = 0;
  let totalTimeSec = 0;

  let curX = 0, curY = 0, curZ = options.safeZ;
  let curFeed = options.cutFeedrate;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('(')) continue;

    const parts = trimmed.toUpperCase().split(/\s+/);
    const cmd = parts[0];

    let targetX = curX;
    let targetY = curY;
    let targetZ = curZ;

    for (const p of parts.slice(1)) {
      if (p.startsWith('X')) targetX = parseFloat(p.slice(1)) || targetX;
      if (p.startsWith('Y')) targetY = parseFloat(p.slice(1)) || targetY;
      if (p.startsWith('Z')) targetZ = parseFloat(p.slice(1)) || targetZ;
      if (p.startsWith('F')) curFeed = parseFloat(p.slice(1)) || curFeed;
    }

    const dist = Math.hypot(targetX - curX, targetY - curY, targetZ - curZ);
    if (dist > 0.0001) {
      if (cmd === 'G0') {
        travelDistance += dist;
        totalTimeSec += (dist / (options.travelFeedrate || 1500)) * 60;
      } else if (cmd === 'G1') {
        cutDistance += dist;
        totalTimeSec += (dist / (curFeed || options.cutFeedrate || 300)) * 60;
      }
    }

    if (cmd === 'G4') {
      const pMatch = /P(\d+(?:\.\d+)?)/.exec(trimmed.toUpperCase());
      if (pMatch) totalTimeSec += parseFloat(pMatch[1]);
    }

    curX = targetX;
    curY = targetY;
    curZ = targetZ;
  }

  return {
    cycleTimeSec: Math.round(totalTimeSec),
    travelDistanceMm: parseFloat(travelDistance.toFixed(1)),
    cutDistanceMm: parseFloat(cutDistance.toFixed(1)),
  };
}

/**
 * Tool-centre contour for a cutout, offset *inward* by the tool radius since
 * the material being removed is on the inside. Returns null when the cutout is
 * too small for the tool to fit.
 */
function cutoutToolpath(cut: BoardCutout, options: PcbOptions): Pt[] | null {
  const r = options.profileToolDiaMm / 2;

  if (cut.shape === 'circle') {
    const radius = Math.max(cut.widthMm, cut.heightMm) / 2 - r;
    if (radius <= 0.05) return null;
    const steps = Math.max(24, Math.ceil((2 * Math.PI * radius) / 0.4));
    const pts: Pt[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      pts.push({ x: cut.x + radius * Math.cos(a), y: cut.y + radius * Math.sin(a) });
    }
    return pts;
  }

  const hw = cut.widthMm / 2 - r;
  const hh = cut.heightMm / 2 - r;
  if (hw <= 0.05 || hh <= 0.05) return null;
  return [
    { x: cut.x - hw, y: cut.y - hh },
    { x: cut.x + hw, y: cut.y - hh },
    { x: cut.x + hw, y: cut.y + hh },
    { x: cut.x - hw, y: cut.y + hh },
    { x: cut.x - hw, y: cut.y - hh },
  ];
}

/** Profile cut path, offset outward by the tool radius, with holding tabs. */
function profileToolpath(
  result: PcbLayoutResult,
  options: PcbOptions
): { corners: Pt[]; tabs: { start: number; end: number }[] } {
  const r = options.profileToolDiaMm / 2;
  const o = result.boardOriginMm;
  const w = result.boardWidthMm;
  const h = result.boardHeightMm;
  // Tool centre runs a radius outside the finished board edge, so the board
  // comes out at its nominal size instead of undersize by a tool diameter.
  // The board is inset from the origin by exactly that radius, so this pass —
  // the outermost cut in the job — starts on X0Y0 rather than negative.
  const corners: Pt[] = [
    { x: o - r, y: o - r },
    { x: o + w + r, y: o - r },
    { x: o + w + r, y: o + h + r },
    { x: o - r, y: o + h + r },
    { x: o - r, y: o - r },
  ];

  const tabs: { start: number; end: number }[] = [];
  if (options.tabCount > 0 && options.tabWidthMm > 0) {
    let perim = 0;
    for (let i = 0; i + 1 < corners.length; i++) {
      perim += Math.hypot(corners[i + 1].x - corners[i].x, corners[i + 1].y - corners[i].y);
    }
    for (let i = 0; i < options.tabCount; i++) {
      const centre = ((i + 0.5) / options.tabCount) * perim;
      tabs.push({
        start: centre - options.tabWidthMm / 2,
        end: centre + options.tabWidthMm / 2,
      });
    }
  }
  return { corners, tabs };
}

export function generatePcbGcode(result: PcbLayoutResult, options: PcbOptions): string {
  const g: string[] = [];
  const errors = result.violations.filter(v => v.severity === 'error');

  g.push(`; --------------------------------------------------`);
  g.push(`; PCB Isolation Milling — generated by Circuit Expt`);
  g.push(`; Board:      ${result.boardWidthMm} x ${result.boardHeightMm} mm`);
  g.push(`; Nets:       ${result.nets.length}`);
  g.push(`; Traces:     ${result.traces.length}`);
  g.push(`; Drills:     ${result.drills.length}`);
  if (result.cutouts.length > 0) {
    g.push(`; Cutouts:    ${result.cutouts.length}`);
  }
  g.push(`; Trace/clr:  ${options.traceWidthMm}mm / ${options.clearanceMm}mm`);
  g.push(`; V-bit cuts: ${result.effectiveToolDiaMm.toFixed(3)}mm wide at Z${options.isolationDepthZ}`);
  if (result.copperFloodMm > 0) {
    g.push(
      `; Copper:     flooded up to ${result.copperFloodMm.toFixed(2)}mm per side past nominal ` +
      `(a ${options.traceWidthMm}mm trace in open laminate ends up ` +
      `${(options.traceWidthMm + result.copperFloodMm * 2).toFixed(2)}mm wide)`
    );
  }
  g.push(`; Routed:     ${(result.completion * 100).toFixed(1)}%`);
  for (const v of result.violations) {
    g.push(`; ${v.severity.toUpperCase()}: ${v.message}`);
  }
  g.push(`; --------------------------------------------------`);

  if (errors.length > 0) {
    g.push(`;`);
    g.push(`; !! ${errors.length} design rule error(s). No motion emitted.`);
    g.push(`; !! Fix the errors above before milling this board.`);
    g.push(`M30`);
    return g.join('\n');
  }

  g.push(`G90 G21 ; Absolute positioning, millimetres`);
  g.push(`G17 ; XY plane`);
  g.push(`G0 Z${f3(options.safeZ)}`);
  g.push(`M3 S${options.spindleRpm} ; Spindle on`);
  g.push(`G4 P2 ; Dwell for spin-up`);

  // --- Operation 1: isolation ---
  g.push(``);
  g.push(`; ==================================================`);
  g.push(`; OP 1/3: Isolation routing (${options.vBitAngleDeg}deg V-bit, ${options.vBitTipMm}mm tip)`);
  g.push(`; ==================================================`);
  if (options.pauseOnToolChange) g.push(`T1 M6 ; Tool 1: V-bit`);

  let lastNet = '';
  for (const path of result.isolationPaths) {
    if (path.points.length < 2) continue;
    if (path.netId !== lastNet) {
      g.push(`; --- net ${path.netId} ---`);
      lastNet = path.netId;
    }
    const p0 = path.points[0];
    const p1 = path.points[1];
    g.push(`G0 Z${f3(options.safeZ)}`);
    g.push(`G0 X${f3(p0.x)} Y${f3(p0.y)}`);

    const segLen = p1 ? Math.hypot(p1.x - p0.x, p1.y - p0.y) : 0;
    if (options.rampedPlunge !== false && p1 && segLen > 0.4) {
      const rampLen = Math.min(1.2, segLen * 0.8);
      const t = rampLen / segLen;
      const rx = p0.x + (p1.x - p0.x) * t;
      const ry = p0.y + (p1.y - p0.y) * t;
      g.push(`G1 X${f3(rx)} Y${f3(ry)} Z${f3(options.isolationDepthZ)} F${options.plungeFeedrate}`);
      g.push(`G1 X${f3(p1.x)} Y${f3(p1.y)} Z${f3(options.isolationDepthZ)} F${options.cutFeedrate}`);
      for (let i = 2; i < path.points.length; i++) {
        g.push(`G1 X${f3(path.points[i].x)} Y${f3(path.points[i].y)} F${options.cutFeedrate}`);
      }
    } else {
      g.push(`G1 Z${f3(options.isolationDepthZ)} F${options.plungeFeedrate}`);
      for (let i = 1; i < path.points.length; i++) {
        g.push(`G1 X${f3(path.points[i].x)} Y${f3(path.points[i].y)} F${options.cutFeedrate}`);
      }
    }
  }
  g.push(`G0 Z${f3(options.safeZ)}`);

  // --- Operation 2: drilling ---
  if (result.drills.length > 0) {
    g.push(``);
    g.push(`; ==================================================`);
    g.push(`; OP 2/3: Through-hole drilling (${result.drills.length} holes)`);
    g.push(`; ==================================================`);

    const groups = groupDrillsByBit(
      result.drills,
      options.drillConsolidationMm ?? 0,
      options.drillBitOverridesMm
    );

    let toolNum = 2;
    // Groups arrive ordered by bit, so a bit serving several hole sizes is
    // loaded once rather than swapped out and back in between them.
    let loadedBitMm: number | null = null;
    for (const { bitMm, holeMm, nominals, holes } of groups) {
      const merged =
        nominals.length > 1 ? ` (covers ${nominals.map(n => `${n}mm`).join(', ')})` : '';
      const interpolated = bitMm < holeMm - 0.01;
      g.push(
        `; --- ${holes.length} hole(s) at ${holeMm}mm${merged}, ` +
        `${interpolated ? `interpolated with a ${bitMm}mm bit` : `drilled with a ${bitMm}mm bit`} ---`
      );
      if (options.pauseOnToolChange && bitMm !== loadedBitMm) {
        g.push(`T${toolNum} M6 ; Tool ${toolNum}: ${bitMm}mm drill`);
        g.push(`G4 P1`);
        toolNum++;
      }
      loadedBitMm = bitMm;

      const depth = options.drillDepthZ;

      if (interpolated) {
        const path = helicalHoleToolpath(holeMm, bitMm, depth, options.zStepdown);
        for (const hole of holes) {
          g.push(`; ${hole.componentId} pin ${hole.pinNumber}`);
          g.push(`G0 X${f3(hole.x + path[0].x)} Y${f3(hole.y + path[0].y)}`);
          g.push(`G1 Z0 F${options.plungeFeedrate}`);
          for (const pt of path) {
            g.push(
              `G1 X${f3(hole.x + pt.x)} Y${f3(hole.y + pt.y)} Z${f3(pt.z)} ` +
              `F${options.cutFeedrate}`
            );
          }
          g.push(`G0 Z${f3(options.safeZ)}`);
        }
        continue;
      }

      for (const hole of holes) {
        g.push(`; ${hole.componentId} pin ${hole.pinNumber}`);
        g.push(`G0 X${f3(hole.x)} Y${f3(hole.y)}`);
        // Peck drill so swarf clears instead of binding the bit.
        const peck = Math.max(0.4, Math.abs(depth) / 3);
        let z = 0;
        while (z > depth) {
          z = Math.max(depth, z - peck);
          g.push(`G1 Z${f3(z)} F${options.drillFeedrate}`);
          g.push(`G0 Z${f3(options.safeZ)}`);
        }
      }
    }
    g.push(`G0 Z${f3(options.safeZ)}`);
  }

  // --- Operation 3: profile ---
  g.push(``);
  g.push(`; ==================================================`);
  g.push(`; OP 3/3: Board edge profile (${options.profileToolDiaMm}mm end mill)`);
  g.push(`; Tool centre runs ${(options.profileToolDiaMm / 2).toFixed(3)}mm outside the`);
  g.push(`; finished edge. ${options.tabCount} holding tab(s) keep the board captive.`);
  g.push(`; ==================================================`);
  if (options.pauseOnToolChange) {
    g.push(`T99 M6 ; Tool 99: ${options.profileToolDiaMm}mm end mill`);
    g.push(`G4 P1`);
  }

  // Internal features first: the board is still fully captive, so the cutout
  // slugs come free while the outside edge is still uncut.
  const stepDown = Math.abs(options.zStepdown) || 0.8;
  for (const cut of result.cutouts) {
    const path = cutoutToolpath(cut, options);
    if (!path) {
      g.push(
        `; SKIPPED cutout on ${cut.componentId}: ` +
        `${cut.widthMm.toFixed(1)}x${cut.heightMm.toFixed(1)}mm is smaller than the ` +
        `${options.profileToolDiaMm}mm end mill.`
      );
      continue;
    }
    g.push(``);
    g.push(
      `; --- cutout ${cut.componentId} (${cut.shape}, ` +
      `${cut.widthMm.toFixed(1)}x${cut.heightMm.toFixed(1)}mm) ---`
    );
    g.push(`G0 Z${f3(options.safeZ)}`);
    g.push(`G0 X${f3(path[0].x)} Y${f3(path[0].y)}`);
    let cz = 0;
    while (cz > options.profileDepthZ) {
      cz = Math.max(options.profileDepthZ, cz - stepDown);
      g.push(`G1 Z${f3(cz)} F${options.plungeFeedrate}`);
      for (let i = 1; i < path.length; i++) {
        g.push(`G1 X${f3(path[i].x)} Y${f3(path[i].y)} F${options.cutFeedrate}`);
      }
    }
    g.push(`G0 Z${f3(options.safeZ)}`);
  }

  const { corners, tabs } = profileToolpath(result, options);
  const inTab = (d: number) => tabs.some(t => d >= t.start && d <= t.end);

  let currentZ = 0;
  const targetZ = options.profileDepthZ;
  const step = Math.abs(options.zStepdown) || 0.8;
  // Tabs only matter once the cut is deeper than the tab height.
  const tabZ = Math.min(0, targetZ + Math.abs(options.tabHeightMm));

  g.push(`G0 X${f3(corners[0].x)} Y${f3(corners[0].y)}`);
  while (currentZ > targetZ) {
    currentZ = Math.max(targetZ, currentZ - step);
    const useTabs = options.tabCount > 0 && currentZ < tabZ;

    g.push(`; --- profile pass Z${f3(currentZ)}${useTabs ? ' (with holding tabs)' : ''} ---`);
    g.push(`G1 Z${f3(currentZ)} F${options.plungeFeedrate}`);

    let travelled = 0;
    for (let i = 0; i + 1 < corners.length; i++) {
      const a = corners[i];
      const b = corners[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);

      if (!useTabs) {
        g.push(`G1 X${f3(b.x)} Y${f3(b.y)} F${options.cutFeedrate}`);
        travelled += segLen;
        continue;
      }

      // Walk the segment, lifting to the tab height across each tab.
      const steps = Math.max(1, Math.ceil(segLen / 0.5));
      let lifted = false;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const px = a.x + (b.x - a.x) * t;
        const py = a.y + (b.y - a.y) * t;
        const needLift = inTab(travelled + segLen * t);
        if (needLift !== lifted) {
          g.push(`G1 Z${f3(needLift ? tabZ : currentZ)} F${options.plungeFeedrate}`);
          lifted = needLift;
        }
        g.push(`G1 X${f3(px)} Y${f3(py)} F${options.cutFeedrate}`);
      }
      if (lifted) g.push(`G1 Z${f3(currentZ)} F${options.plungeFeedrate}`);
      travelled += segLen;
    }
  }

  g.push(`G0 Z${f3(options.safeZ * 2)}`);
  g.push(`M5 ; Spindle off`);
  g.push(`G0 X0 Y0`);
  g.push(`M30 ; End`);

  return g.join('\n');
}

/** One drill bit and every hole it makes. */
export interface DrillBitGroup {
  /** Bit diameter to load, in mm. */
  bitMm: number;
  /**
   * Diameter the finished hole has to be — the largest nominal in the group.
   * Equal to `bitMm` for a plain drilled hole; smaller than it when the loaded
   * bit is oversize, and larger when a smaller bit is helically interpolated
   * out to size.
   */
  holeMm: number;
  /** The nominal footprint diameters this bit covers, ascending. */
  nominals: number[];
  holes: DrillPoint[];
}

/**
 * Assigns holes to drill bits, merging nominal sizes that sit within
 * `toleranceMm` of each other.
 *
 * Footprints carry the lead diameter of the part — 0.8 for a resistor, 0.9,
 * 1.0 for a TO-92, 1.1 — and a strict grouping turns a board with four part
 * types into four tool changes. On a prototype those all get drilled with one
 * bit, so sizes within a tolerance are merged and drilled at the largest of
 * them: a lead is never left without a hole it fits through, only with a
 * slightly looser one.
 *
 * Merging is greedy over ascending sizes and anchored on the smallest member,
 * so a group can never span more than `toleranceMm` end to end — a chain of
 * near-neighbours cannot drift a 0.8mm hole up to 2mm.
 */
export function groupDrillsByBit(
  drills: DrillPoint[],
  toleranceMm: number,
  bitOverridesMm?: Record<string, number>
): DrillBitGroup[] {
  const byNominal = new Map<number, DrillPoint[]>();
  for (const d of drills) {
    const key = Math.round(d.diameter * 100) / 100;
    if (!byNominal.has(key)) byNominal.set(key, []);
    byNominal.get(key)!.push(d);
  }

  const sizes = [...byNominal.keys()].sort((a, b) => a - b);
  const tol = Math.max(0, toleranceMm);
  const groups: DrillBitGroup[] = [];

  for (const size of sizes) {
    const open = groups[groups.length - 1];
    // Anchored on the group's smallest size, not its last, so the span is bounded.
    if (open && size - open.nominals[0] <= tol) {
      open.nominals.push(size);
      // Sizes ascend, so this is the largest so far.
      open.holeMm = size;
      open.bitMm = size;
      open.holes.push(...byNominal.get(size)!);
    } else {
      groups.push({
        bitMm: size,
        holeMm: size,
        nominals: [size],
        holes: [...byNominal.get(size)!],
      });
    }
  }

  if (!bitOverridesMm) return groups;

  // Swap in the bit the user actually owns. A bigger bit just drills the hole
  // oversize; a smaller one is interpolated out to size, so either direction is
  // machinable and `holeMm` stays the diameter that has to come out.
  for (const g of groups) {
    const chosen = bitOverridesMm[String(g.holeMm)];
    if (typeof chosen === 'number' && chosen > 0) g.bitMm = chosen;
  }

  // Ordered so every group sharing a bit is adjacent: the G-code emits a tool
  // change only when the bit actually changes, so one small bit can interpolate
  // several different hole sizes back to back without swapping out and in.
  groups.sort((a, b) => a.bitMm - b.bitMm || a.holeMm - b.holeMm);

  const merged: DrillBitGroup[] = [];
  for (const g of groups) {
    const open = merged[merged.length - 1];
    // Only same bit AND same finished size may share a group: a different hole
    // size needs a different interpolation radius.
    if (open && open.bitMm === g.bitMm && open.holeMm === g.holeMm) {
      open.nominals.push(...g.nominals);
      open.holes.push(...g.holes);
    } else {
      merged.push(g);
    }
  }
  for (const g of merged) g.nominals.sort((a, b) => a - b);
  return merged;
}

/**
 * Tool-centre path that opens a hole larger than the bit loaded, as a stack of
 * concentric helices cut with linear moves.
 *
 * A bit only has to be *small enough*: anything under the finished diameter can
 * be spiralled out to size, so a drawer with one 1.1mm bit still cuts 1.5mm and
 * 2.0mm holes. Arcs are deliberately not used — G2/G3 cannot be height-map
 * compensated, so a milled hole would be the one feature on the board ignoring
 * the mesh.
 *
 * Rings run inside-out. The innermost is placed so the cutter overlaps the
 * centre, otherwise a slug is left standing in the middle of the hole.
 */
function helicalHoleToolpath(
  holeMm: number,
  bitMm: number,
  depthZ: number,
  stepdownMm: number
): { x: number; y: number; z: number }[] {
  const maxR = (holeMm - bitMm) / 2;
  if (maxR <= 0.01) return [];

  const radii: number[] = [];
  // First ring: no further in than the cutter's own radius, or the centre slug
  // survives.
  const stepover = Math.max(0.05, bitMm * 0.6);
  for (let r = Math.min(maxR, bitMm / 2); r < maxR - 1e-6; r += stepover) radii.push(r);
  radii.push(maxR);

  const perRev = Math.max(0.1, Math.min(stepdownMm, bitMm * 0.5));
  const path: { x: number; y: number; z: number }[] = [];

  for (const r of radii) {
    // ~0.15mm chords: fine enough that the flat-sided polygon is inside the
    // tolerance of a hand-soldered through-hole.
    const steps = Math.max(16, Math.ceil((2 * Math.PI * r) / 0.15));
    const revs = Math.max(1, Math.ceil(Math.abs(depthZ) / perRev));
    const total = steps * revs;
    for (let i = 0; i <= total; i++) {
      const a = (i / steps) * Math.PI * 2;
      path.push({
        x: r * Math.cos(a),
        y: r * Math.sin(a),
        z: (depthZ * i) / total,
      });
    }
    // A finishing lap at depth: the helix leaves the last revolution cut on a
    // slope, so the bottom of the wall is otherwise undersize.
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      path.push({ x: r * Math.cos(a), y: r * Math.sin(a), z: depthZ });
    }
  }

  return path;
}

