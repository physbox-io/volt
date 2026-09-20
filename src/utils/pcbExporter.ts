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
import type { RawNodeData } from '../types/nodes';
import {
  resolveFootprint,
  generateJumperFootprint,
  type ComponentFootprint,
  type PadSpec,
} from './pcbFootprints';
import { extractNets, isPhysical, resolveHandleToPin, type PcbNet } from './pcbNets';
import { minPadGapMm } from './pcbTooling';
import {
  circlePoly,
  differencePolys,
  intersectPolys,
  offsetPolys,
  ovalPoly,
  pointInPolys,
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
  type RouterOptions,
  type RouteVia,
} from './pcbRouter';

export interface PcbOptions {
  layers?: 1 | 2;              // 1 = single-sided (default), 2 = double-sided
  /**
   * Cut a single-sided board as the mirror of its layout.
   *
   * The mill works copper-up, but a through-hole part is inserted from the bare
   * face and soldered to the copper - so the face the parts land on is the
   * mirror of the face that was cut. Milling the layout as drawn therefore
   * seats every part mirrored: an inline header reverses end-for-end, and a
   * module with two pin rows puts each row in the other row's holes. On a
   * Heltec carrier that reads as GPIO26/GPIO21 where GPIO4/GPIO5 were drawn,
   * and the part cannot be flipped to compensate - a module has a fixed
   * handedness, and turning it 180 degrees reverses the pin order within each
   * row instead.
   *
   * Mirroring the toolpaths puts the copper on the far side of the laminate
   * from where the layout drew it, so assembling from the other face reproduces
   * the layout exactly. Defaults to true: that is how the boards this app mills
   * are actually built.
   *
   * Two-layer boards ignore it. Their parts sit on the top copper, which is cut
   * first, copper-up, on the same face the parts go into - nothing to mirror -
   * and the bottom layer already mirrors for its own flip.
   */
  mirrorSingleSided?: boolean;
  viaPadMm?: number;           // Via pad diameter in mm (default 1.4)
  viaDrillMm?: number;         // Via drill diameter in mm (default 0.8)
  spoilboardRegistrationDepthMm?: number; // Extra depth into spoilboard for registration pins in mm (default 2.0)
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
  /**
   * Height above work Z0 the tool is parked at for a bit change, in mm.
   *
   * Safe Z is a travel height — a couple of millimetres, enough to clear the
   * copper between cuts. It is nowhere near enough to change a bit: the next
   * one may protrude several millimetres further than the last, which puts its
   * tip *inside the board* the moment the collet is tightened. Everything the
   * operator does next then happens from there — jogging drags the bit through
   * the copper, and probing for a new Z0 cannot find a surface it is already
   * below, so it drills its whole search depth instead.
   */
  toolChangeZ: number;
  /**
   * Stock thickness in mm. Through-cuts are referenced to the bottom face:
   * a drill or a profile pass has to reach it and then some, and a holding tab
   * is however much material is deliberately left above it.
   */
  boardThicknessMm: number;
  /**
   * How far a through-cut goes past the bottom face, into the spoilboard, in
   * mm. Stopping level with the bottom leaves the last few microns joined by
   * whatever the levelling residual and the Z0 error add up to — holes that
   * still have a skin in them and a profile that will not release.
   */
  breakThroughMm: number;
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
   * Bare laminate kept between every pad and the copper of any *other* net,
   * when copper is flooded, in mm.
   *
   * A milled board has no solder mask, so the only thing between a pad and
   * the copper beside it is the isolation channel: a fraction of a millimetre
   * of laminate that a blob of solder crosses without trying. This widens
   * that channel wherever it runs past a pad.
   *
   * Only against *other* nets. An earlier version held the pad's own net off
   * too, on the reasoning that solder wetting out onto its own flood would
   * reach the channel edge anyway - which ringed every pad in bare laminate
   * and left the pin joined to its own track by a neck of nominal trace
   * width, a tenth of a millimetre of cutter wander away from being severed.
   * Solder running from a pad onto the net that pad is already part of
   * connects nothing new; foreign copper is the whole hazard, so foreign
   * copper is what gets pushed back.
   *
   * The ring is milled out rather than merely outlined - see
   * {@link padReliefPlan}. It has no effect when the flood is off, since
   * without a flood the copper next to a pad is a dead island anyway.
   */
  padClearanceMm?: number;
  /**
   * Cut an isolation ring around every pad that carries no net.
   *
   * The board is isolation-milled, so copper the toolpath never encircles stays
   * on the blank. A drilled hole for an unconnected pin therefore passes
   * straight through that leftover foil, and the pin poking through it makes an
   * intermittent connection to whatever the foil is touching - usually the
   * ground pour. Ringing the pad leaves it as an isolated island instead, still
   * solderable for mechanical strength but electrically on its own.
   */
  isolateUnusedPads?: boolean;
  /**
   * Let the router solve a crossing by dropping in a wire jumper.
   *
   * A single-layer board cannot route one net across another, and no amount of
   * trace width, clearance or search budget changes that - the honest answers
   * are a different placement or a wire soldered over the top. With this on,
   * the layout will place jumper pads itself and route to them, up to
   * {@link maxAutoJumpers}. Off by default: a jumper is a part someone has to
   * fit by hand after the board comes off the machine, so it should be a choice
   * rather than something a board quietly acquires.
   */
  /**
   * Search for a placement that routes, instead of only ever trying the one the
   * schematic implies.
   *
   * Placement is otherwise the schematic normalised into the board rectangle
   * and then de-overlapped - connectivity never enters into it - so whether a
   * single-layer board routes comes down to how the schematic happened to be
   * drawn. On a real 4-part board only 7 of 108 hand-tried arrangements routed
   * without overlapping something.
   *
   * Runs only when the straightforward attempt has failed, so a board that
   * already routes costs nothing. Candidates are ranked by the router itself
   * on a coarse grid - one pass to shortlist, a short budgeted run to order
   * the shortlist - then the best few are genuinely routed and the best kept,
   * so the answer is verified rather than predicted.
   */
  placementSearch?: boolean;
  /**
   * Random candidates to score after the structured ones, at most. The
   * scoring stage is also bounded by half the routing budget, so a large
   * board may not get through them all. Defaults to 240.
   */
  placementCandidates?: number;
  /** How many of the shortlist to actually route. Defaults to 3. */
  placementRouteTop?: number;
  autoJumpers?: boolean;
  /** Ceiling on jumpers the layout may add for itself. Defaults to 4. */
  maxAutoJumpers?: number;
  /**
   * Extra clearance kept on *each* side of the isolation channel when copper is
   * flooded, in mm. This is the flood's safety margin against an unlevelled
   * board and against Clipper's own rounding: at 0 the pass-0 ring would touch
   * the neighbouring copper's keepout and get truncated, which leaves the two
   * nets shorted.
   */
  channelMarginMm?: number;
  /**
   * Parts the user has placed by hand, keyed by component id.
   *
   * Placement is a search, and a search answers the question it was asked —
   * "can this route" — not "is this the board I want to solder". Moving one
   * part is otherwise only expressible by moving it in the schematic and
   * paying for a whole new place-and-route, which re-decides every other part
   * at the same time and hands back a board that is unrecognisable.
   *
   * An override is applied after the board has been decided and cropped, and
   * only the nets the moved part touches are routed again — so everything else
   * on the board stays exactly where it was. It is part of the board's
   * fingerprint, so a hand-placed board saves and restores like any other.
   *
   * See {@link PlacementOverride} for the frame the coordinates are in.
   */
  placementOverrides?: PlacementOverrides;
}

/**
 * Where a hand-placed part sits.
 *
 * In board-frame millimetres — measured from the board's lower-left corner
 * rather than from the program origin — and before the single-sided assembly
 * mirror, which is the frame {@link LayoutCore} is in. Both matter: the origin
 * inset changes with the profile tool and the layer count, and the mirror is a
 * view of the board rather than a property of it, so neither should move a
 * part the user put somewhere.
 *
 * `type` is the node type the override was recorded against. Component ids are
 * only unique within a circuit, and these are stored with the machining
 * settings, which are not — so an override is ignored unless the part it names
 * is still the same kind of part.
 */
export interface PlacementOverride {
  xMm: number;
  yMm: number;
  rotationDeg: Rotation;
  type?: string;
}

export type PlacementOverrides = Record<string, PlacementOverride>;

/**
 * Extra stock left on every side of a double-sided board, so the two
 * registration pin holes have material to sit in outside the profile cut.
 */
export const REGISTRATION_MARGIN_MM = 6.0;

/** How far outside the finished board edge the registration pins are drilled. */
export const REGISTRATION_PIN_OFFSET_MM = 3.0;

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
  toolChangeZ: 15.0,
  boardThicknessMm: 1.6,
  breakThroughMm: 0.3,
  isolationDepthZ: -0.2,
  // Through the 1.6mm blank and 0.3mm into the spoilboard. Kept as explicit
  // depths rather than derived, so a job can still be given its own.
  drillDepthZ: -1.9,
  profileDepthZ: -1.9,
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
  padClearanceMm: 0.5,
  isolateUnusedPads: true,
  placementSearch: true,
  placementCandidates: 240,
  placementRouteTop: 3,
  autoJumpers: false,
  maxAutoJumpers: 4,
  channelMarginMm: 0.05,
  layers: 1 as 1 | 2,
  mirrorSingleSided: true,
  viaPadMm: 1.4,
  viaDrillMm: 0.8,
  spoilboardRegistrationDepthMm: 2.0,
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
  rotationDeg: Rotation;
  footprint: ComponentFootprint;
  widthMm: number;           // Courtyard after rotation
  heightMm: number;
  data?: RawNodeData;
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
  layer?: 'top' | 'bottom';
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
  isVia?: boolean;
  isRegistration?: boolean;
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
  /**
   * Bare laminate actually left around every pad, per side, in mm — the
   * requested {@link PcbOptions.padClearanceMm} rounded up to a width the
   * isolation passes clear outright. 0 when the flood is off, since there is
   * then no flooded copper for the ring to hold back.
   */
  padReliefMm: number;
  cycleTimeSec: number;
  travelDistanceMm: number;
  cutDistanceMm: number;
  /** Board preview drawn from the copper face, as the mill sees it. */
  svg: string;
  /** The same board mirrored, as seen from the face the parts sit on. */
  svgComponentSide: string;
  gcode: string;
  error?: string;
  /** 2-layer board outputs */
  layers?: 1 | 2;
  vias?: RouteVia[];
  topTraces?: TraceSegment[];
  bottomTraces?: TraceSegment[];
  topIsolationPaths?: IsolationPath[];
  bottomIsolationPaths?: IsolationPath[];
  svgBottomSide?: string;
  svgComposite?: string;
  /**
   * The copper each net occupies after flooding, keyed by net id — the exact
   * polygons the isolation toolpaths were offset from and the SVG previews
   * were drawn from. Exposed so a fab-house (Gerber) export renders the same
   * copper a mill would cut, rather than re-deriving it from traces/pads and
   * risking drift from what {@link svg} actually shows.
   */
  copperByNet: Map<string, Poly[]>;
  bottomCopperByNet?: Map<string, Poly[]>;
  /**
   * What this board would have to be saved as for another machine to rebuild
   * it without routing it again. See {@link PcbLayoutSnapshot}.
   */
  snapshot?: PcbLayoutSnapshot;
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

/**
 * Overlap between consecutive isolation passes, as a fraction of the channel
 * the bit cuts. Below 1 so passes overlap rather than leaving a rib between
 * them; the board margin, the flood's edge keepout and the passes themselves
 * all have to agree on it.
 */
export const ISOLATION_STEPOVER = 0.8;

/**
 * The pad relief the mill can actually leave, and the extra concentric passes
 * it takes to clear it.
 *
 * {@link PcbOptions.padClearanceMm} asks for a ring of bare laminate around
 * every pad, wider than the channel between two nets. Holding the flood off
 * that ring is only half the job: a single isolation pass cuts a channel at
 * each *edge* of the ring and leaves the middle standing as a floating sliver
 * of copper, a channel's width from the pad. Solder crosses that without
 * trying, so the ring made the pad harder to solder rather than easier - and
 * the wider the ring, the worse, which is why turning the clearance down to
 * zero appears to fix it.
 *
 * So the ring is cleared with concentric passes stepped out from the pad, and
 * its width is rounded up to what a whole number of those passes covers:
 * `channel + n * stepover`. Rounded up rather than down because the figure is
 * a minimum - the point of it is solder not reaching the flood.
 *
 * Returns a zero-width relief when the flood is off: without a flood the
 * copper beside a pad is a dead island anyway, and there is nothing to hold
 * back.
 */
