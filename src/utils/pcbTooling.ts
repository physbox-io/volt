// ---------------------------------------------------------------------------
// PCB Tooling Catalog & Feeds/Speeds Engine
// ---------------------------------------------------------------------------

export type ToolType = 'vbit' | 'drill' | 'endmill' | 'ballnose' | 'engraver';

/**
 * Which operation a tool is for. The exporter assigns the actual G-code T
 * numbers — T1 for isolation, T2.. per drill size, T99 for the profile — so
 * `toolNumber` here is the catalogue slot, not the number that reaches the
 * machine.
 */
export type ToolRole = 'isolation' | 'drill' | 'profile';

export interface PcbToolPreset {
  id: string;
  name: string;
  toolNumber: number;
  role: ToolRole;
  type: ToolType;
  tipDiameterMm: number;
  angleDeg?: number;          // Required for V-bits
  fluteCount: number;         // Cutting edges; drives chipload -> feedrate
  chiploadMm?: number;        // Per-tooth bite in FR4; omitted means use the default for the type
  recommendedDepthMm: number;  // Standard cut depth (negative for isolation)
  maxStepdownMm: number;       // Pass depth for endmills / profiling
  recommendedCutFeed: number;  // mm/min
  recommendedPlungeFeed: number; // mm/min
  recommendedRpm: number;
  description: string;
  isCustom?: boolean;
}

export interface PcbMaterialPreset {
  id: string;
  name: string;
  copperThicknessUm: number;   // e.g. 35um for 1oz, 70um for 2oz
  substratetype: 'FR4' | 'FR1' | 'Aluminum';
  feedMultiplier: number;     // Scaling factor for feedrates
  depthMultiplier: number;    // Scaling factor for depth
  description: string;
}

