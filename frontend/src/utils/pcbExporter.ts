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
import { routeBoard, type RoutePin, type RoutedTrace, type UnroutedConnection } from './pcbRouter';

export interface PcbOptions {
  boardWidthMm: number;        // Board width in mm (default 60)
  boardHeightMm: number;       // Board height in mm (default 40)
  traceWidthMm: number;        // Target trace width in mm (default 0.4)
  clearanceMm: number;         // Copper-to-copper clearance in mm (default 0.4)
  isolationPasses: number;     // Number of offset passes (1, 2, or 3)
  vBitAngleDeg: number;        // V-bit included angle in degrees
  vBitTipMm: number;           // V-bit tip width in mm
  routingGridMm: number;       // Maze router grid resolution (default 0.25)
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
  autoGrowBoard: boolean;      // Enlarge the board if parts do not fit
  rampedPlunge?: boolean;      // Enable 3D ramped entry for plunges (default true)
  rubOutClearing?: boolean;    // Clear unassigned copper areas (default false)
  airCutZOffset?: number;      // Z offset for Air Cut dry runs (default 20mm)
}

export const DEFAULT_PCB_OPTIONS: PcbOptions = {
  boardWidthMm: 60,
  boardHeightMm: 40,
  traceWidthMm: 0.4,
  clearanceMm: 0.4,
  isolationPasses: 1,
  vBitAngleDeg: 30,
  vBitTipMm: 0.1,
  routingGridMm: 0.25,
  cutFeedrate: 300,
  travelFeedrate: 1500,
  plungeFeedrate: 100,
  drillFeedrate: 150,
  spindleRpm: 12000,
  safeZ: 2.0,
  isolationDepthZ: -0.08,
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
};

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

/** Outer copper polygon of a placed pad. */
function padPolygon(pad: PlacedPad, rotationDeg: 0 | 90): Poly {
  const { w, h } = padOffset(pad.spec, rotationDeg);
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
}

/**
 * Seeds positions from the schematic layout (so the board resembles what the
 * user drew), then relaxes overlaps by pushing colliding courtyards apart.
 */
function placeComponents(
  inputs: PlacementInput[],
  opts: PcbOptions,
  warnings: string[]
): { placed: PlacedComponent[]; boardWidthMm: number; boardHeightMm: number } {
  let boardW = opts.boardWidthMm;
  let boardH = opts.boardHeightMm;

  // Gap between courtyards: room for at least one trace plus clearances.
  const gap = Math.max(1.5, opts.traceWidthMm + opts.clearanceMm * 3);
  const edge = Math.max(2.0, opts.profileToolDiaMm + 1.0);

  if (opts.autoGrowBoard) {
    // Total courtyard area plus gaps, padded for routing channels, squared off.
    const need =
      inputs.reduce((s, c) => s + (c.widthMm + gap) * (c.heightMm + gap), 0) * 2.4;
    const side = Math.sqrt(Math.max(need, 1));
    if (side + edge * 2 > boardW) boardW = Math.ceil(side + edge * 2);
    if (side + edge * 2 > boardH) boardH = Math.ceil(side + edge * 2);
    // Nothing may be narrower than the widest part.
    boardW = Math.max(boardW, Math.ceil(Math.max(...inputs.map(c => c.widthMm), 0) + edge * 2 + gap));
    boardH = Math.max(boardH, Math.ceil(Math.max(...inputs.map(c => c.heightMm), 0) + edge * 2 + gap));
    if (boardW !== opts.boardWidthMm || boardH !== opts.boardHeightMm) {
      warnings.push(
        `Board grown to ${boardW} x ${boardH} mm to fit ${inputs.length} parts ` +
        `(requested ${opts.boardWidthMm} x ${opts.boardHeightMm} mm).`
      );
    }
  }

  // Normalise schematic coordinates into the usable board area.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of inputs) {
    minX = Math.min(minX, c.schematicX);
    maxX = Math.max(maxX, c.schematicX);
    minY = Math.min(minY, c.schematicY);
    maxY = Math.max(maxY, c.schematicY);
  }
  const spanX = maxX - minX > 1 ? maxX - minX : 1;
  const spanY = maxY - minY > 1 ? maxY - minY : 1;

  const pos = inputs.map((c, i) => {
    if (inputs.length === 1) return { x: boardW / 2, y: boardH / 2 };
    const usableW = Math.max(1, boardW - edge * 2 - c.widthMm);
    const usableH = Math.max(1, boardH - edge * 2 - c.heightMm);
    return {
      x: edge + c.widthMm / 2 + ((c.schematicX - minX) / spanX) * usableW,
      // Nudge identical coordinates apart so relaxation has a gradient to work
      // with instead of two parts sitting exactly on top of each other.
      y: edge + c.heightMm / 2 + ((c.schematicY - minY) / spanY) * usableH + (i % 2) * 0.01,
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
  }));

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