export function padReliefPlan(
  requestedMm: number,
  channelMm: number,
  floodMm: number
): { clearanceMm: number; passes: number } {
  if (!(requestedMm > 0) || !(floodMm > 0) || !(channelMm > 0)) {
    return { clearanceMm: 0, passes: 0 };
  }
  // Pass 0 already cuts a channel-wide ring round the pad, so that is the
  // narrowest relief there is; asking for less cannot make it narrower.
  if (requestedMm <= channelMm) return { clearanceMm: channelMm, passes: 0 };
  const stepover = channelMm * ISOLATION_STEPOVER;
  // A ceiling on the cutting a single number in a box can buy: 12 passes is
  // already ~2mm of relief on a default V-bit.
  const passes = Math.min(12, Math.ceil((requestedMm - channelMm) / stepover));
  return { clearanceMm: channelMm + passes * stepover, passes };
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
/**
 * A footprint's orientation on the board, in quarter turns. The half turns
 * matter as much as the quarter turns for a connector: pin 1 at one end of the
 * strip or the other decides which way its traces have to wrap.
 */
export type Rotation = 0 | 90 | 180 | 270;

export function padOffset(
  spec: PadSpec,
  rotationDeg: Rotation
): { dx: number; dy: number; w: number; h: number } {
  switch (rotationDeg) {
    case 90: return { dx: -spec.y, dy: spec.x, w: spec.padHeight, h: spec.padWidth };
    case 180: return { dx: -spec.x, dy: -spec.y, w: spec.padWidth, h: spec.padHeight };
    case 270: return { dx: spec.y, dy: -spec.x, w: spec.padHeight, h: spec.padWidth };
    default: return { dx: spec.x, dy: spec.y, w: spec.padWidth, h: spec.padHeight };
  }
}

/** Courtyard size of a footprint turned by `rot`. */
export function turnedSize(footprint: ComponentFootprint, rot: Rotation): { widthMm: number; heightMm: number } {
  const swap = rot === 90 || rot === 270;
  return {
    widthMm: swap ? footprint.heightMm : footprint.widthMm,
    heightMm: swap ? footprint.widthMm : footprint.heightMm,
  };
}

/**
 * Outer copper polygon of a placed pad.
 *
 * `marginMm` grows the pad on every side. It is clamped so the copper can never
 * be shrunk below the drill it surrounds — a pad smaller than its own hole is
 * an annulus that the drill removes entirely, leaving the joint with nothing to
 * solder to.
 */
export function padPolygon(pad: PlacedPad, rotationDeg: Rotation, marginMm = 0): Poly {
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
  rotationDeg: Rotation;
  footprint: ComponentFootprint;
  widthMm: number;
  heightMm: number;
  data?: RawNodeData;
}

/**
 * Seeds positions from the schematic layout (so the board resembles what the
 * user drew), then relaxes overlaps by pushing colliding courtyards apart.
 */
/**
 * A candidate arrangement, independent of board size: where each part starts as
 * a fraction of the usable area, and which way round it sits. The schematic
 * supplies the first one; the placement search invents the rest.
 */
export interface PlacementSeed {
  norm: { x: number; y: number }[];
  rotations: Rotation[];
}

function placeComponents(
  inputs: PlacementInput[],
  opts: PcbOptions,
  warnings: string[],
  spreadScale = 1,
  seed?: PlacementSeed
): { placed: PlacedComponent[]; boardWidthMm: number; boardHeightMm: number; overlaps: number } {
  // Gap between courtyards: room for at least one trace plus clearances.
  // `spreadScale` loosens it on later attempts, when a tighter packing turned
  // out to leave the router nowhere to go.
  const gap = Math.max(3.5, opts.traceWidthMm + opts.clearanceMm * 5) * spreadScale;
  // Rim keep-out: what the profile pass and the router actually need — the
  // same figure routeBoard is handed below — plus the blank border the user
  // asked for. A flat 7mm floor here was handling slop, and on a fixed-size
  // board, where nothing crops it back off afterwards, it surfaced as a wide
  // dead perimeter around the copper.
  const edge = Math.max(1.0, opts.profileToolDiaMm) + Math.max(0, opts.boardMarginMm ?? 1.5);

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
    const normX = seed
      ? seed.norm[i].x
      : maxX > minX ? (c.schematicX - minX) / (maxX - minX) : 0.5;
    const normY = seed
      ? seed.norm[i].y
      : maxY > minY ? (c.schematicY - minY) / (maxY - minY) : 0.5;
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

  // Report any collision the relaxation could not resolve. Counted as well as
  // reported: an attempt that leaves two courtyards on top of each other is not
  // a board that can be built, however well it routed, so the caller ranks on
  // this before it looks at completion.
  let overlaps = 0;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (
        Math.abs(a.x - b.x) < (a.widthMm + b.widthMm) / 2 - 0.01 &&
        Math.abs(a.y - b.y) < (a.heightMm + b.heightMm) / 2 - 0.01
      ) {
        overlaps++;
        warnings.push(
          `Footprints for ${a.name} and ${b.name} overlap — board is too small.`
        );
      }
    }
  }

  return { placed, boardWidthMm: boardW, boardHeightMm: boardH, overlaps };
}

/**
 * Cheap routability score for a candidate placement. Lower is better.
 *
 * It is the real router, run once: a single net ordering on a grid one track
 * pitch wide, no rip-up, no budget. Every formula tried before it rewarded
 * compactness - short straight lines seldom cross, but the router cannot go
 * through a pad row, and the detours it takes are what collide - and a
 * hand-built negotiated router at the same cost still deadlocked on nets that
 * have to move together. One pass of the router itself sees the same board the
 * full pass will (the space under a dual-row module included, which is
 * routable and which the earlier courtyard-blocking grids walled off), at a
 * tenth of the cells, in about the time the formula took. Measured on fifteen
 * arrangements of one carrier board it ranked them at a Kendall tau of 0.61
 * against the full routing pass, with both routable arrangements first; the
 * best hand-built score managed 0.26 and ranked them fifth.
 *
 * Unrouted connections lead; trace length only breaks ties between placements
 * that route equally well, never a reason to prefer one that routes worse.
 */
export function scorePlacement(
  placed: PlacedComponent[],
  nets: PcbNet[],
  opts: {
    traceWidthMm: number;
    clearanceMm: number;
    boardWidthMm: number;
    boardHeightMm: number;
    routingGridMm?: number;
    profileToolDiaMm?: number;
    padMarginMm?: number;
  }
): number {
  const full: PcbOptions = { ...DEFAULT_PCB_OPTIONS, ...opts };
  const { routePins, obstacles } = routingProblem(placed, nets, full, []);
  const r = routeBoard(routePins, {
    ...coarseRouterOptions(full, opts.boardWidthMm, opts.boardHeightMm),
    obstacles,
    budgetMs: 0,
  });
  let lengthMm = 0;
  for (const t of r.traces) {
    for (let i = 0; i + 1 < t.points.length; i++) {
      lengthMm += Math.hypot(t.points[i + 1].x - t.points[i].x, t.points[i + 1].y - t.points[i].y);
    }
  }
  return r.unrouted.length * 1000 + lengthMm * 0.05;
}

/** Router settings for a pass at one cell per track pitch. */
function coarseRouterOptions(
  opts: PcbOptions,
  boardWidthMm: number,
  boardHeightMm: number
): Omit<RouterOptions, 'obstacles' | 'budgetMs'> {
  return {
    boardWidthMm,
    boardHeightMm,
    gridMm: Math.max(opts.routingGridMm, opts.traceWidthMm + opts.clearanceMm),
    traceWidthMm: opts.traceWidthMm,
    clearanceMm: opts.clearanceMm,
    edgeClearanceMm: Math.max(1.0, opts.profileToolDiaMm),
    bendPenalty: 1.5,
    layers: opts.layers ?? 1,
    viaPadMm: opts.viaPadMm,
    viaDrillMm: opts.viaDrillMm,
  };
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
  const base = opts.profileToolDiaMm / 2;
  // A double-sided board also drills two registration pin holes into the
  // margin stock, 3mm outside the finished edge. Without room for them the
  // holes land off the blank, so the inset grows to keep them in material.
  return opts.layers === 2 ? base + REGISTRATION_MARGIN_MM : base;
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
  const relief = padReliefPlan(
    opts.padClearanceMm ?? 0,
    isoDia,
    Math.max(0, opts.copperFloodMm ?? 0)
  );
  const passes = Math.max(
    Math.max(1, Math.min(3, opts.isolationPasses)),
    1 + relief.passes
  );
  const isolationReach = isoDia + (passes - 1) * isoDia * ISOLATION_STEPOVER;
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
    /**
     * Pads that get soldered. No *other* net's copper comes within
     * {@link padClearanceMm} of one.
     *
     * The pad's own net is deliberately not held off: solder running from a
     * pad onto the net that pad is already part of connects nothing that was
     * not connected, and ringing the pad to stop it is what leaves the pin
     * hanging off a nominal-width neck.
     */
    pads?: Poly[];
    /**
     * Those same pads, grouped by the net each one belongs to. A pad on no
     * net belongs to nobody and is foreign to everything.
     */
    padsByNet?: Map<string, Poly[]>;
    /**
     * The copper each net grows *from*, typically its tracks and vias as
     * routed, running to the pad centres. When absent the whole of the net's
     * copper grows, pads included - which turns every pad into a blob the
     * size of the flood budget. Given, the pads are kept as they are and the
     * flood reaches them along the track.
     */
    seedsByNet?: Map<string, Poly[]>;
    /**
     * Laminate kept between a pad's outline and copper belonging to any
     * *other* net, in mm.
     */
    padClearanceMm?: number;
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
  // Pads are static too. Their ring is measured from the pad's own outline, not
  // from the channel, and unlike a blocker it binds the pad's own net as well:
  // if that net could fill the ring, solder on the pad would wet straight out
  // to the channel edge and the clearance would buy nothing.
  const padClearance = Math.max(0, opts.padClearanceMm ?? 0);
  const padKeepout =
    padClearance > 0 && opts.pads && opts.pads.length > 0
      ? offsetPolys(unionPolys(opts.pads), padClearance)
      : [];
  // One keepout per net, holding it off everyone else's pads and leaving its
  // own alone, so a net floods into its own pads at full width and a pin is
  // joined to its track by as much copper as the track has. Pads never move,
  // so this is done once rather than once per step.
  const padKeepoutByNet = new Map<string, Poly[]>();
  if (padKeepout.length > 0) {
    for (const netId of netIds) {
      const own = opts.padsByNet?.get(netId);
      if (!own?.length) continue;
      const foreign = (opts.pads ?? []).filter(poly => !own.includes(poly));
      padKeepoutByNet.set(
        netId,
        foreign.length > 0 ? offsetPolys(unionPolys(foreign), padClearance) : []
      );
    }
  }
  const bounds = opts.bounds && opts.bounds.length > 0 ? opts.bounds : null;
  const boundsBox = bounds ? polysBounds(bounds) : null;

  let cur = copperByNet;
  // What actually grows. A pad that seeds the flood swells by the whole
  // budget in every direction and stops being recognisable as a pad: a blob,
  // flattened wherever a neighbour's keepout caught it. So where the caller
  // says which copper is track, only the track grows - up to, into and across
  // its pads, since a routed track runs to the pad centre and its rounded end
  // lands there - and the pad keeps the shape the footprint gave it.
  const seed = new Map<string, Poly[]>();
  for (const netId of netIds) {
    seed.set(netId, opts.seedsByNet?.get(netId) ?? cur.get(netId)!);
  }
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

      let grown = offsetPolys(seed.get(netId)!, stepMm);
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
      const clip: Poly[] = [...blockerKeepout, ...(padKeepoutByNet.get(netId) ?? padKeepout)];
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
      const grownSeed = unionPolys([...grown, ...seed.get(netId)!]);
      grown = unionPolys([...grown, ...own]);

      if (totalArea(grown) > totalArea(own) + 1e-4) {
        grewAny = true;
        seed.set(netId, grownSeed);
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

/** One placement input per physical node: footprint, size and orientation. */
function placementInputs(physicalNodes: Node[]): PlacementInput[] {
  return physicalNodes.map((node, idx) => {
    const data = (node.data ?? {}) as {
      orientation?: string;
      packageId?: string;
      pins?: number;
      label?: string;
      name?: string;
    };
    const orientation = data.orientation;
    const rotationDeg: Rotation =
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
      ...turnedSize(footprint, rotationDeg),
      data: node.data,
    };
  });
}

/**
 * One arrangement, placed and routed exactly as the placement search would
 * evaluate it: at the tightest spread that fits, on the placement board,
 * before any crop. This exists for the harness in src/test_placement_proxy.ts, which
 * measures the search's ranking stages against the truth of a full routing
 * pass, and needs both to see the same board.
 */
export function layoutArrangement(
  circuitNodes: Node[],
  circuitEdges: Edge[],
  userOptions?: Partial<PcbOptions>,
  seed?: PlacementSeed
): {
  components: PlacedComponent[];
  boardWidthMm: number;
  boardHeightMm: number;
  nets: PcbNet[];
  overlaps: number;
  completion: number;
  unrouted: number;
} {
  const options: PcbOptions = { ...DEFAULT_PCB_OPTIONS, ...userOptions };
  const physicalNodes = (circuitNodes || []).filter(n => isPhysical(n.type));
  const { nets } = extractNets(circuitNodes || [], circuitEdges || []);
  const inputs = placementInputs(physicalNodes);
  // The tightest spread whose courtyards do not collide, as the search does.
  let attempt: LayoutAttempt | null = null;
  for (const spread of [1, 1.4, 1.8]) {
    attempt = placeAndRoute(inputs, nets, options, Math.max(0, options.routingBudgetMs), undefined, spread, seed);
    if (attempt.overlaps === 0) break;
  }
  return {
    components: attempt!.placed,
    boardWidthMm: attempt!.boardWidthMm,
    boardHeightMm: attempt!.boardHeightMm,
    nets,
    overlaps: attempt!.overlaps,
    completion: attempt!.routing.completion,
    unrouted: attempt!.routing.unrouted.length,
  };
}

/**
 * Reflects a finished layout across the board's vertical centreline, in place.
 *
 * A single-sided board is milled copper-up, but a through-hole part is inserted
 * from the bare face and soldered to the copper - so the face the parts land on
 * is the mirror of the face that was cut. Milling the layout as drawn seats
 * every part handed: an inline header reverses end-for-end, and a module with
 * two pin rows drops each row into the other row's holes. The parts cannot be
 * turned over to compensate, because a module has a fixed handedness and
 * rotating it 180 degrees reverses the pin order within each row instead.
 *
 * A reflection is an isometry, so routing, clearances and DRC carry over
 * untouched; nothing needs re-solving.
 *
 * Aliasing is why this guards with a Set. `topTraces` and `bottomTraces` are
 * filtered views holding the *same* TraceSegment objects as `traces`, and
 * `isolationPaths` and `topIsolationPaths` are the same array. Mirroring by
 * walking each field in turn would move the shared ones twice and put them
 * back where they started.
 */
function mirrorLayoutInX(result: PcbLayoutResult): void {
  const mid = result.boardOriginMm + result.boardWidthMm / 2;
  const fx = (x: number) => 2 * mid - x;
  const seen = new Set<object>();
  const once = <T extends object>(o: T): boolean => {
    if (seen.has(o)) return false;
    seen.add(o);
    return true;
  };
  const mirrorPts = (ps: Pt[]): Pt[] => ps.map(pt => ({ ...pt, x: fx(pt.x) }));

  for (const c of result.components) {
    if (!once(c)) continue;
    c.x = fx(c.x);
    // Reflecting about a vertical axis takes a heading of t to 180 - t, which
    // maps the four right angles onto themselves: 0 and 180 swap, 90 and 270
    // are unchanged.
    c.rotationDeg = ((((180 - c.rotationDeg) % 360) + 360) % 360) as Rotation;
  }
  for (const pad of result.pads) if (once(pad)) pad.x = fx(pad.x);
  for (const d of result.drills) if (once(d)) d.x = fx(d.x);
  for (const cut of result.cutouts) if (once(cut)) cut.x = fx(cut.x);
  for (const v of result.vias ?? []) if (once(v)) v.x = fx(v.x);

  const traceLists = [result.traces, result.topTraces, result.bottomTraces];
  for (const list of traceLists) {
    for (const t of list ?? []) if (once(t)) t.points = mirrorPts(t.points);
  }
  const pathLists = [
    result.isolationPaths,
    result.topIsolationPaths,
    result.bottomIsolationPaths,
  ];
  for (const list of pathLists) {
    for (const path of list ?? []) if (once(path)) path.points = mirrorPts(path.points);
  }

  // The copper polygons are handed to the renderers as their own map, so they
  // are rewritten in place: the caller is holding this same Map.
  for (const map of [result.copperByNet, result.bottomCopperByNet]) {
    if (!map) continue;
    for (const [netId, polys] of map) map.set(netId, polys.map(mirrorPts));
  }
}

/**
 * Strips anything a layout request cannot carry across a `postMessage` or into
 * a fingerprint: React Flow node data holds callbacks and, in a few places,
 * back-references to other nodes.
 */
function sanitizeForLayout<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'function' ? (undefined as T) : value;
  }
  if (seen.has(value as object)) return undefined as T;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map(v => sanitizeForLayout(v, seen)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'function') continue;
    out[k] = sanitizeForLayout(v, seen);
  }
  return out as T;
}