export const PCB_TOOL_PRESETS: PcbToolPreset[] = [
  // --- Isolation (assigned T1 by the exporter) -----------------------------
  {
    id: 't1_vbit_30',
    name: '30° V-Bit (0.1mm Tip)',
    toolNumber: 1,
    role: 'isolation',
    type: 'vbit',
    tipDiameterMm: 0.1,
    angleDeg: 30,
    fluteCount: 1,
    chiploadMm: 0.03,
    recommendedDepthMm: -0.08,
    maxStepdownMm: 0.1,
    recommendedCutFeed: 350,
    recommendedPlungeFeed: 80,
    recommendedRpm: 12000,
    description: 'Standard isolation bit for 0.4mm traces and 0.4mm clearances on FR4.',
  },
  {
    id: 't2_vbit_20',
    name: '20° Fine V-Bit (0.1mm Tip)',
    toolNumber: 1,
    role: 'isolation',
    type: 'vbit',
    tipDiameterMm: 0.1,
    angleDeg: 20,
    fluteCount: 1,
    chiploadMm: 0.02,
    recommendedDepthMm: -0.06,
    maxStepdownMm: 0.08,
    recommendedCutFeed: 250,
    recommendedPlungeFeed: 60,
    recommendedRpm: 15000,
    description: 'Fine trace isolation bit for high-density surface mount packages.',
  },
  {
    id: 't2b_vbit_15',
    name: '15° Ultra-Fine V-Bit (0.05mm Tip)',
    toolNumber: 1,
    role: 'isolation',
    type: 'vbit',
    tipDiameterMm: 0.05,
    angleDeg: 15,
    fluteCount: 1,
    chiploadMm: 0.012,
    recommendedDepthMm: -0.05,
    maxStepdownMm: 0.05,
    recommendedCutFeed: 180,
    recommendedPlungeFeed: 40,
    recommendedRpm: 18000,
    description: 'Sharpest practical isolation bit — needed for 0.5mm-pitch QFN and 0.65mm TSSOP. Fragile: keep depth of cut shallow and the board well levelled.',
  },
  {
    id: 't3_vbit_45',
    name: '45° Heavy V-Bit (0.2mm Tip)',
    toolNumber: 1,
    role: 'isolation',
    type: 'vbit',
    tipDiameterMm: 0.2,
    angleDeg: 45,
    fluteCount: 1,
    chiploadMm: 0.045,
    recommendedDepthMm: -0.1,
    maxStepdownMm: 0.15,
    recommendedCutFeed: 450,
    recommendedPlungeFeed: 120,
    recommendedRpm: 10000,
    description: 'Durable bit for high-current traces, thick copper, or fast isolation.',
  },
  {
    id: 't3b_vbit_60',
    name: '60° V-Bit (0.2mm Tip)',
    toolNumber: 1,
    role: 'isolation',
    type: 'vbit',
    tipDiameterMm: 0.2,
    angleDeg: 60,
    fluteCount: 1,
    chiploadMm: 0.05,
    recommendedDepthMm: -0.12,
    maxStepdownMm: 0.15,
    recommendedCutFeed: 500,
    recommendedPlungeFeed: 140,
    recommendedRpm: 10000,
    description: 'Blunt, very rigid bit for wide-clearance boards. Widens fast with depth — poor choice for fine pitch.',
  },
  {
    id: 't3c_engraver_08',
    name: '0.8mm Flat Engraver (Single Flute)',
    toolNumber: 1,
    role: 'isolation',
    type: 'engraver',
    tipDiameterMm: 0.8,
    fluteCount: 1,
    chiploadMm: 0.05,
    recommendedDepthMm: -0.1,
    maxStepdownMm: 0.2,
    recommendedCutFeed: 500,
    recommendedPlungeFeed: 150,
    recommendedRpm: 12000,
    description: 'Straight-walled single-flute cutter. Cut width does not vary with depth, so isolation gaps stay exact even on an unlevelled board — at the cost of needing 0.8mm of clearance.',
  },

  // --- Drills (assigned T2.. per size by the exporter) ---------------------
  {
    id: 't4_drill_05',
    name: '0.5mm PCB Drill Bit',
    toolNumber: 2,
    role: 'drill',
    type: 'drill',
    tipDiameterMm: 0.5,
    fluteCount: 2,
    chiploadMm: 0.01,
    recommendedDepthMm: -1.8,
    maxStepdownMm: 0.3,
    recommendedCutFeed: 90,
    recommendedPlungeFeed: 90,
    recommendedRpm: 16000,
    description: 'Fine drill for vias and small-signal component leads.',
  },
  {
    id: 't4b_drill_06',
    name: '0.6mm PCB Drill Bit',
    toolNumber: 2,
    role: 'drill',
    type: 'drill',
    tipDiameterMm: 0.6,
    fluteCount: 2,
    chiploadMm: 0.012,
    recommendedDepthMm: -1.8,
    maxStepdownMm: 0.35,
    recommendedCutFeed: 110,
    recommendedPlungeFeed: 110,
    recommendedRpm: 15000,
    description: 'Standard via drill and the usual size for 1/4W resistor leads.',
  },
  {
    id: 't4c_drill_08',
    name: '0.8mm PCB Drill Bit',
    toolNumber: 2,
    role: 'drill',
    type: 'drill',
    tipDiameterMm: 0.8,
    fluteCount: 2,
    chiploadMm: 0.015,
    recommendedDepthMm: -1.8,
    maxStepdownMm: 0.5,
    recommendedCutFeed: 150,
    recommendedPlungeFeed: 150,
    recommendedRpm: 12000,
    description: 'Carbide drill bit for standard 0.1" DIP IC pins and pin headers.',
  },
  {
    id: 't5_drill_10',
    name: '1.0mm PCB Drill Bit',
    toolNumber: 2,
    role: 'drill',
    type: 'drill',
    tipDiameterMm: 1.0,
    fluteCount: 2,
    chiploadMm: 0.018,
    recommendedDepthMm: -1.8,
    maxStepdownMm: 0.5,
    recommendedCutFeed: 180,
    recommendedPlungeFeed: 180,
    recommendedRpm: 12000,
    description: 'Drill bit for terminal blocks, DC jacks, and power components.',
  },
  {
    id: 't5b_drill_13',
    name: '1.3mm PCB Drill Bit',
    toolNumber: 2,
    role: 'drill',
    type: 'drill',
    tipDiameterMm: 1.3,
    fluteCount: 2,
    chiploadMm: 0.022,
    recommendedDepthMm: -1.8,
    maxStepdownMm: 0.6,
    recommendedCutFeed: 200,
    recommendedPlungeFeed: 200,
    recommendedRpm: 11000,
    description: 'Screw terminals, TO-220 leads, and relay pins.',
  },
  {
    id: 't5c_drill_32',
    name: '3.2mm Mounting Hole Drill',
    toolNumber: 2,
    role: 'drill',
    type: 'drill',
    tipDiameterMm: 3.2,
    fluteCount: 2,
    chiploadMm: 0.04,
    recommendedDepthMm: -2.0,
    maxStepdownMm: 0.8,
    recommendedCutFeed: 160,
    recommendedPlungeFeed: 160,
    recommendedRpm: 9000,
    description: 'M3 clearance hole for standoffs and panel mounting.',
  },

  // --- Profiling & pocketing (assigned T99 by the exporter) ----------------
  {
    id: 't6_endmill_08',
    name: '0.8mm Single-Flute Endmill',
    toolNumber: 99,
    role: 'profile',
    type: 'endmill',
    tipDiameterMm: 0.8,
    fluteCount: 1,
    chiploadMm: 0.025,
    recommendedDepthMm: -1.6,
    maxStepdownMm: 0.4,
    recommendedCutFeed: 300,
    recommendedPlungeFeed: 80,
    recommendedRpm: 14000,
    description: 'Tight-radius cutter for small internal cutouts and narrow slots.',
  },
  {
    id: 't6b_endmill_15',
    name: '1.5mm Flat Endmill',
    toolNumber: 99,
    role: 'profile',
    type: 'endmill',
    tipDiameterMm: 1.5,
    fluteCount: 2,
    chiploadMm: 0.03,
    recommendedDepthMm: -1.6,
    maxStepdownMm: 0.8,
    recommendedCutFeed: 400,
    recommendedPlungeFeed: 120,
    recommendedRpm: 12000,
    description: 'Flat endmill for board outline profiling and pocket copper clearing.',
  },
  {
    id: 't6c_endmill_20',
    name: '2.0mm Flat Endmill',
    toolNumber: 99,
    role: 'profile',
    type: 'endmill',
    tipDiameterMm: 2.0,
    fluteCount: 2,
    chiploadMm: 0.04,
    recommendedDepthMm: -1.7,
    maxStepdownMm: 1.0,
    recommendedCutFeed: 500,
    recommendedPlungeFeed: 150,
    recommendedRpm: 12000,
    description: 'Faster board profiling when no cutout needs a tight inside corner.',
  },
  {
    id: 't6d_endmill_3175',
    name: '3.175mm (1/8") Flat Endmill',
    toolNumber: 99,
    role: 'profile',
    type: 'endmill',
    tipDiameterMm: 3.175,
    fluteCount: 2,
    chiploadMm: 0.055,
    recommendedDepthMm: -1.7,
    maxStepdownMm: 1.2,
    recommendedCutFeed: 600,
    recommendedPlungeFeed: 180,
    recommendedRpm: 11000,
    description: 'Full-shank endmill for fast outline cuts and large pocket clearing. Cannot reach inside corners tighter than 1.6mm radius.',
  },
  {
    id: 't7_ballnose_10',
    name: '1.0mm Tapered Ball-Nose',
    toolNumber: 99,
    role: 'profile',
    type: 'ballnose',
    tipDiameterMm: 1.0,
    fluteCount: 2,
    chiploadMm: 0.02,
    recommendedDepthMm: -0.8,
    maxStepdownMm: 0.4,
    recommendedCutFeed: 350,
    recommendedPlungeFeed: 100,
    recommendedRpm: 14000,
    description: 'Rounded cutter for chamfering board edges and 3D-relief silkscreen engraving. Not for isolation — the cut width varies with depth like a V-bit but far more steeply.',
  },
];