export function generatePcbLayout(
  circuitNodes: Node[],
  circuitEdges: Edge[],
  userOptions?: Partial<PcbOptions>
): PcbLayoutResult {
  const options: PcbOptions = { ...DEFAULT_PCB_OPTIONS, ...userOptions };
  const warnings: string[] = [];
  const violations: DrcViolation[] = [];

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
    const footprint = resolveFootprint(data.packageId, node.type, data.pins || 2);
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
    };
  });

  // 2-4. Place and route. An unroutable net is usually a space problem, so
  // retry on a progressively larger board and keep the best attempt.
  let best: LayoutAttempt | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const scale = 1 + attempt * 0.35;
    const candidate = placeAndRoute(inputs, nets, {
      ...options,
      boardWidthMm: Math.ceil(options.boardWidthMm * scale),
      boardHeightMm: Math.ceil(options.boardHeightMm * scale),
    });
    if (!best || candidate.routing.completion > best.routing.completion) {
      best = candidate;
    }
    if (best.routing.completion >= 1) break;
  }

  const { placed, boardWidthMm, boardHeightMm, pads, routing } = best!;
  const compById = new Map(placed.map(c => [c.id, c]));
  violations.push(...best!.violations);
  warnings.push(...best!.warnings);

  if (boardWidthMm !== options.boardWidthMm || boardHeightMm !== options.boardHeightMm) {
    warnings.push(
      `Board sized to ${boardWidthMm} x ${boardHeightMm} mm to fit and route ` +
      `${inputs.length} parts (requested ${options.boardWidthMm} x ${options.boardHeightMm} mm).`
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
    addCopper(pad.netId, [padPolygon(pad, comp.rotationDeg)]);
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
  opts: PcbOptions
): LayoutAttempt {
  const violations: DrcViolation[] = [];
  const warnings: string[] = [];

  const { placed, boardWidthMm, boardHeightMm } = placeComponents(inputs, opts, warnings);
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
      const mapping = resolveHandleToPin(comp.type, port.handleId, comp.footprint);
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
        padRadiusMm: Math.max(w, h) / 2,
      });
    }
  }

  const routing = routeBoard(routePins, {
    boardWidthMm,
    boardHeightMm,
    gridMm: opts.routingGridMm,
    traceWidthMm: opts.traceWidthMm,
    clearanceMm: opts.clearanceMm,
    edgeClearanceMm: Math.max(1.0, opts.profileToolDiaMm),
    bendPenalty: 1.5,
  });

  return { placed, boardWidthMm, boardHeightMm, pads, routing, violations, warnings };
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
 */
export function generateAirCutGcode(gcode: string, zOffsetMm = 20): string {
  if (!gcode) return gcode;
  const lines = gcode.split('\n');
  const transformed = lines.map((line) => {
    const semiIdx = line.indexOf(';');
    const codePart = semiIdx !== -1 ? line.slice(0, semiIdx) : line;
    const commentPart = semiIdx !== -1 ? line.slice(semiIdx) : '';

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

    // Group by diameter so each drill bit is loaded once.
    const byDia = new Map<number, DrillPoint[]>();
    for (const d of result.drills) {
      const key = Math.round(d.diameter * 100) / 100;
      if (!byDia.has(key)) byDia.set(key, []);
      byDia.get(key)!.push(d);
    }

    let toolNum = 2;
    for (const [dia, holes] of [...byDia.entries()].sort((a, b) => a[0] - b[0])) {
      g.push(`; --- ${holes.length} hole(s) at ${dia}mm ---`);
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

/** Excellon drill file, for drilling on a different machine. */
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