/** A circuit node, reduced to the parts a board is laid out from. */
export const projectLayoutNodes = (nodes: Node[]) =>
  nodes.map(n => sanitizeForLayout({ id: n.id, type: n.type, position: n.position, data: n.data }));

/** A circuit edge, reduced to the parts a board is laid out from. */
export const projectLayoutEdges = (edges: Edge[]) =>
  edges.map(e =>
    sanitizeForLayout({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: e.type,
      data: e.data,
    })
  );

/**
 * The options that decide what the board *is*, as opposed to how it is written
 * out or how long the router is given to think about it.
 */
export function boardShapingOptions(options: Partial<PcbOptions>): Partial<PcbOptions> {
  const geometry: Record<string, unknown> = { ...options };
  for (const key of GCODE_ONLY_OPTIONS) delete geometry[key];
  // How long the search ran is not part of what the board is. It is also what
  // differs between the machine that laid a board out and the one reopening
  // it, which is the entire point of being able to save one.
  delete geometry.routingBudgetMs;
  return geometry as Partial<PcbOptions>;
}

/**
 * A fingerprint of everything that can move a feature on the board: the
 * circuit, and every option that is not purely about emitting G-code.
 *
 * 128 bits, in four independent 32-bit passes. A 32-bit hash would have been
 * shorter and is what the rest of this app uses for change detection, but the
 * consequence of a collision here is not a stale preview — it is a saved
 * layout being replayed onto a circuit it does not belong to, and milled.
 * Four passes make that outcome impossible in practice rather than merely
 * unlikely.
 */
export function layoutBoardKey(
  nodes: Node[],
  edges: Edge[],
  options: Partial<PcbOptions>
): string {
  const text = JSON.stringify({
    nodes: projectLayoutNodes(nodes || []),
    edges: projectLayoutEdges(edges || []),
    options: boardShapingOptions({ ...DEFAULT_PCB_OPTIONS, ...options }),
  });
  const SEEDS = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
  const out = SEEDS.map(seed => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(36).padStart(7, '0');
  });
  return `${text.length.toString(36)}-${out.join('')}`;
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

  const nodes = circuitNodes || [];
  const edges = circuitEdges || [];

  const physicalNodes = nodes.filter(n => isPhysical(n.type));
  if (physicalNodes.length === 0) {
    return emptyResult(options, 'No placeable components in this circuit.');
  }

  // 1. Nets -------------------------------------------------------------
  const { nets, warnings: netWarnings } = extractNets(nodes, edges);
  warnings.push(...netWarnings);

  const inputs = placementInputs(physicalNodes);

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
    // Overlapping courtyards outrank everything: a board with two parts sitting
    // on top of each other cannot be built at all, so a fully routed overlapping
    // attempt is worse than a partly routed clean one. Ranked on that first,
    // then on completion — an equally complete but larger board is a worse board.
    const beats =
      !best ||
      candidate.overlaps < best.overlaps ||
      (candidate.overlaps === best.overlaps &&
        candidate.routing.completion > best.routing.completion);
    if (beats) best = candidate;
    if (best.overlaps === 0 && best.routing.completion >= 1) break;
  }

  // Placement search. Everything above only ever tries the arrangement the
  // schematic implies, at three different spreads. When that cannot be routed,
  // shortlist other arrangements on the cheap proxy and actually route the best
  // few - so the board is judged on a real routing pass, not on the score.
  if (
    options.placementSearch !== false &&
    best &&
    (best.overlaps > 0 || best.routing.completion < 1) &&
    physicalNodes.length > 1
  ) {
    const candidateCount = Math.max(0, Math.round(options.placementCandidates ?? 240));
    const routeTop = Math.max(1, Math.round(options.placementRouteTop ?? 3));

    // Deterministic, so the same circuit always produces the same board.
    let rngState = 0x2f6e2b1;
    const rng = () => {
      rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
      return rngState / 0x7fffffff;
    };

    const rotate = (c: PlacementInput, rot: Rotation): PlacementInput => ({
      ...c,
      rotationDeg: rot,
      ...turnedSize(c.footprint, rot),
    });
    const ROTATIONS: Rotation[] = [0, 90, 180, 270];

    // Place a candidate at the tightest spread whose courtyards do not
    // collide. The seed board is sized from the parts' areas, and at the
    // tightest spread it cannot hold a connector moved to the far side of a
    // long module - the one arrangement the search exists to find. It was
    // being discarded here as an overlap, before it was ever scored. Board
    // area is cheap: with auto-sizing on, the crop takes the blank laminate
    // back off afterwards.
    const SPREADS = [1, 1.4, 1.8];
    const placeCandidate = (trial: PlacementInput[], seed: PlacementSeed) => {
      for (const spread of SPREADS) {
        const probe = placeComponents(trial, options, [], spread, seed);
        if (probe.overlaps === 0) return { probe, spread };
      }
      return null;
    };
    const turned = (r: Rotation, quarters: number): Rotation =>
      ROTATIONS[(ROTATIONS.indexOf(r) + quarters) % 4];

    // The arrangement the schematic implies, in the same normalised form the
    // placer derives internally — the origin for every structured variant.
    let sMinX = Infinity, sMaxX = -Infinity, sMinY = Infinity, sMaxY = -Infinity;
    for (const c of inputs) {
      sMinX = Math.min(sMinX, c.schematicX); sMaxX = Math.max(sMaxX, c.schematicX);
      sMinY = Math.min(sMinY, c.schematicY); sMaxY = Math.max(sMaxY, c.schematicY);
    }
    const baseNorm = inputs.map(c => ({
      x: sMaxX > sMinX ? (c.schematicX - sMinX) / (sMaxX - sMinX) : 0.5,
      y: sMaxY > sMinY ? (c.schematicY - sMinY) / (sMaxY - sMinY) : 0.5,
    }));

    // Structured candidates first, most useful first, because the scoring
    // stage is bounded by time and a large board does not get through them
    // all. The arrangements that route are structured - a connector moved to
    // the other side of the module, a header turned end-for-end - and uniform
    // noise is a poor way to look for those.
    const dihedral: ((p: { x: number; y: number }) => { x: number; y: number })[] = [
      p => p,
      p => ({ x: 1 - p.x, y: p.y }),
      p => ({ x: p.x, y: 1 - p.y }),
      p => ({ x: 1 - p.x, y: 1 - p.y }),
      p => ({ x: p.y, y: p.x }),
      p => ({ x: 1 - p.y, y: p.x }),
      p => ({ x: p.y, y: 1 - p.x }),
      p => ({ x: 1 - p.y, y: 1 - p.x }),
    ];
    const swaps: [number, number][] = [];
    for (let i = 0; i < inputs.length; i++) {
      for (let j = i + 1; j < inputs.length; j++) swaps.push([i, j]);
    }
    const baseRotations = inputs.map(c => c.rotationDeg);
    const structured: PlacementSeed[] = [];

    // 1. One part moved on its own into open board area - each cell of a 3x3
    // grid over the board, each way round - with the rest left where they
    // are. Reflections, turns and swaps rearrange the parts among the slots
    // the schematic already uses; none of them can express this, and it is
    // the move that fixes a connector sitting on the wrong side of a module.
    for (let i = 0; i < inputs.length; i++) {
      for (let gy = 0; gy < 3; gy++) {
        for (let gx = 0; gx < 3; gx++) {
          const at = { x: gx / 2, y: gy / 2 };
          if (Math.abs(at.x - baseNorm[i].x) < 0.05 && Math.abs(at.y - baseNorm[i].y) < 0.05) continue;
          for (const rot of ROTATIONS) {
            structured.push({
              norm: baseNorm.map((n, k) => (k === i ? at : { ...n })),
              rotations: baseRotations.map((r, k) => (k === i ? rot : r)),
            });
          }
        }
      }
    }
    // 2. One part turned in place. A quarter turn decides whether a
    // connector's pins escape towards what they connect to or away from it;
    // a half turn puts pin 1 at the other end of the strip, which decides
    // which way its traces have to wrap.
    for (let i = 0; i < inputs.length; i++) {
      for (let q = 1; q < 4; q++) {
        structured.push({
          norm: baseNorm.map(n => ({ ...n })),
          rotations: baseRotations.map((r, k) => (k === i ? turned(r, q) : r)),
        });
      }
    }
    // 3. Two parts swapped between their slots.
    for (const [i, j] of swaps) {
      const norm = baseNorm.map(n => ({ ...n }));
      [norm[i], norm[j]] = [norm[j], norm[i]];
      structured.push({ norm, rotations: [...baseRotations] });
    }
    // 4. The whole layout reflected or turned, with and without every part
    // turned a quarter turn along with it, then combined with the swaps.
    for (const d of dihedral.slice(1)) {
      for (let q = 0; q < 4; q++) {
        structured.push({ norm: baseNorm.map(d), rotations: baseRotations.map(r => turned(r, q)) });
      }
    }
    for (const d of dihedral.slice(1)) {
      for (const [i, j] of swaps) {
        const norm = baseNorm.map(d);
        [norm[i], norm[j]] = [norm[j], norm[i]];
        structured.push({ norm, rotations: [...baseRotations] });
      }
    }

    // Scoring is one pass of the router on a coarse grid, so it is cheap next
    // to the real thing but not free, and its cost grows with the board. The
    // stage is bounded by a share of the routing budget: a small board gets
    // through every structured candidate and a few hundred random ones, a
    // large one gets the structured candidates it has time for, in the order
    // above, and the preview stays responsive either way.
    const scoreDeadline = Date.now() + Math.max(1000, Math.max(0, options.routingBudgetMs) * 0.5);
    const shortlist: { seed: PlacementSeed; trial: PlacementInput[]; spread: number; score: number }[] = [];
    for (let k = 0; k < candidateCount + structured.length; k++) {
      if (Date.now() > scoreDeadline) break;
      const seed: PlacementSeed = k < structured.length
        ? structured[k]
        : {
            norm: inputs.map(() => ({ x: rng(), y: rng() })),
            rotations: inputs.map(c => turned(c.rotationDeg, Math.floor(rng() * 4))),
          };
      const trial = inputs.map((c, i) => rotate(c, seed.rotations[i]));
      // Warnings are thrown away here: these are hypotheticals, and only the
      // arrangement that actually gets used should have anything to say.
      const placedAt = placeCandidate(trial, seed);
      if (!placedAt) continue;
      const { probe, spread } = placedAt;
      shortlist.push({
        seed,
        trial,
        spread,
        score: scorePlacement(probe.placed, nets, {
          ...options,
          boardWidthMm: probe.boardWidthMm,
          boardHeightMm: probe.boardHeightMm,
        }),
      });
    }
    shortlist.sort((a, b) => a.score - b.score);

    // Refine the best few by hill-climbing: move one part at a time, keep the
    // move if the score improves. Scoring is cheap next to routing.
    const refined: typeof shortlist = [];
    const refineEachMs = 1500 / Math.max(1, routeTop * 2);
    for (const start of shortlist.slice(0, routeTop * 2)) {
      // Per candidate, not shared: one deadline for the whole loop meant the
      // first starting point consumed it and every other one was returned
      // unrefined.
      const refineDeadline = Date.now() + refineEachMs;
      let cur = start;
      while (Date.now() < refineDeadline) {
        const i = Math.floor(rng() * inputs.length);
        const seed: PlacementSeed = {
          norm: cur.seed.norm.map((n, k) => (k === i ? { x: rng(), y: rng() } : n)),
          rotations: cur.seed.rotations.map((r, k) =>
            k === i && rng() < 0.4 ? turned(r, 1 + Math.floor(rng() * 3)) : r
          ),
        };
        const trial = inputs.map((c, k) => rotate(c, seed.rotations[k]));
        const placedAt = placeCandidate(trial, seed);
        if (!placedAt) continue;
        const { probe, spread } = placedAt;
        const score = scorePlacement(probe.placed, nets, {
          ...options,
          boardWidthMm: probe.boardWidthMm,
          boardHeightMm: probe.boardHeightMm,
        });
        if (score < cur.score) cur = { seed, trial, spread, score };
      }
      refined.push(cur);
    }
    refined.sort((a, b) => a.score - b.score);

    // Second stage: route the best of the shortlist coarsely with the real
    // router, and rank on that. The cheap score has done its job by now -
    // rejected the packings with no room and put the plausible ones first -
    // but it cannot separate a board that routes from one that nearly does,
    // and a wrong pick here costs a full routing pass.
    // The refined few, then the best of the rest of the shortlist as scored.
    const coarsePool = [...refined, ...shortlist.slice(refined.length, routeTop * 4)];
    const coarseBudget = Math.max(100, Math.min(400, options.routingBudgetMs / 20));
    const ranked = coarsePool.map(cand => {
      const probe = placeComponents(cand.trial, options, [], cand.spread, cand.seed);
      const coarse = coarseRoutability(
        probe.placed, probe.boardWidthMm, probe.boardHeightMm, nets, options, coarseBudget
      );
      return { ...cand, coarse };
    });
    ranked.sort((a, b) =>
      b.coarse.completion - a.coarse.completion ||
      a.coarse.unrouted - b.coarse.unrouted ||
      a.score - b.score
    );
    shortlist.length = 0;
    shortlist.push(...ranked);

    // Each shortlisted candidate is routed on the same budget the baseline had,
    // for the same reason the jumper search is: a candidate scored on a shorter
    // run is being measured on its budget, not its placement.
    const searchDeadline = Date.now() + Math.max(0, options.routingBudgetMs) * routeTop;
    for (const cand of shortlist.slice(0, routeTop)) {
      if (Date.now() > searchDeadline) break;
      const attempt = placeAndRoute(
        cand.trial,
        nets,
        options,
        Math.max(0, options.routingBudgetMs),
        undefined,
        cand.spread,
        cand.seed
      );
      const beats =
        attempt.overlaps < best.overlaps ||
        (attempt.overlaps === best.overlaps &&
          attempt.routing.completion > best.routing.completion);
      if (beats) best = attempt;
      if (best.overlaps === 0 && best.routing.completion >= 1) break;
    }
  }

  const { placed, pads, cutouts, routing } = best!;
  let { boardWidthMm, boardHeightMm } = best!;
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

  return finishLayout(
    {
      placed,
      pads,
      cutouts,
      traces: routing.traces.map((t: RoutedTrace) => ({
        netId: t.netId,
        points: t.points,
        width: t.widthMm,
        layer: t.layer ?? 'top',
      })),
      vias: routing.vias,
      unrouted: routing.unrouted,
      completion: routing.completion,
      nets,
      boardWidthMm,
      boardHeightMm,
      boardOriginMm,
      violations,
      warnings,
    },
    options,
    layoutBoardKey(nodes, edges, options)
  );
}