export const PCB_MATERIAL_PRESETS: PcbMaterialPreset[] = [
  {
    id: 'fr4_1oz',
    name: 'FR4 Standard (1.6mm, 1oz Cu)',
    copperThicknessUm: 35,
    substratetype: 'FR4',
    feedMultiplier: 1.0,
    depthMultiplier: 1.0,
    description: 'Standard glass-epoxy double/single-sided copper clad laminate.',
  },
  {
    id: 'fr4_2oz',
    name: 'FR4 Heavy Copper (1.6mm, 2oz Cu)',
    copperThicknessUm: 70,
    substratetype: 'FR4',
    feedMultiplier: 0.85,
    depthMultiplier: 1.25,
    description: 'Thick copper clad for high current traces requiring deeper isolation.',
  },
  {
    id: 'fr1_soft',
    name: 'FR1 / FR2 Paper Phenolic (1.6mm)',
    copperThicknessUm: 35,
    substratetype: 'FR1',
    feedMultiplier: 1.3,
    depthMultiplier: 1.0,
    description: 'Soft copper clad board that mills quickly with lower bit wear.',
  },
  {
    id: 'alu_core',
    name: 'Aluminum Core PCB (1.6mm)',
    copperThicknessUm: 35,
    substratetype: 'Aluminum',
    feedMultiplier: 0.7,
    depthMultiplier: 0.9,
    description: 'Metal-backed PCB for high power LEDs requiring slow feeds.',
  },
];

