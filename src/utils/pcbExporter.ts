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
import {
  circlePoly,
  differencePolys,
  offsetPolys,
  ovalPoly,
  polysOverlap,
  polysToSvgPath,
  rectPoly,
  strokeToPoly,
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
   */
  padMarginMm?: number;
  /**
   * Drill diameters within this span share one bit, sized to the largest hole
   * in the group. Footprints carry nominal lead diameters — 0.8, 0.9, 1.0, 1.1
   * — and drilling each with its own bit means a tool change per size for no
   * practical gain on a prototype. 0 keeps every nominal size separate.
   */
  drillConsolidationMm?: number;
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
  padMarginMm: 0.2,
  drillConsolidationMm: 0.3,
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

  const { placed, boardWidthMm, boardHeightMm, pads, cutouts, routing } = best!;
  const compById = new Map(placed.map(c => [c.id, c]));
  violations.push(...best!.violations);
  warnings.push(...best!.warnings);

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
  const copperByNet = new Map<string, Poly[]>();
  const addCopper = (netId: string, polys: Poly[]) => {
    copperByNet.set(netId, (copperByNet.get(netId) || []).concat(polys));
  };

  for (const pad of pads) {
    if (!pad.netId) continue;
    const comp = compById.get(pad.componentId)!;
    addCopper(pad.netId, [padPolygon(pad, comp.rotationDeg, padMargin)]);
  }
  for (const trace of traces) {
    addCopper(trace.netId, strokeToPoly(trace.points, trace.width));
  }
  for (const [netId, polys] of copperByNet) {
    copperByNet.set(netId, unionPolys(polys));
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
  const effectiveToolDiaMm = vBitWidthAtDepth(
    options.vBitTipMm,
    options.vBitAngleDeg,
    options.isolationDepthZ
  );
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
        padRadiusMm: Math.max(w, h) / 2 + padMargin,
      });
    }
  }

  // Every pad that ended up on no net is still physical copper or a drilled
  // hole, so the router has to keep clear of it.
  const obstacles: RouteObstacle[] = pads
    .filter(p => !p.netId)
    .map(p => {
      const { w, h } = padOffset(p.spec, compById.get(p.componentId)!.rotationDeg);
      // Same margin the copper is grown by, or the router would happily run a
      // trace through the annulus this pad just gained.
      return { x: p.x, y: p.y, radiusMm: Math.max(w, h) / 2 + padMargin };
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

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%">\n`;
  svg += `  <rect x="0" y="0" width="${w}" height="${h}" fill="#1b4d2e" stroke="#2e7d42" stroke-width="0.4" rx="1.5" />\n`;

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
  svg += `  <rect x="${-profR}" y="${-profR}" width="${w + options.profileToolDiaMm}" height="${h + options.profileToolDiaMm}" fill="none" stroke="#64b5f6" stroke-width="0.1" stroke-dasharray="1,0.6" opacity="0.7" />\n`;

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
  const w = result.boardWidthMm;
  const h = result.boardHeightMm;
  // Tool centre runs a radius outside the finished board edge, so the board
  // comes out at its nominal size instead of undersize by a tool diameter.
  const corners: Pt[] = [
    { x: -r, y: -r },
    { x: w + r, y: -r },
    { x: w + r, y: h + r },
    { x: -r, y: h + r },
    { x: -r, y: -r },
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

    const groups = groupDrillsByBit(result.drills, options.drillConsolidationMm ?? 0);

    let toolNum = 2;
    for (const { bitMm, nominals, holes } of groups) {
      const merged =
        nominals.length > 1 ? ` (${nominals.map(n => `${n}mm`).join(', ')} drilled at size)` : '';
      g.push(`; --- ${holes.length} hole(s) at ${bitMm}mm${merged} ---`);
      const dia = bitMm;
      if (options.pauseOnToolChange) {
        g.push(`T${toolNum} M6 ; Tool ${toolNum}: ${dia}mm drill`);
        g.push(`G4 P1`);
      }
      toolNum++;
      for (const hole of holes) {
        g.push(`; ${hole.componentId} pin ${hole.pinNumber}`);
        g.push(`G0 X${f3(hole.x)} Y${f3(hole.y)}`);
        // Peck drill so swarf clears instead of binding the bit.
        const depth = options.drillDepthZ;
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
  /** Bit diameter to load, in mm — the largest hole in the group. */
  bitMm: number;
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
export function groupDrillsByBit(drills: DrillPoint[], toleranceMm: number): DrillBitGroup[] {
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
      open.bitMm = size; // sizes ascend, so this is the largest so far
      open.holes.push(...byNominal.get(size)!);
    } else {
      groups.push({ bitMm: size, nominals: [size], holes: [...byNominal.get(size)!] });
    }
  }

  return groups;
}

/**
 * Excellon drill file, for drilling on a different machine.
 *
 * Deliberately NOT consolidated: this file goes to a fab or a dedicated drill,
 * where the tool library is real and the nominal sizes are what should be cut.
 * Bit merging exists to save tool changes on *this* machine.
 */
export function generateExcellon(result: PcbLayoutResult): string {
  const lines: string[] = ['M48', 'METRIC,TZ'];
  const byDia = new Map<number, DrillPoint[]>();
  for (const d of result.drills) {
    const key = Math.round(d.diameter * 100) / 100;
    if (!byDia.has(key)) byDia.set(key, []);
    byDia.get(key)!.push(d);
  }
  const sorted = [...byDia.entries()].sort((a, b) => a[0] - b[0]);
  sorted.forEach(([dia], i) => lines.push(`T${i + 1}C${dia.toFixed(3)}`));
  lines.push('%');
  sorted.forEach(([, holes], i) => {
    lines.push(`T${i + 1}`);
    for (const h of holes) lines.push(`X${h.x.toFixed(3)}Y${h.y.toFixed(3)}`);
  });
  lines.push('T0', 'M30');
  return lines.join('\n');
}