/**
 * The board, as placement and routing decided it, before any of it is turned
 * into copper — and before the single-sided assembly mirror, which is applied
 * when copper is built rather than being baked in here.
 *
 * This is the boundary between the expensive half of the pipeline and the
 * cheap one. Everything above it — placement, the placement search, the maze
 * router, the auto-jumper hunt — is a search against a wall-clock budget, so
 * it answers differently on a fast desktop than on a slow laptop. Everything
 * below it is arithmetic: the same core yields the same copper, the same
 * toolpaths and the same program, on any machine, every time.
 *
 * That is what makes it the thing worth saving. A board laid out once travels
 * as a few tens of kilobytes of this and is rebuilt exactly, rather than being
 * re-searched somewhere it would come out worse.
 */
export interface LayoutCore {
  placed: PlacedComponent[];
  pads: PlacedPad[];
  cutouts: BoardCutout[];
  traces: TraceSegment[];
  vias?: RouteVia[];
  unrouted: UnroutedConnection[];
  completion: number;
  nets: PcbNet[];
  boardWidthMm: number;
  boardHeightMm: number;
  boardOriginMm: number;
  /** Everything placement and routing had to say, before copper. */
  violations: DrcViolation[];
  warnings: string[];
}

/**
 * A routed board, stored so another machine does not have to route it again.
 *
 * `boardKey` is the guard, and the whole reason keeping one is safe: it
 * fingerprints the circuit and every option that can move a feature, so a
 * snapshot can only ever be replayed onto the board it came from. Edit a
 * component, change the trace width, and the key stops matching and the router
 * runs — because the alternative, milling yesterday's copper for today's
 * schematic, is a board that is wrong in a way nobody can see until it is
 * assembled.
 */
export interface PcbLayoutSnapshot {
  version: number;
  boardKey: string;
  core: LayoutCore;
}

/**
 * Bumped when {@link LayoutCore} changes shape — and once because the code
 * that wrote it was wrong.
 *
 * Version 1 is refused rather than read for the second reason. The first
 * version of the hand-placement move accepted a board whose re-route had
 * dropped a connection, and a saved one of those goes on being restored for
 * exactly as long as the circuit and the settings stay put — the fix cannot
 * reach a board that has already been written. Nothing is lost that cannot be
 * recomputed: a discarded snapshot costs one routing pass, and hand placements
 * live in the options rather than in here, so they are re-applied to whatever
 * the router comes back with.
 */
export const SNAPSHOT_VERSION = 2;

/**
 * Copper, toolpaths, drills and the program, from a board already decided.
 *
 * Split out of {@link generatePcbLayout} so a snapshot can re-enter the
 * pipeline exactly where the router left off, rather than through a second
 * implementation that would drift from this one.
 */
function finishLayout(
  core: LayoutCore,
  options: PcbOptions,
  boardKey: string
): PcbLayoutResult {
  /*
   * Everything below works on a copy, and the caller's `core` — the board
   * before the mirror — is what the result carries as its snapshot.
   *
   * Both halves of that are load-bearing. The mirror stage rewrites
   * coordinates in place, so working on the caller's object would reflect a
   * stored snapshot every time it was replayed.
   *
   * And the snapshot has to be taken before the mirror, not after, because
   * reflecting a finished board and building one from reflected geometry are
   * not the same operation. The copper flood advances in discrete steps,
   * clipping each against where its neighbours stood, and Clipper resolves
   * those boundaries on an integer grid — so mirrored inputs round
   * differently and yield different copper, different isolation paths and a
   * different program. Captured here, a restore runs the same arithmetic on
   * the same numbers.
   */
  const work: LayoutCore = structuredClone(core);
  const {
    placed,
    pads,
    cutouts,
    traces,
    nets,
    boardWidthMm,
    boardHeightMm,
    boardOriginMm,
  } = work;
  const vias = work.vias;
  // Copied rather than appended to: `core` is what a snapshot is made of, and
  // a restore that folded this stage's findings back into it would accumulate
  // a fresh set of the same DRC messages every time the board was reopened.
  const violations: DrcViolation[] = [...work.violations];
  const warnings: string[] = [...work.warnings];
  const compById = new Map(placed.map(c => [c.id, c]));
  const padMargin = Math.max(0, options.padMarginMm ?? 0);
  const isTwoLayer = options.layers === 2;

  for (const u of work.unrouted) {
    violations.push({
      severity: 'error',
      message:
        `Net ${u.netId}: could not route ${u.from} to ${u.to} — ${u.reason}. ` +
        (isTwoLayer ? '' : `A single-layer board may need a wire jumper here.`),
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
  let copperByNetBottom = new Map<string, Poly[]>();
  const addCopperTop = (netId: string, polys: Poly[]) => {
    copperByNet.set(netId, (copperByNet.get(netId) || []).concat(polys));
  };
  const addCopperBottom = (netId: string, polys: Poly[]) => {
    copperByNetBottom.set(netId, (copperByNetBottom.get(netId) || []).concat(polys));
  };
  // Tracks and vias, without the pads: what the flood below grows from.
  const trackByNetTop = new Map<string, Poly[]>();
  const trackByNetBottom = new Map<string, Poly[]>();
  const addTrackTop = (netId: string, polys: Poly[]) => {
    addCopperTop(netId, polys);
    trackByNetTop.set(netId, (trackByNetTop.get(netId) || []).concat(polys));
  };
  const addTrackBottom = (netId: string, polys: Poly[]) => {
    addCopperBottom(netId, polys);
    trackByNetBottom.set(netId, (trackByNetBottom.get(netId) || []).concat(polys));
  };

  for (const pad of pads) {
    if (!pad.netId) continue;
    const comp = compById.get(pad.componentId)!;
    const poly = padPolygon(pad, comp.rotationDeg, effectivePadMarginMm(comp.footprint, padMargin));
    const isTht = pad.spec.drillDiameter && pad.spec.drillDiameter > 0;
    addCopperTop(pad.netId, [poly]);
    if (isTwoLayer && isTht) {
      addCopperBottom(pad.netId, [poly]);
    }
  }
  for (const trace of traces) {
    const polys = strokeToPoly(trace.points, trace.width);
    if (isTwoLayer && trace.layer === 'bottom') {
      addTrackBottom(trace.netId, polys);
    } else {
      addTrackTop(trace.netId, polys);
    }
  }

  if (isTwoLayer && vias) {
    const viaPadR = (options.viaPadMm ?? 1.4) / 2;
    for (const v of vias) {
      const poly = circlePoly(v.x, v.y, viaPadR);
      addTrackTop(v.netId, [poly]);
      addTrackBottom(v.netId, [poly]);
    }
  }

  for (const [netId, polys] of copperByNet) {
    copperByNet.set(netId, unionPolys(polys));
  }
  for (const [netId, polys] of trackByNetTop) {
    trackByNetTop.set(netId, unionPolys(polys));
  }
  if (isTwoLayer) {
    for (const [netId, polys] of copperByNetBottom) {
      copperByNetBottom.set(netId, unionPolys(polys));
    }
    for (const [netId, polys] of trackByNetBottom) {
      trackByNetBottom.set(netId, unionPolys(polys));
    }
  }

  // 5b. Copper flood ----------------------------------------------------
  // Everything outside the nominal trace is about to be milled away, so any gap
  // wider than the bit's channel is copper thrown out for nothing. Grow it back.
  const floodBudgetMm = Math.max(0, options.copperFloodMm ?? 0);
  // The flood stops at the pad relief and the isolation stage clears it, so
  // both have to work from the same width — and it is the width the mill can
  // actually produce, not the one that was typed in.
  const padRelief = padReliefPlan(
    options.padClearanceMm ?? 0,
    effectiveToolDiaMm,
    floodBudgetMm
  );
  const isolationPassCount = Math.max(
    Math.max(1, Math.min(3, options.isolationPasses)),
    1 + padRelief.passes
  );
  // The outermost relief pass reaches exactly padRelief.clearanceMm from the
  // pad. Holding the flood off by that same figure leaves the two edges
  // coincident and lets Clipper's rounding decide whether a hair of copper
  // survives between them, so the flood stops a channel margin short and the
  // last pass overlaps it — the same trade the channel itself makes.
  const padReliefFloodMm =
    padRelief.clearanceMm > 0
      ? Math.max(0, padRelief.clearanceMm - Math.max(0, options.channelMarginMm ?? 0.05))
      : 0;
  // Every pad, netted or not, gets a solderable ring of laminate around it.
  // Held out here because the isolation stage needs to know where those rings
  // are in order to cut them.
  const solderPadsTop: Poly[] = [];
  const solderPadsBottom: Poly[] = [];
  const solderPadsByNetTop = new Map<string, Poly[]>();
  const solderPadsByNetBottom = new Map<string, Poly[]>();
  let appliedFloodMm = 0;
  if (floodBudgetMm > 0 && copperByNet.size > 0) {
    // A pad with no net is never isolated, so it is not copper to grow — but
    // flooding across one would bury a hole that still has to be soldered.
    const blockersTop: Poly[] = [];
    const blockersBottom: Poly[] = [];
    for (const pad of pads) {
      const comp = compById.get(pad.componentId);
      if (!comp) continue;
      const poly = padPolygon(pad, comp.rotationDeg, effectivePadMarginMm(comp.footprint, padMargin));
      const isTht = pad.spec.drillDiameter && pad.spec.drillDiameter > 0;
      solderPadsTop.push(poly);
      if (isTwoLayer && isTht) solderPadsBottom.push(poly);
      if (pad.netId) {
        solderPadsByNetTop.set(pad.netId, [...(solderPadsByNetTop.get(pad.netId) ?? []), poly]);
        if (isTwoLayer && isTht) {
          solderPadsByNetBottom.set(pad.netId, [...(solderPadsByNetBottom.get(pad.netId) ?? []), poly]);
        }
      }
      if (pad.netId) continue;
      blockersTop.push(poly);
      if (isTwoLayer && isTht) blockersBottom.push(poly);
    }
    // Copper over a cutout would be milled off with the slug it sits on.
    for (const co of cutouts) {
      const poly = co.shape === 'circle'
        ? circlePoly(co.x, co.y, Math.max(co.widthMm, co.heightMm) / 2)
        : rectPoly(co.x, co.y, co.widthMm, co.heightMm);
      blockersTop.push(poly);
      if (isTwoLayer) blockersBottom.push(poly);
    }

    // Copper may not run out past the room the isolation passes need inside the
    // board edge, or the outermost ring would be commanded off the stock.
    const edgeKeepout =
      effectiveToolDiaMm +
      (isolationPassCount - 1) * effectiveToolDiaMm * ISOLATION_STEPOVER +
      0.2;
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
      blockers: blockersTop,
      pads: solderPadsTop,
      padsByNet: solderPadsByNetTop,
      seedsByNet: trackByNetTop,
      padClearanceMm: padReliefFloodMm,
      bounds,
    });
    copperByNet = flooded.copper;
    appliedFloodMm = flooded.appliedMm;

    if (isTwoLayer && copperByNetBottom.size > 0) {
      const floodedBottom = floodCopperByNet(copperByNetBottom, {
        maxFloodMm: floodBudgetMm,
        channelMm: effectiveToolDiaMm,
        channelMarginMm: Math.max(0, options.channelMarginMm ?? 0.05),
        blockers: blockersBottom,
        pads: solderPadsBottom,
        padsByNet: solderPadsByNetBottom,
        seedsByNet: trackByNetBottom,
        padClearanceMm: padReliefFloodMm,
        bounds,
      });
      copperByNetBottom = floodedBottom.copper;
    }
  }

  // 5c. Unused pads ----------------------------------------------------
  // Added after the flood so they are never grown - they were blockers to it -
  // but before the isolation pass, which is what actually cuts them free of the
  // surrounding foil. Keyed apart from real nets so the DRC below reports a
  // clash against one by name.
  if (options.isolateUnusedPads !== false) {
    for (const pad of pads) {
      if (pad.netId) continue;
      const comp = compById.get(pad.componentId);
      if (!comp) continue;
      const poly = padPolygon(pad, comp.rotationDeg, effectivePadMarginMm(comp.footprint, padMargin));
      const isTht = pad.spec.drillDiameter && pad.spec.drillDiameter > 0;
      copperByNet.set(`unused:${pad.componentId}-${pad.pinNumber}`, [poly]);
      if (isTwoLayer && isTht) {
        copperByNetBottom.set(`unused:${pad.componentId}-${pad.pinNumber}`, [poly]);
      }
    }
  }

  // 5d. Seal the cracks -------------------------------------------------
  // The flood advances in discrete steps and clips each one against where the
  // neighbours stood when the step began, so two fronts of the *same* net
  // coming round opposite sides of an obstacle meet along a boundary Clipper
  // rounds to its micron grid. What is left is a hairline: a sliver of
  // "laminate" straight through a conductor, a few microns wide.
  //
  // No bit can cut it. A gap narrower than the channel is one the mill will
  // never open, so a model that contains one describes a board nobody can
  // make - and every consumer of that model is then wrong in the same way:
  // the preview draws a severed trace, the Gerber exports one, and the
  // isolation pass wastes a plunge trying to run down it.
  //
  // Copper is only ever added, and never closer to another net than the
  // flood's own channel allows, so this cannot bridge two nets - it can only
  // make one net whole.
  const sealCracks = (copperMap: Map<string, Poly[]>) => {
    const closeMm = effectiveToolDiaMm / 2;
    const keepClear = effectiveToolDiaMm + 2 * Math.max(0, options.channelMarginMm ?? 0.05);
    for (const [netId, polys] of [...copperMap]) {
      const closed = offsetPolys(offsetPolys(polys, closeMm), -closeMm);
      if (closed.length === 0) continue;
      const others: Poly[] = [];
      for (const [otherId, otherPolys] of copperMap) {
        if (otherId !== netId) others.push(...otherPolys);
      }
      const forbidden = others.length > 0 ? offsetPolys(unionPolys(others), keepClear) : [];
      const filled = forbidden.length > 0 ? differencePolys(closed, forbidden) : closed;
      copperMap.set(netId, unionPolys([...polys, ...filled]));
    }
  };
  sealCracks(copperByNet);
  if (isTwoLayer) sealCracks(copperByNetBottom);

  // 6. Design rule check: no two nets' copper may touch, on either layer.
  const checkOverlaps = (copperMap: Map<string, Poly[]>, layerLabel: string) => {
    const list = [...copperMap.keys()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (polysOverlap(copperMap.get(list[i])!, copperMap.get(list[j])!, 1e-5)) {
          violations.push({
            severity: 'error',
            message: `Short circuit on ${layerLabel}: copper for ${list[i]} touches ${list[j]}.`,
          });
        }
      }
    }
  };
  checkOverlaps(copperByNet, isTwoLayer ? 'Top Layer' : 'board');
  if (isTwoLayer) checkOverlaps(copperByNetBottom, 'Bottom Layer');

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

  const computePassesFor = (
    copperMap: Map<string, Poly[]>,
    layerPads: Poly[],
    start: Pt
  ): IsolationPath[] => {
    const paths: IsolationPath[] = [];
    const stepover = effectiveToolDiaMm * ISOLATION_STEPOVER;
    const passes = Math.max(1, Math.min(3, options.isolationPasses));
    // Where the relief passes are allowed to cut. Beyond it the board is
    // either already bare or belongs to the flood, and a pass taken right
    // round the net there is minutes of cutting for nothing. The zone is the
    // ring grown by a tool radius because what is clipped to it is the
    // cutter's centreline: stopped where the centreline leaves the ring, the
    // cut's outer edge stops a radius short, and beside the track feeding the
    // pad that leaves a wedge of foil inside the ring.
    const reliefZone =
      padRelief.passes > 0 && layerPads.length > 0
        ? offsetPolys(unionPolys(layerPads), padRelief.clearanceMm + toolRadius)
        : [];
    const totalPasses = reliefZone.length > 0 ? isolationPassCount : passes;

    for (const [netId, copper] of copperMap) {
      // Copper belonging to every other net, grown by a tool radius. The cutter
      // centre may never enter this region or it would bite into a live trace.
      const others: Poly[] = [];
      for (const [otherId, otherCopper] of copperMap) {
        if (otherId !== netId) others.push(...otherCopper);
      }
      const forbidden = others.length > 0 ? offsetPolys(unionPolys(others), toolRadius) : [];

      for (let pass = 0; pass < totalPasses; pass++) {
        const loop = offsetPolys(copper, toolRadius + pass * stepover);
        const safe = forbidden.length > 0 ? differencePolys(loop, forbidden) : loop;
        for (const ring of safe) {
          if (ring.length < 3) continue;
          if (pass < passes) {
            paths.push({ netId, pass, points: [...ring, ring[0]] });
            continue;
          }
          for (const arc of arcsInside(ring, reliefZone, toolRadius)) {
            // A stub shorter than the bit is width the neighbouring pass
            // already covered; cutting it costs a plunge and buys nothing.
            if (pathLengthMm(arc) < effectiveToolDiaMm) continue;
            paths.push({ netId, pass, points: arc });
          }
        }
      }
    }
    return sortPathsNearestNeighbor(paths, start);
  };

  const topIsolationPaths = computePassesFor(copperByNet, solderPadsTop, { x: 0, y: 0 });
  // The bottom side is cut mirrored about the board's centreline after the
  // flip pause parks the tool at X0 Y0, so in the unmirrored space these paths
  // are held in, that parking spot is the far side of the board.
  const bottomIsolationPaths = isTwoLayer
    ? computePassesFor(copperByNetBottom, solderPadsBottom, {
        x: 2 * (boardOriginMm + boardWidthMm / 2),
        y: 0,
      })
    : [];

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

  if (isTwoLayer) {
    if (vias) {
      for (let i = 0; i < vias.length; i++) {
        const v = vias[i];
        drills.push({
          x: v.x,
          y: v.y,
          diameter: v.drillMm,
          componentId: 'via',
          pinNumber: `${i + 1}`,
          isVia: true,
        });
      }
    }

    const xMid = boardOriginMm + boardWidthMm / 2;
    const yMid = boardOriginMm + boardHeightMm / 2;
    const xSpan = boardWidthMm / 2 + REGISTRATION_PIN_OFFSET_MM;
    const regDrillMm = options.viaDrillMm ?? 0.8;
    drills.push(
      { x: xMid - xSpan, y: yMid, diameter: regDrillMm, componentId: 'align_pin_1', pinNumber: '1', isRegistration: true },
      { x: xMid + xSpan, y: yMid, diameter: regDrillMm, componentId: 'align_pin_2', pinNumber: '2', isRegistration: true }
    );
  }

  const result: PcbLayoutResult = {
    success: violations.filter(v => v.severity === 'error').length === 0,
    boardWidthMm,
    boardHeightMm,
    boardOriginMm,
    components: placed,
    pads,
    nets,
    traces,
    isolationPaths: topIsolationPaths,
    drills,
    cutouts,
    unrouted: work.unrouted,
    violations,
    warnings,
    completion: work.completion,
    effectiveToolDiaMm,
    copperFloodMm: appliedFloodMm,
    padReliefMm: padRelief.clearanceMm,
    cycleTimeSec: 0,
    travelDistanceMm: 0,
    cutDistanceMm: 0,
    svg: '',
    svgComponentSide: '',
    gcode: '',
    layers: options.layers ?? 1,
    vias,
    topTraces: traces.filter(t => t.layer !== 'bottom'),
    bottomTraces: traces.filter(t => t.layer === 'bottom'),
    topIsolationPaths,
    bottomIsolationPaths,
    copperByNet,
    bottomCopperByNet: isTwoLayer ? copperByNetBottom : undefined,
  };

  // Cut mirrored so the board reproduces this layout when it is turned over to
  // be assembled. Two-layer boards are exempt: their parts sit on the top
  // copper, which is cut first, copper-up, on the face the parts go into, and
  // the bottom pass already mirrors for its own flip.
  if (!isTwoLayer && options.mirrorSingleSided !== false) {
    mirrorLayoutInX(result);
  }

  if (!isTwoLayer && options.mirrorSingleSided === false) {
    // Turning the mirror off is legitimate - some people seat parts on the
    // copper face - but on a board with legs through it, it is nearly always a
    // mistake, and one that stays invisible until the parts are in. Said here
    // so it reaches the export panel and every MCP caller, instead of living in
    // documentation somebody has to already suspect they need.
    const throughHole = result.drills.filter(d => !d.isVia && !d.isRegistration);
    if (throughHole.length > 0) {
      const parts = new Set(throughHole.map(d => d.componentId));
      result.warnings.push(
        `Mirror is off and this board has ${throughHole.length} through-hole pad(s) ` +
        `across ${parts.size} part(s). Parts are inserted from the bare face and ` +
        `soldered to the copper, so they will seat MIRRORED: an inline header ` +
        `reverses end-for-end, and a two-row module drops each row into the other ` +
        `row's holes. Turn the mirror back on unless you are seating parts on the ` +
        `copper face.`
      );
    }
  }

  result.svg = renderPcbSvg(result, copperByNet, options, 'copper');
  result.svgComponentSide = renderPcbSvg(result, copperByNet, options, 'component');
  if (isTwoLayer) {
    result.svgBottomSide = renderPcbSvg(result, copperByNetBottom, options, 'bottom');
    result.svgComposite = renderPcbSvg(result, copperByNet, options, 'composite', copperByNetBottom);
  }
  result.snapshot = { version: SNAPSHOT_VERSION, boardKey, core };
  return withGcodeFor(result, options);
}