/**
 * Derives effective cutting width for a V-bit at a given cut depth:
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
 * Calculates optimal feeds & speeds for a selected tool and material preset.
 */
/**
 * Chipload in FR4 for a tool that does not carry its own figure. Small cutters
 * take a proportionally smaller bite — a 0.1mm tip fed at a 1.5mm endmill's
 * chipload snaps on the first pass.
 */
export function suggestedChiploadMm(type: ToolType, diameterMm: number): number {
  const d = Math.max(0.05, diameterMm);
  switch (type) {
    case 'vbit':
    case 'engraver':
      return Math.min(0.05, 0.02 + d * 0.04);
    case 'drill':
      return Math.min(0.05, 0.008 + d * 0.012);
    case 'ballnose':
      return Math.min(0.05, 0.01 + d * 0.012);
    default:
      return Math.min(0.06, 0.015 + d * 0.013);
  }
}

/** feed (mm/min) = chipload (mm/tooth) x teeth x rpm. */
export function feedFromChipload(chiploadMm: number, fluteCount: number, rpm: number): number {
  return Math.round(Math.max(0.001, chiploadMm) * Math.max(1, fluteCount) * Math.max(1000, rpm));
}

/**
 * Calculates optimal feeds & speeds for a selected tool and material preset.
 *
 * `fluteOverride` re-derives the feedrate when the user fits a tool with a
 * different number of cutting edges than the catalogue entry assumes: chipload
 * is a property of the edge, so twice the teeth wants twice the feed to keep
 * the same bite.
 */
export function calculatePcbFeeds(
  tool: PcbToolPreset,
  material: PcbMaterialPreset,
  fluteOverride?: number
): {
  cutFeedrate: number;
  plungeFeedrate: number;
  spindleRpm: number;
  isolationDepthZ: number;
  zStepdown: number;
  effectiveToolDiaMm: number;
} {
  const flutes = Math.max(1, Math.round(fluteOverride ?? tool.fluteCount ?? 1));
  const fluteScale = flutes / Math.max(1, tool.fluteCount ?? 1);

  const cutFeedrate = Math.round(tool.recommendedCutFeed * material.feedMultiplier * fluteScale);
  const plungeFeedrate = Math.round(tool.recommendedPlungeFeed * material.feedMultiplier * fluteScale);
  const spindleRpm = tool.recommendedRpm;
  const isolationDepthZ = parseFloat((tool.recommendedDepthMm * material.depthMultiplier).toFixed(3));
  const zStepdown = parseFloat((tool.maxStepdownMm * material.feedMultiplier).toFixed(3));

  const effectiveToolDiaMm =
    tool.type === 'vbit' && tool.angleDeg !== undefined
      ? vBitWidthAtDepth(tool.tipDiameterMm, tool.angleDeg, isolationDepthZ)
      : tool.tipDiameterMm;

  return {
    cutFeedrate,
    plungeFeedrate,
    spindleRpm,
    isolationDepthZ,
    zStepdown,
    effectiveToolDiaMm,
  };
}

