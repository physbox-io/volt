// ---------------------------------------------------------------------------
// PCB Tooling Catalog & Feeds/Speeds Engine
// ---------------------------------------------------------------------------

export type ToolType = 'vbit' | 'drill' | 'endmill';

export interface PcbToolPreset {
  id: string;
  name: string;
  toolNumber: number;
  type: ToolType;
  tipDiameterMm: number;
  angleDeg?: number;          // Required for V-bits
  recommendedDepthMm: number;  // Standard cut depth (negative for isolation)
  maxStepdownMm: number;       // Pass depth for endmills / profiling
  recommendedCutFeed: number;  // mm/min
  recommendedPlungeFeed: number; // mm/min
  recommendedRpm: number;
  description: string;
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
  {
    id: 't1_vbit_30',
    name: 'T1: 30° V-Bit (0.1mm Tip)',
    toolNumber: 1,
    type: 'vbit',
    tipDiameterMm: 0.1,
    angleDeg: 30,
    recommendedDepthMm: -0.08,
    maxStepdownMm: 0.1,
    recommendedCutFeed: 350,
    recommendedPlungeFeed: 80,
    recommendedRpm: 12000,
    description: 'Standard isolation bit for 0.4mm traces and 0.4mm clearances on FR4.',
  },
  {
    id: 't2_vbit_20',
    name: 'T2: 20° Fine V-Bit (0.1mm Tip)',
    toolNumber: 1,
    type: 'vbit',
    tipDiameterMm: 0.1,
    angleDeg: 20,
    recommendedDepthMm: -0.06,
    maxStepdownMm: 0.08,
    recommendedCutFeed: 250,
    recommendedPlungeFeed: 60,
    recommendedRpm: 15000,
    description: 'Fine trace isolation bit for high-density surface mount packages.',
  },
  {
    id: 't3_vbit_45',
    name: 'T3: 45° Heavy V-Bit (0.2mm Tip)',
    toolNumber: 1,
    type: 'vbit',
    tipDiameterMm: 0.2,
    angleDeg: 45,
    recommendedDepthMm: -0.1,
    maxStepdownMm: 0.15,
    recommendedCutFeed: 450,
    recommendedPlungeFeed: 120,
    recommendedRpm: 10000,
    description: 'Durable bit for high-current traces, thick copper, or fast isolation.',
  },
  {
    id: 't4_drill_08',
    name: 'T2: 0.8mm PCB Drill Bit',
    toolNumber: 2,
    type: 'drill',
    tipDiameterMm: 0.8,
    recommendedDepthMm: -1.8,
    maxStepdownMm: 0.5,
    recommendedCutFeed: 150,
    recommendedPlungeFeed: 150,
    recommendedRpm: 12000,
    description: 'Carbide drill bit for standard 0.1" DIP IC pins and pin headers.',
  },
  {
    id: 't5_drill_10',
    name: 'T3: 1.0mm PCB Drill Bit',
    toolNumber: 3,
    type: 'drill',
    tipDiameterMm: 1.0,
    recommendedDepthMm: -1.8,
    maxStepdownMm: 0.5,
    recommendedCutFeed: 180,
    recommendedPlungeFeed: 180,
    recommendedRpm: 12000,
    description: 'Drill bit for terminal blocks, DC jacks, and power components.',
  },
  {
    id: 't6_endmill_15',
    name: 'T99: 1.5mm Flat Endmill',
    toolNumber: 99,
    type: 'endmill',
    tipDiameterMm: 1.5,
    recommendedDepthMm: -1.6,
    maxStepdownMm: 0.8,
    recommendedCutFeed: 400,
    recommendedPlungeFeed: 120,
    recommendedRpm: 12000,
    description: 'Flat endmill for board outline profiling and pocket copper clearing.',
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
export function calculatePcbFeeds(
  tool: PcbToolPreset,
  material: PcbMaterialPreset
): {
  cutFeedrate: number;
  plungeFeedrate: number;
  spindleRpm: number;
  isolationDepthZ: number;
  zStepdown: number;
  effectiveToolDiaMm: number;
} {
  const cutFeedrate = Math.round(tool.recommendedCutFeed * material.feedMultiplier);
  const plungeFeedrate = Math.round(tool.recommendedPlungeFeed * material.feedMultiplier);
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