/**
 * Copper, toolpaths, drills, previews and the program, from a board already
 * decided — the public door onto {@link finishLayout}.
 *
 * For a caller that has edited a {@link LayoutCore} itself, which today means
 * an incremental move. `boardKey` is what the rebuilt board will be saved and
 * matched under, so it has to be the fingerprint of the circuit and the
 * options this core belongs to, overrides included.
 */
export function rebuildLayoutFromCore(
  core: LayoutCore,
  userOptions: Partial<PcbOptions> | undefined,
  boardKey: string
): PcbLayoutResult {
  return finishLayout(core, { ...DEFAULT_PCB_OPTIONS, ...userOptions }, boardKey);
}

/**
 * Whether a finished board is drawn as the mirror of its core.
 *
 * A single-sided board is cut mirrored so it reads correctly once turned over
 * to be assembled, so everything in a {@link PcbLayoutResult} for such a board
 * is the reflection of what the core holds. Anything mapping a position in the
 * result back onto the core — a part dragged in the preview, for one — has to
 * undo that first.
 */
export function layoutIsMirrored(options: Partial<PcbOptions>): boolean {
  return (options.layers ?? 1) !== 2 && options.mirrorSingleSided !== false;
}

/**
 * Rebuilds a board from a saved layout, for the current options.
 *
 * Nothing is searched: the placement and the routes are read back as they
 * were, and only the arithmetic below them is run again — copper, isolation
 * toolpaths, drills, previews and the program. So a board laid out on a fast
 * machine mills identically on a slow one, and the feeds, depths and tabs it
 * is milled with are today's rather than the ones it happened to be routed
 * under.
 *
 * Returns null for a snapshot this build cannot read, or one belonging to a
 * different board. The caller routes from scratch in that case; it must never
 * fall back to milling this.
 */
export function restorePcbLayout(
  snapshot: PcbLayoutSnapshot | undefined | null,
  nodes: Node[],
  edges: Edge[],
  userOptions?: Partial<PcbOptions>
): PcbLayoutResult | null {
  if (!snapshot || snapshot.version !== SNAPSHOT_VERSION || !snapshot.core) return null;
  const options: PcbOptions = { ...DEFAULT_PCB_OPTIONS, ...userOptions };
  if (snapshot.boardKey !== layoutBoardKey(nodes, edges, options)) return null;
  return finishLayout(snapshot.core, options, snapshot.boardKey);
}

/**
 * Options that change the G-code a layout is emitted as, but not the layout.
 *
 * Feeds, spindle speed, retract heights, cut depths, tab counts, which drill
 * you actually own — none of them move a trace, a pad, a hole or the board
 * outline by a micron. They were nonetheless part of the identity of a layout
 * request, so nudging the spindle RPM threw away a routed board and paid for a
 * full place-and-route to get an identical one back: on the densest preset
 * here, seventeen seconds to change a number that only ever reaches an `S`
 * word. Re-emitting instead takes about four milliseconds.
 *
 * This is an allowlist rather than a list of the options that *do* matter, and
 * deliberately so: an option nobody has classified yet falls through to a full
 * re-route, which is merely slow. Getting it wrong the other way would serve a
 * stale board. `reusesLayoutAcross` in the exporter tests holds every entry
 * here to that promise by laying the board out both ways and comparing
 * everything except the G-code.
 */
export const GCODE_ONLY_OPTIONS = [
  'cutFeedrate',
  'travelFeedrate',
  'plungeFeedrate',
  'drillFeedrate',
  'spindleRpm',
  'safeZ',
  'toolChangeZ',
  'drillDepthZ',
  'profileDepthZ',
  'zStepdown',
  'tabCount',
  'tabWidthMm',
  'tabHeightMm',
  'pauseOnToolChange',
  'rampedPlunge',
  'breakThroughMm',
  'boardThicknessMm',
  'drillBitOverridesMm',
  'drillConsolidationMm',
  'airCutZOffset',
] as const satisfies readonly (keyof PcbOptions)[];

/**
 * Fields of a result that are derived from its G-code rather than from the
 * placement and the route. These are what {@link reemitPcbGcode} rewrites, and
 * what the allowlist test excludes when it compares two layouts.
 */
export const GCODE_DERIVED_FIELDS = [
  'gcode',
  'cycleTimeSec',
  'travelDistanceMm',
  'cutDistanceMm',
] as const satisfies readonly (keyof PcbLayoutResult)[];

/** Emits `result`'s G-code and its derived metrics under `options`, in place. */
function withGcodeFor(result: PcbLayoutResult, options: PcbOptions): PcbLayoutResult {
  result.gcode = generatePcbGcode(result, options);
  const metrics = estimatePcbMachiningMetrics(result.gcode, options);
  result.cycleTimeSec = metrics.cycleTimeSec;
  result.travelDistanceMm = metrics.travelDistanceMm;
  result.cutDistanceMm = metrics.cutDistanceMm;
  return result;
}

/**
 * Re-emits a finished layout's G-code under different options, without routing
 * it again. Only sound for a change confined to {@link GCODE_ONLY_OPTIONS}.
 *
 * A placeholder result — an empty circuit, or a layout that failed for a reason
 * of its own — is handed back untouched: it carries an explanatory G-code
 * comment rather than a program, and running the emitter over it would replace
 * that with something that looks like output.
 */
export function reemitPcbGcode(
  result: PcbLayoutResult,
  userOptions?: Partial<PcbOptions>
): PcbLayoutResult {
  if (result.components.length === 0) return result;
  return withGcodeFor({ ...result }, { ...DEFAULT_PCB_OPTIONS, ...userOptions });
}

interface LayoutAttempt {
  placed: PlacedComponent[];
  boardWidthMm: number;
  boardHeightMm: number;
  /** Pairs of courtyards the relaxation could not pull apart. */
  overlaps: number;
  pads: PlacedPad[];
  cutouts: BoardCutout[];
  routing: ReturnType<typeof routeBoard>;
  violations: DrcViolation[];
  warnings: string[];
}

/**
 * Everything the router needs to know about a placed board: each pad bound to
 * its net, the pins to join, and the copper that belongs to no net and must
 * be kept clear of. Shared by the real routing pass and the coarse one the
 * placement search uses to rank its shortlist, so the two see the same board.
 */