/**
 * The error a levelling setup cannot remove, in mm, no matter how flat the
 * board reads. Probe repeatability with a continuity clip, tool runout, and
 * gantry deflection under load all land here, and none of them shrink when the
 * board turns out to be flat.
 *
 * This is the floor that was missing: the allowance used to be a pure fraction
 * of the measured span, so the *flatter* a board probed, the *thinner* the
 * margin it was cut with — 0.02mm over 0.035mm of foil, which is inside the
 * noise of the probe that measured it. Traces came out faint or uncut.
 */
const IRREDUCIBLE_Z_ERROR_MM = 0.03;

/**
 * How much deeper than the copper the isolation pass has to cut to be sure it
 * gets through everywhere, in mm.
 *
 * Copper is 35um thick; the reason the recommended depths are several times
 * that is the board, not the foil. Laminate is never flat, it is never clamped
 * flat, and the spoilboard under it is never true — so the cut has to be deep
 * enough that the high spots still clear.
 *
 * A probed height map removes most of that, but not all of it, and what is left
 * is two things added together rather than one: what the bilinear interpolation
 * misses *between* probe points, which does scale with the measured span, and
 * the irreducible error above, which does not. Treating the second as though it
 * were a fraction of the first is what let a well-behaved board be cut too
 * shallow to isolate.
 */
export function isolationFlatnessAllowanceMm(heightmapSpanZmm?: number): number {
  if (heightmapSpanZmm === undefined) return 0.08;
  const interpolationResidual = heightmapSpanZmm * 0.15;
  return Math.min(0.08, IRREDUCIBLE_Z_ERROR_MM + interpolationResidual);
}

/**
 * The shallowest isolation depth that still clears the copper.
 *
 * A V-bit's cut widens with depth, so depth is the single biggest lever on how
 * much copper a job removes: every micron cut past the foil is a wider channel
 * and two narrower traces. The catalogue depth is a safe figure for an
 * unlevelled board with unknown copper; once the material and the board's
 * flatness are known, the same job usually runs a good deal shallower.
 *
 * Never returns anything deeper than the tool's own recommendation — this is a
 * lever for cutting less, not for cutting more.
 */
export function autoIsolationDepthMm(
  tool: PcbToolPreset,
  material: PcbMaterialPreset,
  flatnessMm = isolationFlatnessAllowanceMm()
): number {
  const copperMm = material.copperThicknessUm / 1000;
  const recommended = Math.abs(tool.recommendedDepthMm * material.depthMultiplier);
  const needed = copperMm + Math.max(0.02, flatnessMm);
  return -parseFloat(Math.min(recommended, needed).toFixed(3));
}

// ---------------------------------------------------------------------------
// Custom tools
//
// The catalogue cannot cover every bit in every drawer, so the CAM tab lets the
// user define their own. They persist in localStorage — there is no backend,
// and a tool library that vanishes on refresh is worse than none.
// ---------------------------------------------------------------------------

const CUSTOM_TOOL_STORAGE_KEY = 'circuit.pcb.customTools.v1';

export interface CustomToolInput {
  name: string;
  type: ToolType;
  role?: ToolRole;
  tipDiameterMm: number;
  angleDeg?: number;
  fluteCount?: number;
  chiploadMm?: number;
  recommendedRpm?: number;
  recommendedDepthMm?: number;
  maxStepdownMm?: number;
  /** Given explicitly, this wins over the chipload calculation. */
  recommendedCutFeed?: number;
  recommendedPlungeFeed?: number;
  description?: string;
}

function defaultRoleForType(type: ToolType): ToolRole {
  if (type === 'drill') return 'drill';
  if (type === 'vbit' || type === 'engraver') return 'isolation';
  return 'profile';
}