function routingProblem(
  placed: PlacedComponent[],
  nets: PcbNet[],
  opts: PcbOptions,
  violations: DrcViolation[]
): { pads: PlacedPad[]; routePins: RoutePin[]; obstacles: RouteObstacle[]; cutouts: BoardCutout[] } {
  const compById = new Map(placed.map(c => [c.id, c]));
  // Grown pad copper has to reach the router too, or a trace gets planned
  // through the annulus the margin just added.
  const padMargin = Math.max(0, opts.padMarginMm ?? 0);

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

  const routePins: RoutePin[] = [];
  for (const net of nets) {
    for (const port of net.ports) {
      const pad = padByPort.get(port.key);
      if (!pad) continue;
      const comp = compById.get(pad.componentId)!;
      const { w, h } = padOffset(pad.spec, comp.rotationDeg);
      const isTht = pad.spec.drillDiameter && pad.spec.drillDiameter > 0;
      routePins.push({
        netId: net.id,
        key: port.key,
        componentId: pad.componentId,
        x: pad.x,
        y: pad.y,
        padRadiusMm:
          Math.max(w, h) / 2 + effectivePadMarginMm(comp.footprint, padMargin),
        layer: isTht ? 'both' : 'top',
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
      const isTht = p.spec.drillDiameter && p.spec.drillDiameter > 0;
      // Same margin the copper is grown by, or the router would happily run a
      // trace through the annulus this pad just gained.
      return {
        x: p.x,
        y: p.y,
        radiusMm: Math.max(w, h) / 2 + effectivePadMarginMm(comp.footprint, padMargin),
        layer: isTht ? 'both' : 'top',
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

  return { pads, routePins, obstacles, cutouts };
}

/**
 * The real router, run coarsely: a grid one track pitch wide and a budget of
 * a fraction of a second. This is the second stage of the placement search,
 * between the cheap score and the full routing pass.
 *
 * The cheap score is one ordering pass, and one pass cannot tell a board that
 * routes from one that very nearly does - the difference is often one net
 * that needs several others to move first, which is what the router's other
 * orderings and its rip-up passes are for. At one cell per track it sees the
 * same corridors the full pass will, at a tenth of the cells. Measured on
 * fifteen arrangements of one carrier board it put the two that route at the
 * top, both at a completion of exactly 1, where one pass had them at 0.846.
 */
export function coarseRoutability(
  placed: PlacedComponent[],
  boardWidthMm: number,
  boardHeightMm: number,
  nets: PcbNet[],
  opts: PcbOptions,
  budgetMs: number
): { completion: number; unrouted: number } {
  const { routePins, obstacles } = routingProblem(placed, nets, opts, []);
  const r = routeBoard(routePins, {
    ...coarseRouterOptions(opts, boardWidthMm, boardHeightMm),
    obstacles,
    budgetMs,
  });
  return { completion: r.completion, unrouted: r.unrouted.length };
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
  spreadScale = 1,
  seed?: PlacementSeed
): LayoutAttempt {
  const violations: DrcViolation[] = [];
  const warnings: string[] = [];
  // Grown pad copper has to reach the router too, or a trace gets planned
  // through the annulus the margin just added.
  const padMargin = Math.max(0, opts.padMarginMm ?? 0);

  const { placed, boardWidthMm, boardHeightMm, overlaps } =
    placeComponents(inputs, opts, warnings, spreadScale, seed);
  const { pads, routePins, obstacles, cutouts } = routingProblem(placed, nets, opts, violations);

  const routerOpts = {
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
    layers: opts.layers ?? 1,
    viaPadMm: opts.viaPadMm,
    viaDrillMm: opts.viaDrillMm,
  };

  let routing = routeBoard(routePins, routerOpts);

  // Auto-jumpers. A single layer cannot carry one net across another, so once
  // the router has genuinely run out of options the only remaining moves are a
  // different placement or a wire soldered over the top. This is the wire: pads
  // are placed for it, both halves are routed to them, and the link between
  // them is declared to the router rather than cut in copper.
  const linkedPairs: [string, string][] = [];
  if (opts.autoJumpers && routing.unrouted.length > 0) {
    const maxJumpers = Math.max(0, Math.round(opts.maxAutoJumpers ?? 4));
    const edge = Math.max(1.0, opts.profileToolDiaMm) + Math.max(0, opts.boardMarginMm ?? 1.5);
    // Jumper search gets its own budget rather than eating the router's, and
    // every candidate is routed with the SAME budget the baseline had. Scoring
    // a candidate on a shorter run than the result it is being compared
    // against measures the budget, not the placement.
    const candidateBudgetMs = Math.max(1000, budgetMs ?? DEFAULT_ROUTING_BUDGET_MS);
    const deadline = Date.now() + candidateBudgetMs * 2;
    const MAX_CANDIDATES = 10;
    const livePins = [...routePins];

    for (let added = 0; added < maxJumpers; added++) {
      if (routing.unrouted.length === 0 || Date.now() > deadline) break;
      const fail = routing.unrouted[0];
      const from = livePins.find(p => p.key === fail.from);
      const to = livePins.find(p => p.key === fail.to);
      if (!from || !to) break;

      const footprint = generateJumperFootprint(
        Math.max(5.08, opts.traceWidthMm * 4 + opts.clearanceMm * 8),
        Math.max(0.8, opts.traceWidthMm * 2)
      );
      // Where to put it, and which net it belongs to.
      //
      // Jumpering the blocked net is the obvious move and usually the wrong
      // one: if its pad is fenced in by other traces, a wire from outside the
      // fence still cannot reach it. The move that works is to jumper whatever
      // is IN THE WAY - lift a segment of the blocking net onto a wire, and the
      // blocked net routes through the gap left underneath. So blocking nets
      // are tried first, at the point where they cross the run that failed.
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const perp = { x: -dy / len, y: dx / len };

      type Plan = { netId: string; x: number; y: number; along: { x: number; y: number } };
      const plans: Plan[] = [];


      // Every segment of every other net is a candidate to lift onto a wire,
      // not only the ones that cross the straight line between the two pads.
      // That line is a poor guide here: a pin in the middle of an 18-pin row
      // cannot escape sideways at all - the gap between adjacent pads is
      // narrower than a trace plus its clearances - so the run that failed was
      // never going to be straight, and what blocks it is whatever wraps around
      // the module, which the straight line misses entirely.
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2;
      const ranked: { plan: Plan; rank: number }[] = [];
      for (const tr of routing.traces) {
        if (tr.netId === fail.netId) continue;
        for (let i = 0; i < tr.points.length - 1; i++) {
          const p0 = tr.points[i], p1 = tr.points[i + 1];
          const cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2;
          const sx = p1.x - p0.x, sy = p1.y - p0.y;
          const sl = Math.hypot(sx, sy);
          // A jumper has to span the pad pitch to be worth fitting, so a stub
          // shorter than the footprint cannot usefully be broken here.
          if (sl < footprint.widthMm) continue;
          // Prefer segments between the two ends that could not be joined, and
          // near the midpoint of the run rather than out at the board edge.
          const rank =
            Math.hypot(cx - midX, cy - midY) +
            0.5 * Math.min(Math.hypot(cx - from.x, cy - from.y), Math.hypot(cx - to.x, cy - to.y));
          ranked.push({
            plan: { netId: tr.netId, x: cx, y: cy, along: { x: sx / sl, y: sy / sl } },
            rank,
          });
        }
      }
      ranked.sort((a, b) => a.rank - b.rank);
      plans.push(...ranked.map(r => r.plan));

      // Failing back: hop the blocked net itself out of wherever it is stuck.
      for (const anchor of [to, from]) {
        for (const r of [4, 7]) {
          for (let a = 0; a < 4; a++) {
            const th = (a * Math.PI) / 2;
            plans.push({
              netId: fail.netId,
              x: anchor.x + Math.cos(th) * r,
              y: anchor.y + Math.sin(th) * r,
              along: { x: dx / len, y: dy / len },
            });
          }
        }
      }
      for (const t of [0.5, 0.3, 0.7]) {
        plans.push({
          netId: fail.netId,
          x: from.x + dx * t,
          y: from.y + dy * t,
          along: perp,
        });
      }

      let bestTry: { res: typeof routing; comp: PlacedComponent; jpads: PlacedPad[] } | null = null;
      let tried = 0;
      for (const plan of plans) {
        if (tried >= MAX_CANDIDATES || Date.now() > deadline) break;
        // The pads straddle along `along`, so the footprint lies that way too.
        const rot: 0 | 90 = Math.abs(plan.along.x) >= Math.abs(plan.along.y) ? 0 : 90;
        const cw = rot === 90 ? footprint.heightMm : footprint.widthMm;
        const ch = rot === 90 ? footprint.widthMm : footprint.heightMm;
        const { x, y } = plan;
        if (
          x - cw / 2 < edge || x + cw / 2 > boardWidthMm - edge ||
          y - ch / 2 < edge || y + ch / 2 > boardHeightMm - edge
        ) continue;
        // Never on top of a part that is already placed.
        if (placed.some(c =>
          Math.abs(c.x - x) < (c.widthMm + cw) / 2 + 0.5 &&
          Math.abs(c.y - y) < (c.heightMm + ch) / 2 + 0.5
        )) continue;

        const comp: PlacedComponent = {
          id: `autojumper_${added + 1}`,
          name: `JP${added + 1}`,
          type: 'jumper',
          x, y,
          rotationDeg: rot,
          footprint,
          widthMm: cw,
          heightMm: ch,
          data: { autoJumper: true, netId: plan.netId },
        };
        const jpads: PlacedPad[] = footprint.pads.map(spec => {
          const o = padOffset(spec, rot);
          return {
            componentId: comp.id,
            handleId: String(spec.pinNumber),
            pinNumber: spec.pinNumber,
            netId: plan.netId,
            x: x + o.dx,
            y: y + o.dy,
            spec,
          };
        });
        const jpins: RoutePin[] = jpads.map(pad => {
          const o = padOffset(pad.spec, rot);
          return {
            netId: plan.netId,
            key: `${comp.id}-${pad.pinNumber}`,
            componentId: comp.id,
            x: pad.x,
            y: pad.y,
            padRadiusMm: Math.max(o.w, o.h) / 2 + effectivePadMarginMm(footprint, padMargin),
          };
        });

        tried++;
        const res = routeBoard([...livePins, ...jpins], {
          ...routerOpts,
          budgetMs: candidateBudgetMs,
          onProgress: undefined,
          linkedPairs: [...linkedPairs, [jpins[0].key, jpins[1].key] as [string, string]],
        });

        // Judged on how many connections still fail, not on the completion
        // percentage: adding a jumper adds a connection, so the percentage
        // moves for reasons that have nothing to do with whether the board got
        // closer to being buildable.
        const better =
          res.unrouted.length < routing.unrouted.length &&
          (!bestTry || res.unrouted.length < bestTry.res.unrouted.length);
        if (better) {
          bestTry = { res, comp, jpads };
          if (res.unrouted.length === 0) break;
        }
      }

      // No position helped, so another jumper for the same crossing will not
      // help either — stop rather than burn the budget proving it again.
      if (!bestTry) break;

      placed.push(bestTry.comp);
      pads.push(...bestTry.jpads);
      livePins.push(
        ...bestTry.jpads.map(pad => {
          const o = padOffset(pad.spec, bestTry!.comp.rotationDeg);
          return {
            netId: pad.netId!,
            key: `${bestTry!.comp.id}-${pad.pinNumber}`,
            componentId: bestTry!.comp.id,
            x: pad.x,
            y: pad.y,
            padRadiusMm:
              Math.max(o.w, o.h) / 2 + effectivePadMarginMm(bestTry!.comp.footprint, padMargin),
          };
        })
      );
      linkedPairs.push([
        `${bestTry.comp.id}-${bestTry.jpads[0].pinNumber}`,
        `${bestTry.comp.id}-${bestTry.jpads[1].pinNumber}`,
      ]);
      routing = bestTry.res;
      warnings.push(
        `Added wire jumper ${bestTry.comp.name} for ${fail.netId} (${fail.from} to ${fail.to}) — ` +
        `solder a link across its two pads after milling.`
      );
    }
  }

  return { placed, boardWidthMm, boardHeightMm, overlaps, pads, cutouts, routing, violations, warnings };
}

/** A well-formed but empty layout, used for errors and as a placeholder. */
export function emptyPcbLayout(
  userOptions?: Partial<PcbOptions>,
  error = 'No layout yet.'
): PcbLayoutResult {
  return emptyResult({ ...DEFAULT_PCB_OPTIONS, ...userOptions }, error);
}

function emptyResult(options: PcbOptions, error: string): PcbLayoutResult {
  const emptySvg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${options.boardWidthMm} ` +
    `${options.boardHeightMm}" width="100%" height="100%"></svg>`;
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
    padReliefMm: 0,
    cycleTimeSec: 0,
    travelDistanceMm: 0,
    cutDistanceMm: 0,
    svg: emptySvg,
    svgComponentSide: emptySvg,
    gcode: `; ${error}\n`,
    error,
    copperByNet: new Map(),
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const NET_COLORS = [
  '#d4af37', '#4fc3f7', '#ba68c8', '#ff8a65',
  '#81c784', '#f06292', '#9575cd', '#4db6ac',
];

/**
 * Which face of the finished board the preview is drawn from.
 *
 * The mill cuts a single-sided board copper-up, and the parts go in from the
 * other face - so the picture you check the toolpath against and the picture
 * you assemble against are mirror images of each other. Keeping both available,
 * clearly labelled, is the point: a footprint that only looks right from the
 * side you never checked is how a board reaches the soldering iron wrong.
 */
export type PcbViewSide = 'copper' | 'component' | 'bottom' | 'composite';

export function renderPcbSvg(
  result: PcbLayoutResult,
  copperByNet: Map<string, Poly[]>,
  options: PcbOptions,
  view: PcbViewSide = 'copper',
  copperByNetBottom?: Map<string, Poly[]>
): string {
  const w = result.boardWidthMm;
  const h = result.boardHeightMm;
  const colorFor = (netId: string, isBottom = false) => {
    // Isolated islands are not a net; showing them in a net colour would read
    // as a connection that is not there.
    if (netId.startsWith('unused:')) return '#9e9e9e';
    if (netId === 'GND') return isBottom ? '#0284c7' : '#8d6e63';
    const idx = result.nets.findIndex(n => n.id === netId);
    if (isBottom) {
      const BOTTOM_COLORS = ['#0284c7', '#06b6d4', '#3b82f6', '#6366f1', '#14b8a6', '#0ea5e9'];
      return BOTTOM_COLORS[(idx < 0 ? 0 : idx) % BOTTOM_COLORS.length];
    }
    return NET_COLORS[(idx < 0 ? 0 : idx) % NET_COLORS.length];
  };

  // Everything in the result is in program coordinates, where the board is
  // inset from the origin so the profile pass starts on X0Y0. The view has to
  // start at the origin too, or the outline falls outside it.
  const o = result.boardOriginMm;
  const vw = w + o * 2;
  const vh = h + o * 2;

  // Machine Y climbs away from the operator; SVG Y climbs down the screen.
  // Drawing program coordinates straight into the viewBox therefore published
  // a picture that was a *reflection* of the board on the bed - the far edge
  // drawn nearest. Every coordinate goes through here instead, so the copper
  // view matches the blank as clamped, and the component view is its mirror.
  // The bottom view is looked at through the board the same way, so it mirrors
  // X too.
  const flipX = view === 'component' || view === 'bottom';
  const px = (x: number) => (flipX ? vw - x : x);
  const py = (y: number) => vh - y;
  const pt = (p: Pt): Pt => ({ x: px(p.x), y: py(p.y) });
  const mapPolys = (polys: Poly[]): Poly[] => polys.map(poly => poly.map(pt));

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" width="100%" height="100%">\n`;
  svg += `  <rect x="${o}" y="${o}" width="${w}" height="${h}" fill="#1b4d2e" stroke="#2e7d42" stroke-width="0.4" rx="1.5" />\n`;

  // Copper, per net, with holes honoured.
  if (view === 'composite') {
    // 1. Bottom copper layer
    const bMap = copperByNetBottom || new Map();
    for (const [netId, polys] of bMap) {
      const d = polysToSvgPath(mapPolys(polys));
      if (!d) continue;
      svg += `  <path d="${d}" fill="${colorFor(netId, true)}" fill-rule="evenodd" opacity="0.65" />\n`;
    }
    // Bottom isolation toolpaths
    if (result.bottomIsolationPaths) {
      for (const path of result.bottomIsolationPaths) {
        const pts = path.points.map(p => `${px(p.x).toFixed(3)},${py(p.y).toFixed(3)}`).join(' ');
        svg += `  <polyline points="${pts}" fill="none" stroke="#38bdf8" stroke-width="0.08" stroke-dasharray="0.5,0.35" opacity="0.6" />\n`;
      }
    }

    // 2. Top copper layer
    for (const [netId, polys] of copperByNet) {
      const d = polysToSvgPath(mapPolys(polys));
      if (!d) continue;
      svg += `  <path d="${d}" fill="${colorFor(netId, false)}" fill-rule="evenodd" opacity="0.8" />\n`;
    }
    // Top isolation toolpaths
    const topPaths = result.topIsolationPaths || result.isolationPaths;
    for (const path of topPaths) {
      const pts = path.points.map(p => `${px(p.x).toFixed(3)},${py(p.y).toFixed(3)}`).join(' ');
      svg += `  <polyline points="${pts}" fill="none" stroke="#ef4444" stroke-width="0.08" stroke-dasharray="0.5,0.35" opacity="0.85" />\n`;
    }
  } else if (view === 'bottom') {
    for (const [netId, polys] of copperByNet) {
      const d = polysToSvgPath(mapPolys(polys));
      if (!d) continue;
      svg += `  <path d="${d}" fill="${colorFor(netId, true)}" fill-rule="evenodd" opacity="0.95" />\n`;
    }
    const bPaths = result.bottomIsolationPaths || result.isolationPaths;
    for (const path of bPaths) {
      const pts = path.points.map(p => `${px(p.x).toFixed(3)},${py(p.y).toFixed(3)}`).join(' ');
      svg += `  <polyline points="${pts}" fill="none" stroke="#0ea5e9" stroke-width="0.08" stroke-dasharray="0.5,0.35" opacity="0.85" />\n`;
    }
  } else {
    for (const [netId, polys] of copperByNet) {
      const d = polysToSvgPath(mapPolys(polys));
      if (!d) continue;
      svg += `  <path d="${d}" fill="${colorFor(netId)}" fill-rule="evenodd" opacity="${view === 'component' ? '0.35' : '0.95'}" />\n`;
    }
    const tPaths = result.topIsolationPaths || result.isolationPaths;
    for (const path of tPaths) {
      const pts = path.points.map(p => `${px(p.x).toFixed(3)},${py(p.y).toFixed(3)}`).join(' ');
      svg += `  <polyline points="${pts}" fill="none" stroke="#ff5252" stroke-width="0.08" stroke-dasharray="0.5,0.35" opacity="${view === 'component' ? '0.3' : '0.85'}" />\n`;
    }
  }

  // Via pads: the same copper ring on both faces, so they show on every view.
  if (result.vias && result.vias.length > 0) {
    for (const v of result.vias) {
      const padR = ((v.padMm || options.viaPadMm || 1.4) / 2).toFixed(3);
      svg += `  <circle cx="${px(v.x).toFixed(3)}" cy="${py(v.y).toFixed(3)}" r="${padR}" fill="#eab308" stroke="#ca8a04" stroke-width="0.1" opacity="0.9" />\n`;
    }
  }

  // Drill holes.
  for (const d of result.drills) {
    if (d.isRegistration) {
      const r = (d.diameter / 2).toFixed(3);
      const cx = px(d.x).toFixed(3);
      const cy = py(d.y).toFixed(3);
      svg += `  <g class="pcb-registration-pin">\n`;
      svg += `    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#06b6d4" stroke="#0891b2" stroke-width="0.15" />\n`;
      svg += `    <line x1="${(px(d.x) - 1.6).toFixed(3)}" y1="${cy}" x2="${(px(d.x) + 1.6).toFixed(3)}" y2="${cy}" stroke="#06b6d4" stroke-width="0.18" />\n`;
      svg += `    <line x1="${cx}" y1="${(py(d.y) - 1.6).toFixed(3)}" x2="${cx}" y2="${(py(d.y) + 1.6).toFixed(3)}" stroke="#06b6d4" stroke-width="0.18" />\n`;
      svg += `    <text x="${cx}" y="${(py(d.y) - 2.2).toFixed(3)}" fill="#06b6d4" font-size="1.1" font-family="monospace" font-weight="bold" text-anchor="middle">PIN ${d.pinNumber}</text>\n`;
      svg += `  </g>\n`;
    } else {
      svg += `  <circle cx="${px(d.x).toFixed(3)}" cy="${py(d.y).toFixed(3)}" r="${(d.diameter / 2).toFixed(3)}" fill="#0d0d0d" />\n`;
    }
  }

  // Courtyards and reference designators.
  for (const comp of result.components) {
    const hw = comp.widthMm / 2;
    const hh = comp.heightMm / 2;
    svg += `  <rect x="${px(comp.x + (flipX ? hw : -hw)).toFixed(3)}" y="${py(comp.y + hh).toFixed(3)}" width="${comp.widthMm.toFixed(3)}" height="${comp.heightMm.toFixed(3)}" fill="none" stroke="#ffffff" stroke-width="0.15" opacity="0.55" rx="0.4" />\n`;
    const label = String(comp.name).replace(/[<>&]/g, '');
    svg += `  <text x="${px(comp.x).toFixed(3)}" y="${py(comp.y + hh + 0.4).toFixed(3)}" fill="#ffffff" font-size="1.4" font-family="monospace" text-anchor="middle">${label}</text>\n`;
  }

  // Pad numbers. Grouped and class-tagged so the viewer can switch them off:
  // on a dense board they are noise, and on the board you are checking a module
  // footprint against they are the only thing that answers the question.
  // paint-order puts the dark stroke behind the glyph, so a number stays
  // readable over both the copper and the drilled hole it sits on.
  svg += `  <g class="pcb-pad-numbers" font-family="monospace" font-size="0.9" text-anchor="middle" fill="#ffffff" stroke="#0d0d0d" stroke-width="0.22" paint-order="stroke" stroke-linejoin="round">\n`;
  for (const pad of result.pads) {
    const n = String(pad.pinNumber).replace(/[<>&]/g, '');
    if (!n) continue;
    svg += `    <text x="${px(pad.x).toFixed(3)}" y="${(py(pad.y) + 0.32).toFixed(3)}">${n}</text>\n`;
  }
  svg += `  </g>\n`;

  // Cutouts: milled clean through, so show them as holes in the substrate.
  for (const cut of result.cutouts) {
    if (cut.shape === 'circle') {
      svg += `  <circle cx="${px(cut.x).toFixed(3)}" cy="${py(cut.y).toFixed(3)}" r="${Math.max(cut.widthMm, cut.heightMm) / 2}" ` +
        `fill="#0b0f14" stroke="#ef5350" stroke-width="0.15" stroke-dasharray="0.8,0.5" />\n`;
    } else {
      svg += `  <rect x="${px(cut.x + (flipX ? cut.widthMm / 2 : -cut.widthMm / 2)).toFixed(3)}" y="${py(cut.y + cut.heightMm / 2).toFixed(3)}" ` +
        `width="${cut.widthMm}" height="${cut.heightMm}" ` +
        `fill="#0b0f14" stroke="#ef5350" stroke-width="0.15" stroke-dasharray="0.8,0.5" />\n`;
    }
  }

  // Profile cut path (tool centreline).
  const profR = options.profileToolDiaMm / 2;
  svg += `  <rect x="${o - profR}" y="${o - profR}" width="${w + options.profileToolDiaMm}" height="${h + options.profileToolDiaMm}" fill="none" stroke="#64b5f6" stroke-width="0.1" stroke-dasharray="1,0.6" opacity="0.7" />\n`;

  // Composite legend
  if (view === 'composite') {
    svg += `  <g class="pcb-legend" font-family="monospace" font-size="1.1" transform="translate(${o + 1}, ${o + 2.5})">\n`;
    svg += `    <rect x="-0.5" y="-1.8" width="50" height="3.5" fill="#0d1117" opacity="0.85" rx="0.6" />\n`;
    svg += `    <circle cx="2" cy="0" r="0.8" fill="#ea580c" />\n`;
    svg += `    <text x="3.5" y="0.4" fill="#fed7aa">Top (F.Cu)</text>\n`;
    svg += `    <circle cx="16" cy="0" r="0.8" fill="#0284c7" />\n`;
    svg += `    <text x="17.5" y="0.4" fill="#bae6fd">Bottom (B.Cu)</text>\n`;
    svg += `    <circle cx="32" cy="0" r="0.8" fill="#eab308" />\n`;
    svg += `    <text x="33.5" y="0.4" fill="#fef08a">Via</text>\n`;
    svg += `    <circle cx="40" cy="0" r="0.8" fill="#06b6d4" />\n`;
    svg += `    <text x="41.5" y="0.4" fill="#a5f3fc">Pin</text>\n`;
    svg += `  </g>\n`;
  }

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
/**
 * A dry run of the board's outline, lifted clear of the stock.
 *
 * What an air cut is actually for is registration: is the blank where the job
 * thinks it is, do the clamps foul the travel, does the machine reach all four
 * corners. Replaying every isolation move to answer that takes as long as the
 * real job and proves nothing extra — every cut in the program lies inside this
 * rectangle, because the profile pass *is* the outermost path in the job, so
 * one lap of it bounds all the rest.
 *
 * Deliberately no spindle, no tool change and no plunges: nothing here should
 * be able to cut, and a program with no `M3` in it cannot start a spindle by
 * accident. Two laps — the first to watch, the second to confirm what you saw.
 */
export function generateAirCutPerimeterGcode(
  result: PcbLayoutResult,
  options: PcbOptions,
  zOffsetMm = 20,
  currentZMm?: number
): string {
  const { corners } = profileToolpath(result, options);
  const lift = Math.abs(zOffsetMm);
  const requestedZ = options.safeZ + lift;

  // The clearance height is in *work* coordinates, so `safeZ + offset` is only
  // "20mm up" when Z0 belongs to the stock that is clamped down right now. With
  // a zero left over from an earlier job — a thicker blank, a longer bit — that
  // same number can sit below the tool, and the first move of a check that is
  // supposed to prove nothing can crash drives the bit down into the work and
  // then drags it across. An air cut must only ever move Z away from the stock.
  const knownZ =
    typeof currentZMm === 'number' && Number.isFinite(currentZMm) ? currentZMm : undefined;
  const targetZ = knownZ !== undefined ? Math.max(requestedZ, knownZ) : undefined;
  const z = f3(targetZ ?? requestedZ);
  const g: string[] = [];

  g.push(`; --- AIR CUT: board outline only, ${f3(lift)}mm above safe Z ---`);
  g.push(`; Bounds the whole job: every cut lies inside this rectangle.`);
  g.push(`; No spindle and no tool changes — this program cannot cut.`);
  g.push(`G90 G21`);
  g.push(`G17`);
  if (targetZ === undefined) {
    // Where the tool is now is unknown, so there is no absolute height that can
    // be proven safe. A relative lift can only go up, and the laps then run from
    // wherever that leaves the tool — higher than asked for, never lower.
    g.push(`; Current Z unknown — lifting relative, so this can only move away from the stock.`);
    g.push(`G91 G0 Z${f3(lift)}`);
    g.push(`G90`);
  } else {
    if (targetZ > requestedZ) {
      g.push(`; Tool is already above the requested clearance — holding Z${z} rather than dropping.`);
    }
    g.push(`G0 Z${z}`);
  }

  for (let lap = 1; lap <= 2; lap++) {
    g.push(`; --- lap ${lap} of 2 ---`);
    g.push(`G0 X${f3(corners[0].x)} Y${f3(corners[0].y)}`);
    for (let i = 1; i < corners.length; i++) {
      g.push(`G1 X${f3(corners[i].x)} Y${f3(corners[i].y)} F${options.travelFeedrate}`);
    }
  }

  if (targetZ !== undefined) g.push(`G0 Z${z}`);
  g.push(`G0 X0 Y0`);
  g.push(`M30 ; End`);
  return g.join('\n');
}

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

/** Length of a polyline in mm. */
function pathLengthMm(points: Pt[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return len;
}

/**
 * The parts of a closed toolpath that fall inside `zone`, as open arcs.
 *
 * A pad-relief pass exists only to clear the ring of laminate around a pad;
 * the same offset taken right round the net would also rake every patch of
 * open board the flood could not reach. Every point of the ring handed in here
 * is already clear of copper by a tool radius, so trimming it is an economy
 * and never a safety decision - which is why sampling points along it is
 * enough and a run with one end inside is kept to its next sample.
 */
function arcsInside(ring: Poly, zone: Poly[], maxSegMm: number): Poly[] {
  if (zone.length === 0) return [];
  // The test is per vertex, and a long straight run - the flank of a track
  // leaving a pad - is a single segment. With both of its ends outside the
  // zone it would be dropped whole, along with the stretch of it that runs
  // through the zone. Break long segments up so no stretch longer than the
  // bit goes untested.
  const dense: Poly = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / maxSegMm));
    for (let k = 0; k < n; k++) {
      dense.push(k === 0 ? a : { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
  }
  ring = dense;
  const inside = ring.map(pt => pointInPolys(zone, pt));
  if (!inside.some(Boolean)) return [];
  if (inside.every(Boolean)) return [[...ring, ring[0]]];

  // Start walking from a point outside the zone, so a run that straddles the
  // ring's own start index comes out as one arc rather than two.
  const n = ring.length;
  const start = inside.indexOf(false);
  const arcs: Poly[] = [];
  let cur: Poly | null = null;
  for (let i = 0; i < n; i++) {
    const idx = (start + i) % n;
    if (inside[idx]) {
      if (!cur) cur = [ring[(idx - 1 + n) % n]];
      cur.push(ring[idx]);
    } else if (cur) {
      cur.push(ring[idx]);
      arcs.push(cur);
      cur = null;
    }
  }
  if (cur) arcs.push(cur);
  return arcs.filter(a => a.length >= 2);
}

/** How far above the last peck's floor the bit rapids to before feeding again. */
const PECK_REENTRY_MM = 0.2;

/** A ring closed by repeating its first point, as the isolation offsets are. */
function isClosedPath(points: Pt[]): boolean {
  if (points.length < 4) return false;
  const a = points[0];
  const b = points[points.length - 1];
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

/** Distance from a point to a box, zero inside it: a floor on the distance to anything the box holds. */
function boxDistance(box: { minX: number; minY: number; maxX: number; maxY: number }, p: Pt): number {
  const dx = p.x < box.minX ? box.minX - p.x : p.x > box.maxX ? p.x - box.maxX : 0;
  const dy = p.y < box.minY ? box.minY - p.y : p.y > box.maxY ? p.y - box.maxY : 0;
  return Math.hypot(dx, dy);
}

/**
 * Orders paths greedily by nearest neighbour to cut the rapids between them.
 *
 * An open path may be cut from either end. A closed ring may be *entered at
 * any vertex*, and the offsets that make up an isolation job are nearly all
 * rings — so treating the ring's arbitrary first vertex as its only door left
 * the tool crossing the whole loop to a point it was already sitting beside.
 * The ring is rotated to start where the tool arrives.
 *
 * `start` is where the tool is when the first path begins.
 */
export function sortPathsNearestNeighbor(paths: IsolationPath[], start: Pt = { x: 0, y: 0 }): IsolationPath[] {
  if (paths.length <= 1) return paths;

  const remaining = paths
    .filter(path => path.points && path.points.length > 0)
    .map(path => {
      const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const pt of path.points) {
        if (pt.x < box.minX) box.minX = pt.x;
        if (pt.y < box.minY) box.minY = pt.y;
        if (pt.x > box.maxX) box.maxX = pt.x;
        if (pt.y > box.maxY) box.maxY = pt.y;
      }
      return { path, box, closed: isClosedPath(path.points) };
    });
  const sorted: IsolationPath[] = [];

  let currentPt: Pt = start;

  while (remaining.length > 0) {
    let bestIdx = -1;
    let bestDist = Infinity;
    // Which vertex to begin at: for an open path 0 or the last (reversed), for
    // a ring any of its distinct vertices.
    let bestEntry = 0;

    for (let i = 0; i < remaining.length; i++) {
      const { path, box, closed } = remaining[i];
      // Nothing in this path can beat the best so far.
      if (boxDistance(box, currentPt) >= bestDist) continue;
      const points = path.points;

      if (closed) {
        for (let k = 0; k < points.length - 1; k++) {
          const d = Math.hypot(points[k].x - currentPt.x, points[k].y - currentPt.y);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
            bestEntry = k;
          }
        }
        continue;
      }

      const startPt = points[0];
      const endPt = points[points.length - 1];
      const dStart = Math.hypot(startPt.x - currentPt.x, startPt.y - currentPt.y);
      const dEnd = Math.hypot(endPt.x - currentPt.x, endPt.y - currentPt.y);
      if (dStart < bestDist) {
        bestDist = dStart;
        bestIdx = i;
        bestEntry = 0;
      }
      if (dEnd < bestDist) {
        bestDist = dEnd;
        bestIdx = i;
        bestEntry = points.length - 1;
      }
    }

    if (bestIdx < 0) break;

    const chosen = remaining.splice(bestIdx, 1)[0];
    const pts = chosen.path.points;
    if (chosen.closed) {
      if (bestEntry > 0) {
        // Same loop, same direction, opened at the vertex the tool is nearest.
        const ring = pts.slice(0, -1);
        const rotated = [...ring.slice(bestEntry), ...ring.slice(0, bestEntry)];
        chosen.path.points = [...rotated, rotated[0]];
      }
    } else if (bestEntry > 0) {
      chosen.path.points = [...pts].reverse();
    }
    sorted.push(chosen.path);
    currentPt = chosen.path.points[chosen.path.points.length - 1];
  }

  return sorted;
}

/**
 * Orders holes greedily by nearest neighbour from wherever the tool is.
 * Holes arrive grouped by component, which walks the bit back and forth
 * across the board once per part.
 */
export function orderHolesNearestNeighbor<T extends { x: number; y: number }>(holes: T[], start: Pt): T[] {
  const remaining = [...holes];
  const ordered: T[] = [];
  let cur = start;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = Math.hypot(remaining[i].x - cur.x, remaining[i].y - cur.y);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    cur = next;
  }
  return ordered;
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
  g.push(`; PCB Isolation Milling — generated by PhysBox: Volt`);
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
    const padClr = Math.max(0, options.padClearanceMm ?? 0);
    if (padClr > 0) {
      g.push(`; Pads:       kept ${padClr.toFixed(2)}mm clear of flooded copper`);
    }
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
  if (!options.pauseOnToolChange) {
    // Nothing below will stop for a bit change, so the spindle is started here
    // and left running for the whole program.
    g.push(`M3 S${options.spindleRpm} ; Spindle on`);
    g.push(`G4 P2 ; Dwell for spin-up`);
  }

  /**
   * Stops the machine for a bit change and picks the job back up.
   *
   * The order is the whole point. Park high enough that a longer bit still
   * clears the stock, stop the spindle before hands go near the collet, then
   * pause. On the way out, spin back up, wait for it, and only then come down
   * to travel height — the operation that follows opens with an XY rapid, and
   * at the parking height that rapid is over the board, not through it.
   */
  const toolChange = (line: string) => {
    if (!options.pauseOnToolChange) return;
    g.push(`G0 Z${f3(options.toolChangeZ)} ; Park clear for the bit change`);
    g.push(`M5 ; Spindle off before hands go near the collet`);
    g.push(line);
    g.push(`M3 S${options.spindleRpm} ; Spindle back on`);
    g.push(`G4 P2 ; Dwell for spin-up`);
    g.push(`G0 Z${f3(options.safeZ)} ; Back down to travel height`);
  };

  const isTwoLayer = options.layers === 2;
  const totalOps = isTwoLayer ? 5 : 3;

  // --- Operation 1: isolation ---
  g.push(``);
  g.push(`; ==================================================`);
  g.push(`; OP 1/${totalOps}: ${isTwoLayer ? 'Top ' : ''}Isolation routing (${options.vBitAngleDeg}deg V-bit, ${options.vBitTipMm}mm tip)`);
  g.push(`; ==================================================`);
  toolChange(`T1 M6 ; Tool 1: V-bit`);

  const topPaths = (isTwoLayer && result.topIsolationPaths) ? result.topIsolationPaths : result.isolationPaths;
  let lastNet = '';
  for (const path of topPaths) {
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

  // Where the tool is left in XY, so the next operation can start nearby.
  let cursor: Pt = { x: 0, y: 0 };
  {
    const last = topPaths[topPaths.length - 1];
    if (last && last.points.length) cursor = last.points[last.points.length - 1];
  }

  // --- Operation 2: drilling ---
  if (result.drills.length > 0) {
    g.push(``);
    g.push(`; ==================================================`);
    g.push(`; OP 2/${totalOps}: ${isTwoLayer ? 'Drilling' : 'Through-hole drilling'} (${result.drills.length} holes${isTwoLayer ? ': THT, vias & registration pins' : ''})`);
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
        toolChange(`T${toolNum} M6 ; Tool ${toolNum}: ${bitMm}mm drill`);
        toolNum++;
      }
      loadedBitMm = bitMm;

      const depth = options.drillDepthZ;
      const ordered = orderHolesNearestNeighbor(holes, cursor);
      if (ordered.length) cursor = ordered[ordered.length - 1];

      if (interpolated) {
        for (const hole of ordered) {
          const holeDepth = hole.isRegistration
            ? options.drillDepthZ - Math.abs(options.spoilboardRegistrationDepthMm ?? 2.0)
            : depth;
          const path = helicalHoleToolpath(holeMm, bitMm, holeDepth, options.zStepdown);
          g.push(`; ${hole.componentId} pin ${hole.pinNumber}${hole.isRegistration ? ' [Registration Pin]' : ''}`);
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

      for (const hole of ordered) {
        const holeDepth = hole.isRegistration
          ? options.drillDepthZ - Math.abs(options.spoilboardRegistrationDepthMm ?? 2.0)
          : depth;
        g.push(`; ${hole.componentId} pin ${hole.pinNumber}${hole.isRegistration ? ' [Registration Pin - Spoilboard Depth]' : ''}`);
        g.push(`G0 X${f3(hole.x)} Y${f3(hole.y)}`);
        // Peck drill so swarf clears instead of binding the bit. Each peck
        // after the first rapids back to just above the hole's floor rather
        // than feeding the whole way down through air.
        const peck = Math.max(0.4, Math.abs(holeDepth) / 3);
        let z = 0;
        while (z > holeDepth) {
          if (z < 0) g.push(`G0 Z${f3(z + PECK_REENTRY_MM)}`);
          z = Math.max(holeDepth, z - peck);
          g.push(`G1 Z${f3(z)} F${options.drillFeedrate}`);
          g.push(`G0 Z${f3(options.safeZ)}`);
        }
      }
    }
    g.push(`G0 Z${f3(options.safeZ)}`);
  }

  if (isTwoLayer) {
    // --- Operation 3: flip the board onto the registration pins ---
    g.push(``);
    g.push(`; ==================================================`);
    g.push(`; OP 3/5: Flip Board & Register with Alignment Pins`);
    g.push(`; 1. Spindle stopped. Clear clamps.`);
    g.push(`; 2. Insert two alignment pins into spoilboard holes.`);
    g.push(`; 3. Flip board horizontally (left-to-right) onto pins.`);
    g.push(`; 4. Re-clamp board securely; re-zero Z on top copper surface.`);
    g.push(`; 5. Press Cycle Start / Resume.`);
    g.push(`; ==================================================`);
    g.push(`G0 Z${f3(options.toolChangeZ)} ; Safe park height clear of clamps`);
    g.push(`M5 ; Spindle off before touching board`);
    g.push(`G0 X0 Y0 ; Move machine clear for operator access`);
    g.push(`M0 ; PAUSE: Flip board horizontally onto registration pins`);
    if (!options.pauseOnToolChange) {
      g.push(`M3 S${options.spindleRpm} ; Spindle back on`);
      g.push(`G4 P2 ; Dwell for spin-up`);
    }

    // --- Operation 4: Bottom isolation ---
    g.push(``);
    g.push(`; ==================================================`);
    g.push(`; OP 4/5: Bottom Isolation routing (${options.vBitAngleDeg}deg V-bit, mirrored horizontally)`);
    g.push(`; ==================================================`);
    toolChange(`T1 M6 ; Tool 1: V-bit`);

    const xMid = result.boardOriginMm + result.boardWidthMm / 2;
    const mx = (x: number) => 2 * xMid - x;

    const bPaths = result.bottomIsolationPaths || [];
    let lastBNet = '';
    for (const path of bPaths) {
      if (path.points.length < 2) continue;
      if (path.netId !== lastBNet) {
        g.push(`; --- net ${path.netId} (bottom) ---`);
        lastBNet = path.netId;
      }
      const p0 = path.points[0];
      const p1 = path.points[1];
      g.push(`G0 Z${f3(options.safeZ)}`);
      g.push(`G0 X${f3(mx(p0.x))} Y${f3(p0.y)}`);

      const segLen = p1 ? Math.hypot(p1.x - p0.x, p1.y - p0.y) : 0;
      if (options.rampedPlunge !== false && p1 && segLen > 0.4) {
        const rampLen = Math.min(1.2, segLen * 0.8);
        const t = rampLen / segLen;
        const rx = p0.x + (p1.x - p0.x) * t;
        const ry = p0.y + (p1.y - p0.y) * t;
        g.push(`G1 X${f3(mx(rx))} Y${f3(ry)} Z${f3(options.isolationDepthZ)} F${options.plungeFeedrate}`);
        g.push(`G1 X${f3(mx(p1.x))} Y${f3(p1.y)} Z${f3(options.isolationDepthZ)} F${options.cutFeedrate}`);
        for (let i = 2; i < path.points.length; i++) {
          g.push(`G1 X${f3(mx(path.points[i].x))} Y${f3(path.points[i].y)} F${options.cutFeedrate}`);
        }
      } else {
        g.push(`G1 Z${f3(options.isolationDepthZ)} F${options.plungeFeedrate}`);
        for (let i = 1; i < path.points.length; i++) {
          g.push(`G1 X${f3(mx(path.points[i].x))} Y${f3(path.points[i].y)} F${options.cutFeedrate}`);
        }
      }
    }
    g.push(`G0 Z${f3(options.safeZ)}`);
  }

  // --- Profile operation ---
  g.push(``);
  g.push(`; ==================================================`);
  g.push(`; OP ${totalOps}/${totalOps}: Board edge profile (${options.profileToolDiaMm}mm end mill)`);
  g.push(`; Tool centre runs ${(options.profileToolDiaMm / 2).toFixed(3)}mm outside the`);
  g.push(`; finished edge. ${options.tabCount} holding tab(s) keep the board captive.`);
  g.push(`; ==================================================`);
  toolChange(`T99 M6 ; Tool 99: ${options.profileToolDiaMm}mm end mill`);

  // A double-sided board is cut from its flipped side, so an internal cutout
  // that was at X is now mirrored across the board centreline. The outside
  // profile is a rectangle centred on that same line, so it maps onto itself
  // and needs no mirroring.
  const profileXMid = result.boardOriginMm + result.boardWidthMm / 2;
  const mx = (x: number) => (isTwoLayer ? 2 * profileXMid - x : x);

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
    g.push(`G0 X${f3(mx(path[0].x))} Y${f3(path[0].y)}`);
    let cz = 0;
    while (cz > options.profileDepthZ) {
      cz = Math.max(options.profileDepthZ, cz - stepDown);
      g.push(`G1 Z${f3(cz)} F${options.plungeFeedrate}`);
      for (let i = 1; i < path.length; i++) {
        g.push(`G1 X${f3(mx(path[i].x))} Y${f3(path[i].y)} F${options.cutFeedrate}`);
      }
    }
    g.push(`G0 Z${f3(options.safeZ)}`);
  }

  const { corners, tabs } = profileToolpath(result, options);
  const inTab = (d: number) => tabs.some(t => d >= t.start && d <= t.end);

  let currentZ = 0;
  const targetZ = options.profileDepthZ;
  const step = Math.abs(options.zStepdown) || 0.8;
  // Tabs only matter once the cut is deeper than the tab height. The height is
  // material left standing above the *bottom face*, so it is measured from
  // there rather than from the cut depth — which now runs past the bottom into
  // the spoilboard and would otherwise shave every tab down by that overshoot.
  const tabZ = Math.min(
    0,
    -Math.abs(options.boardThicknessMm) + Math.abs(options.tabHeightMm)
  );

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