/** Builds a full tool preset, deriving anything the user left blank. */
export function createCustomTool(input: CustomToolInput, id?: string): PcbToolPreset {
  const type = input.type;
  const role = input.role ?? defaultRoleForType(type);
  const dia = Math.max(0.01, input.tipDiameterMm);
  const flutes = Math.max(1, Math.round(input.fluteCount ?? (type === 'vbit' ? 1 : 2)));
  const rpm = Math.max(1000, Math.round(input.recommendedRpm ?? (dia < 0.5 ? 15000 : 12000)));
  const chipload = input.chiploadMm ?? suggestedChiploadMm(type, dia);

  const cutFeed = Math.round(input.recommendedCutFeed ?? feedFromChipload(chipload, flutes, rpm));
  // Plunging is the move that breaks bits; a third of the cutting feed is the
  // usual safe ratio, and drills plunge at their full feed by definition.
  const plungeFeed = Math.round(
    input.recommendedPlungeFeed ?? (role === 'drill' ? cutFeed : Math.max(30, cutFeed / 3))
  );

  const depth =
    input.recommendedDepthMm ??
    (role === 'isolation' ? -0.08 : role === 'drill' ? -1.8 : -1.6);

  return {
    id: id ?? `custom_${Math.round(dia * 1000)}_${type}_${flutes}f`,
    name: input.name.trim() || `${dia}mm ${type}`,
    toolNumber: role === 'isolation' ? 1 : role === 'drill' ? 2 : 99,
    role,
    type,
    tipDiameterMm: dia,
    angleDeg: type === 'vbit' ? (input.angleDeg ?? 30) : input.angleDeg,
    fluteCount: flutes,
    chiploadMm: chipload,
    recommendedDepthMm: depth,
    maxStepdownMm: Math.max(0.02, input.maxStepdownMm ?? Math.min(1.0, dia * 0.5)),
    recommendedCutFeed: cutFeed,
    recommendedPlungeFeed: plungeFeed,
    recommendedRpm: rpm,
    description: input.description?.trim() || `User-defined ${type}, ${flutes}-flute, ${dia}mm.`,
    isCustom: true,
  };
}

export function loadCustomTools(): PcbToolPreset[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CUSTOM_TOOL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Re-run each stored record through the builder so tools saved by an older
    // version pick up any fields added since.
    return (parsed as Partial<PcbToolPreset>[])
      .filter(t => t && typeof t.tipDiameterMm === 'number' && typeof t.type === 'string')
      .map(t => createCustomTool(t as unknown as CustomToolInput, t.id));
  } catch {
    return [];
  }
}

export function saveCustomTools(tools: PcbToolPreset[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CUSTOM_TOOL_STORAGE_KEY, JSON.stringify(tools));
  } catch {
    // Quota or private-browsing failure. The tool still works this session.
  }
}

export function addCustomTool(input: CustomToolInput): PcbToolPreset[] {
  const tool = createCustomTool(input);
  const existing = loadCustomTools().filter(t => t.id !== tool.id);
  const next = [...existing, tool];
  saveCustomTools(next);
  return next;
}

export function deleteCustomTool(id: string): PcbToolPreset[] {
  const next = loadCustomTools().filter(t => t.id !== id);
  saveCustomTools(next);
  return next;
}

/** Catalogue plus the user's own tools, for populating the CAM tool picker. */
export function allTools(): PcbToolPreset[] {
  return [...PCB_TOOL_PRESETS, ...loadCustomTools()];
}

export function findTool(id: string): PcbToolPreset | undefined {
  return allTools().find(t => t.id === id);
}

// ---------------------------------------------------------------------------
// Millability
// ---------------------------------------------------------------------------

/**
 * The narrowest isolation channel a tool can cut. For a V-bit this grows with
 * depth of cut, which is why a "0.1mm tip" bit does not give a 0.1mm gap.
 */
export function minIsolationChannelMm(tool: PcbToolPreset, depthMm: number): number {
  if (tool.type === 'vbit' && tool.angleDeg !== undefined) {
    return vBitWidthAtDepth(tool.tipDiameterMm, tool.angleDeg, depthMm);
  }
  if (tool.type === 'ballnose') {
    // A ball tip's width at depth d is the chord of the sphere, capped at the
    // shank diameter once the cut is deeper than the radius.
    const r = tool.tipDiameterMm / 2;
    const d = Math.min(Math.abs(depthMm), r);
    return 2 * Math.sqrt(Math.max(0, r * r - (r - d) * (r - d)));
  }
  return tool.tipDiameterMm;
}

export interface MillabilityReport {
  ok: boolean;
  /** Smallest gap between two pads on different pins, in mm. */
  minPadGapMm: number;
  /** Channel width the tool actually cuts at the given depth. */
  channelWidthMm: number;
  messages: string[];
}

export interface MillabilityPad {
  x: number;
  y: number;
  padWidth: number;
  padHeight: number;
  pinNumber: string | number;
}

/**
 * Closest approach between the copper of any two pads on different pins.
 * Returns Infinity when there is no such pair, and a negative number when
 * two pads overlap.
 */
export function minPadGapMm(pads: MillabilityPad[]): number {
  let minGap = Infinity;
  for (let i = 0; i < pads.length; i++) {
    for (let j = i + 1; j < pads.length; j++) {
      const a = pads[i];
      const b = pads[j];
      if (String(a.pinNumber) === String(b.pinNumber)) continue;
      // Gap between two axis-aligned rectangles. When they overlap on one axis
      // the gap is the other axis' separation; when neither overlaps it is the
      // corner-to-corner diagonal.
      const dx = Math.abs(a.x - b.x) - (a.padWidth + b.padWidth) / 2;
      const dy = Math.abs(a.y - b.y) - (a.padHeight + b.padHeight) / 2;
      const gap = dx > 0 && dy > 0 ? Math.hypot(dx, dy) : Math.max(dx, dy);
      if (gap < minGap) minGap = gap;
    }
  }
  return minGap;
}

/**
 * Checks whether a tool can isolate between a footprint's pads. Fine-pitch
 * parts are the reason this exists: a 0.5mm-pitch QFN leaves roughly a 0.25mm
 * gap between pads, which most V-bits cannot cut without eating the copper on
 * both sides.
 *
 * Takes pads structurally rather than importing the footprint type, so the
 * tooling module stays independent of the footprint library.
 */
export function checkMillability(
  pads: MillabilityPad[],
  tool: PcbToolPreset,
  depthMm: number,
  clearanceMm = 0
): MillabilityReport {
  const channelWidthMm = minIsolationChannelMm(tool, depthMm);
  const messages: string[] = [];

  const minGap = minPadGapMm(pads);
  const needed = channelWidthMm + clearanceMm * 2;
  const ok = minGap >= needed;

  if (minGap <= 0) {
    messages.push(
      `Pads overlap or touch (${minGap.toFixed(3)}mm gap) — no tool can isolate them. The footprint itself is wrong.`
    );
  } else if (!ok) {
    messages.push(
      `Needs a ${needed.toFixed(3)}mm channel but the pads are only ${minGap.toFixed(3)}mm apart. ` +
        `Use a sharper bit, cut shallower, or reduce the pad margin.`
    );
    if (tool.type === 'vbit' && tool.angleDeg !== undefined) {
      // Solve tip + 2*d*tan(a/2) = minGap - 2*clearance for d.
      const halfAngle = ((tool.angleDeg / 2) * Math.PI) / 180;
      const maxDepth =
        (minGap - clearanceMm * 2 - tool.tipDiameterMm) / (2 * Math.tan(halfAngle));
      if (maxDepth > 0.01) {
        messages.push(`This bit fits at a cut depth shallower than ${maxDepth.toFixed(3)}mm.`);
      } else {
        messages.push(
          `Even at zero depth this bit's ${tool.tipDiameterMm}mm tip is too wide. A finer tip or a smaller-angle bit is required.`
        );
      }
    }
  }

  return { ok, minPadGapMm: minGap, channelWidthMm, messages };
}
