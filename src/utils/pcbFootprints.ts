// ---------------------------------------------------------------------------
// Standard PCB Component Footprint Library & Parametric Generators
// Coordinates are in millimeters relative to component origin (0,0) at center.
// ---------------------------------------------------------------------------

/**
 * What a pad is for. Only 'signal' pads carry a net; 'thermal' is a QFN/DFN
 * exposed pad (usually ground, but it is the schematic that decides), and
 * 'mechanical' is a tab or shield leg that is soldered but never routed.
 */
export type PadRole = 'signal' | 'thermal' | 'mechanical';

export interface PadSpec {
  pinNumber: string | number;
  x: number;             // X offset relative to component center (mm)
  y: number;             // Y offset relative to component center (mm)
  padWidth: number;      // Copper pad width in mm
  padHeight: number;     // Copper pad height in mm
  shape: 'circle' | 'rect' | 'oval';
  drillDiameter: number; // 0 for SMD, e.g. 0.8mm for THT
  role?: PadRole;        // Defaults to 'signal' when absent
}

export interface ComponentFootprint {
  packageId: string;     // e.g. 'DIP-8', '0805', 'HEADER-1x04'
  name: string;
  widthMm: number;       // Courtyard physical width in mm
  heightMm: number;      // Courtyard physical height in mm
  pads: PadSpec[];
  /**
   * Set when the requested package could not be resolved and this footprint is
   * a guess. The exporter turns it into a DRC warning — a silently substituted
   * footprint drills the wrong holes in real copper.
   */
  isFallback?: boolean;
  requestedPackageId?: string;
}

/**
 * Grows a footprint's courtyard until it contains its own copper.
 *
 * The courtyard is what the placer separates parts by, so a footprint that
 * declares a body smaller than its pads lets the placer sit a neighbour's pad
 * on top of it while believing there is a 3.5mm gap. That is a short, and it
 * reached the DRC rather than the placer: seven of the hand-written entries
 * below understated their body, RADIAL-5MM by 1.08mm, because the figure was
 * the plastic package rather than the land pattern.
 *
 * The generated families already do this — see the courtyard growth in
 * `generateDualRowFootprint` — so this only brings the hand-written table under
 * the same rule rather than introducing a new one.
 */
function withContainedCourtyard(fp: ComponentFootprint): ComponentFootprint {
  let halfW = 0;
  let halfH = 0;
  for (const pad of fp.pads) {
    // A through-hole pad's copper is the larger of its land and its own drill.
    halfW = Math.max(halfW, Math.abs(pad.x) + Math.max(pad.padWidth, pad.drillDiameter || 0) / 2);
    halfH = Math.max(halfH, Math.abs(pad.y) + Math.max(pad.padHeight, pad.drillDiameter || 0) / 2);
  }
  return {
    ...fp,
    widthMm: Math.max(fp.widthMm, halfW * 2),
    heightMm: Math.max(fp.heightMm, halfH * 2),
  };
}

const RAW_STANDARD_FOOTPRINTS: Record<string, ComponentFootprint> = {
  '0805': {
    packageId: '0805',
    name: '0805 Surface Mount Passive',
    widthMm: 2.0,
    heightMm: 1.25,
    pads: [
      { pinNumber: '1', x: -0.95, y: 0, padWidth: 1.0, padHeight: 1.3, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '2', x: 0.95, y: 0, padWidth: 1.0, padHeight: 1.3, shape: 'rect', drillDiameter: 0 },
    ],
  },
  '1206': {
    packageId: '1206',
    name: '1206 Surface Mount Passive',
    widthMm: 3.2,
    heightMm: 1.6,
    pads: [
      { pinNumber: '1', x: -1.5, y: 0, padWidth: 1.2, padHeight: 1.7, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '2', x: 1.5, y: 0, padWidth: 1.2, padHeight: 1.7, shape: 'rect', drillDiameter: 0 },
    ],
  },
  'AXIAL-0.3': {
    packageId: 'AXIAL-0.3',
    name: 'Axial Resistor/Diode (0.3 inch / 7.62mm pitch)',
    widthMm: 10.0,
    heightMm: 3.0,
    pads: [
      { pinNumber: '1', x: -3.81, y: 0, padWidth: 1.8, padHeight: 1.8, shape: 'circle', drillDiameter: 0.8 },
      { pinNumber: '2', x: 3.81, y: 0, padWidth: 1.8, padHeight: 1.8, shape: 'circle', drillDiameter: 0.8 },
    ],
  },
  'SOIC-8': {
    packageId: 'SOIC-8',
    name: 'SOIC-8 Surface Mount IC',
    widthMm: 5.0,
    heightMm: 6.0,
    pads: [
      { pinNumber: '1', x: -2.7, y: 1.905, padWidth: 1.5, padHeight: 0.6, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '2', x: -2.7, y: 0.635, padWidth: 1.5, padHeight: 0.6, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '3', x: -2.7, y: -0.635, padWidth: 1.5, padHeight: 0.6, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '4', x: -2.7, y: -1.905, padWidth: 1.5, padHeight: 0.6, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '5', x: 2.7, y: -1.905, padWidth: 1.5, padHeight: 0.6, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '6', x: 2.7, y: -0.635, padWidth: 1.5, padHeight: 0.6, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '7', x: 2.7, y: 0.635, padWidth: 1.5, padHeight: 0.6, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '8', x: 2.7, y: 1.905, padWidth: 1.5, padHeight: 0.6, shape: 'rect', drillDiameter: 0 },
    ],
  },
  'SOT-23': {
    packageId: 'SOT-23',
    name: 'SOT-23 Transistor / Small IC',
    widthMm: 3.0,
    heightMm: 2.8,
    pads: [
      { pinNumber: '1', x: -0.95, y: -1.1, padWidth: 0.8, padHeight: 1.0, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '2', x: 0.95, y: -1.1, padWidth: 0.8, padHeight: 1.0, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '3', x: 0, y: 1.1, padWidth: 0.8, padHeight: 1.0, shape: 'rect', drillDiameter: 0 },
    ],
  },
  'TO-220': {
    packageId: 'TO-220',
    name: 'TO-220 Power Transistor / Regulator',
    widthMm: 10.4,
    heightMm: 4.6,
    pads: [
      { pinNumber: '1', x: -2.54, y: 0, padWidth: 1.8, padHeight: 2.5, shape: 'oval', drillDiameter: 1.0 },
      { pinNumber: '2', x: 0, y: 0, padWidth: 1.8, padHeight: 2.5, shape: 'oval', drillDiameter: 1.0 },
      { pinNumber: '3', x: 2.54, y: 0, padWidth: 1.8, padHeight: 2.5, shape: 'oval', drillDiameter: 1.0 },
    ],
  },
  'LED-5MM': {
    packageId: 'LED-5MM',
    name: '5mm Radial THT LED',
    widthMm: 5.8,
    heightMm: 5.8,
    pads: [
      { pinNumber: 'A', x: -1.27, y: 0, padWidth: 1.8, padHeight: 1.8, shape: 'rect', drillDiameter: 0.8 },
      { pinNumber: 'K', x: 1.27, y: 0, padWidth: 1.8, padHeight: 1.8, shape: 'circle', drillDiameter: 0.8 },
    ],
  },
  'TACT-4PIN': {
    packageId: 'TACT-4PIN',
    name: '6x6mm Tactile Switch',
    widthMm: 6.2,
    heightMm: 6.2,
    pads: [
      { pinNumber: '1', x: -3.25, y: 2.25, padWidth: 1.8, padHeight: 1.8, shape: 'circle', drillDiameter: 1.0 },
      { pinNumber: '2', x: 3.25, y: 2.25, padWidth: 1.8, padHeight: 1.8, shape: 'circle', drillDiameter: 1.0 },
      { pinNumber: '3', x: -3.25, y: -2.25, padWidth: 1.8, padHeight: 1.8, shape: 'circle', drillDiameter: 1.0 },
      { pinNumber: '4', x: 3.25, y: -2.25, padWidth: 1.8, padHeight: 1.8, shape: 'circle', drillDiameter: 1.0 },
    ],
  },
  'TERMINAL-2P': {
    packageId: 'TERMINAL-2P',
    name: '5.08mm Screw Terminal (2 Pin)',
    widthMm: 10.16,
    heightMm: 8.0,
    pads: [
      { pinNumber: '1', x: -2.54, y: 0, padWidth: 2.8, padHeight: 2.8, shape: 'circle', drillDiameter: 1.3 },
      { pinNumber: '2', x: 2.54, y: 0, padWidth: 2.8, padHeight: 2.8, shape: 'circle', drillDiameter: 1.3 },
    ],
  },
  'TERMINAL-3P': {
    packageId: 'TERMINAL-3P',
    name: '5.08mm Screw Terminal (3 Pin)',
    widthMm: 15.24,
    heightMm: 8.0,
    pads: [
      { pinNumber: '1', x: -5.08, y: 0, padWidth: 2.8, padHeight: 2.8, shape: 'circle', drillDiameter: 1.3 },
      { pinNumber: '2', x: 0, y: 0, padWidth: 2.8, padHeight: 2.8, shape: 'circle', drillDiameter: 1.3 },
      { pinNumber: '3', x: 5.08, y: 0, padWidth: 2.8, padHeight: 2.8, shape: 'circle', drillDiameter: 1.3 },
    ],
  },
  // Small-signal BJT package. Pin order matches 2N3904/2N3906 with the flat
  // face towards the viewer: 1 = Emitter, 2 = Base, 3 = Collector.
  'TO-92': {
    packageId: 'TO-92',
    name: 'TO-92 Small Signal Transistor',
    widthMm: 5.2,
    heightMm: 4.6,
    pads: [
      { pinNumber: '1', x: -2.54, y: 0, padWidth: 1.6, padHeight: 1.6, shape: 'rect', drillDiameter: 0.8 },
      { pinNumber: '2', x: 0, y: 0, padWidth: 1.6, padHeight: 1.6, shape: 'circle', drillDiameter: 0.8 },
      { pinNumber: '3', x: 2.54, y: 0, padWidth: 1.6, padHeight: 1.6, shape: 'circle', drillDiameter: 0.8 },
    ],
  },
  // 5mm radial package used for LDRs and radial electrolytics.
  'RADIAL-5MM': {
    packageId: 'RADIAL-5MM',
    name: '5mm Radial Two-Terminal',
    widthMm: 5.8,
    heightMm: 5.8,
    pads: [
      { pinNumber: '1', x: -2.54, y: 0, padWidth: 1.8, padHeight: 1.8, shape: 'rect', drillDiameter: 0.9 },
      { pinNumber: '2', x: 2.54, y: 0, padWidth: 1.8, padHeight: 1.8, shape: 'circle', drillDiameter: 0.9 },
    ],
  },
  // Four-terminal transformer bobbin: primary on the left, secondary right.
  'TRANSFORMER-4P': {
    packageId: 'TRANSFORMER-4P',
    name: 'Transformer (2 Primary / 2 Secondary)',
    widthMm: 20.0,
    heightMm: 15.0,
    pads: [
      { pinNumber: '1', x: -7.62, y: 5.08, padWidth: 2.2, padHeight: 2.2, shape: 'rect', drillDiameter: 1.1 },
      { pinNumber: '2', x: -7.62, y: -5.08, padWidth: 2.2, padHeight: 2.2, shape: 'circle', drillDiameter: 1.1 },
      { pinNumber: '3', x: 7.62, y: 5.08, padWidth: 2.2, padHeight: 2.2, shape: 'circle', drillDiameter: 1.1 },
      { pinNumber: '4', x: 7.62, y: -5.08, padWidth: 2.2, padHeight: 2.2, shape: 'circle', drillDiameter: 1.1 },
    ],
  },
  // Trimmer / panel potentiometer: wiper is the centre pin.
  'POT-3PIN': {
    packageId: 'POT-3PIN',
    name: 'Potentiometer (3 Pin, 2.54mm)',
    widthMm: 9.5,
    heightMm: 6.0,
    pads: [
      { pinNumber: '1', x: -2.54, y: 0, padWidth: 1.8, padHeight: 1.8, shape: 'rect', drillDiameter: 1.0 },
      { pinNumber: '2', x: 0, y: 0, padWidth: 1.8, padHeight: 1.8, shape: 'circle', drillDiameter: 1.0 },
      { pinNumber: '3', x: 2.54, y: 0, padWidth: 1.8, padHeight: 1.8, shape: 'circle', drillDiameter: 1.0 },
    ],
  },
  'HEADER-2x04': {
    packageId: 'HEADER-2x04',
    name: '2x4 Pin Header (8-Pin Dupont, 2.54mm)',
    widthMm: 10.66,
    heightMm: 5.58,
    pads: [
      { pinNumber: '1', x: -3.81, y: 1.27, padWidth: 1.6, padHeight: 1.6, shape: 'rect', drillDiameter: 0.9 },
      { pinNumber: '2', x: -1.27, y: 1.27, padWidth: 1.6, padHeight: 1.6, shape: 'circle', drillDiameter: 0.9 },
      { pinNumber: '3', x: 1.27, y: 1.27, padWidth: 1.6, padHeight: 1.6, shape: 'circle', drillDiameter: 0.9 },
      { pinNumber: '4', x: 3.81, y: 1.27, padWidth: 1.6, padHeight: 1.6, shape: 'circle', drillDiameter: 0.9 },
      { pinNumber: '5', x: -3.81, y: -1.27, padWidth: 1.6, padHeight: 1.6, shape: 'circle', drillDiameter: 0.9 },
      { pinNumber: '6', x: -1.27, y: -1.27, padWidth: 1.6, padHeight: 1.6, shape: 'circle', drillDiameter: 0.9 },
      { pinNumber: '7', x: 1.27, y: -1.27, padWidth: 1.6, padHeight: 1.6, shape: 'circle', drillDiameter: 0.9 },
      { pinNumber: '8', x: 3.81, y: -1.27, padWidth: 1.6, padHeight: 1.6, shape: 'circle', drillDiameter: 0.9 },
    ],
  },
  'CC1101': {
    packageId: 'CC1101',
    name: 'CC1101 RF Transceiver (2x4 Dupont Header)',
    widthMm: 19.0,
    heightMm: 17.0,
    pads: [
      { pinNumber: '1', x: -3.81, y: 1.27, padWidth: 1.6, padHeight: 1.6, shape: 'rect', drillDiameter: 0.9 },
      { pinNumber: '2', x: -1.27, y: 1.27, padWidth: 1.6, padHeight: 1.6, shape: 'circle', drillDiameter: 0.9 },
      { pinNumber: '3', x: 1.27, y: 1.27, padWidth: 1.6, padHeight: 1.6, shape: 'circle', drillDiameter: 0.9 },
      { pinNumber: '4', x: 3.81, y: 1.27, padWidth: 1.6, padHeight: 1.6, shape: 'circle', drillDiameter: 0.9 },
      { pinNumber: '5', x: -3.81, y: -1.27, padWidth: 1.6, padHeight: 1.6, shape: 'circle', drillDiameter: 0.9 },
      { pinNumber: '6', x: -1.27, y: -1.27, padWidth: 1.6, padHeight: 1.6, shape: 'circle', drillDiameter: 0.9 },
      { pinNumber: '7', x: 1.27, y: -1.27, padWidth: 1.6, padHeight: 1.6, shape: 'circle', drillDiameter: 0.9 },
      { pinNumber: '8', x: 3.81, y: -1.27, padWidth: 1.6, padHeight: 1.6, shape: 'circle', drillDiameter: 0.9 },
    ],
  },
};

export const STANDARD_FOOTPRINTS: Record<string, ComponentFootprint> = Object.fromEntries(
  Object.entries(RAW_STANDARD_FOOTPRINTS).map(([id, fp]) => [id, withContainedCourtyard(fp)])
);

/**
 * Maps React Flow node types (see components/nodes/registry.ts) to the default
 * package used when the user has not chosen one in the properties panel.
 */
const DEFAULT_PACKAGE_BY_TYPE: Record<string, string> = {
  resistor: 'AXIAL-0.3',
  diode: 'AXIAL-0.3',
  zener: 'AXIAL-0.3',
  inductor: 'AXIAL-0.3',
  capacitor: 'RADIAL-5MM',
  led: 'LED-5MM',
  ldr: 'RADIAL-5MM',
  npn: 'TO-92',
  pnp: 'TO-92',
  nmos: 'TO-220',
  pmos: 'TO-220',
  switch: 'TACT-4PIN',
  potentiometer: 'POT-3PIN',
  transformer: 'TRANSFORMER-4P',
  opamp: 'DIP-8',
  timer555: 'DIP-8',
  dff: 'DIP-14',
  and: 'DIP-14',
  or: 'DIP-14',
  nand: 'DIP-14',
  nor: 'DIP-14',
  xor: 'DIP-14',
  not: 'DIP-14',
  sevenseg: 'DIP-10',
  // Sources and instruments become wire-out connectors.
  voltage: 'TERMINAL-2P',
  acvoltage: 'TERMINAL-2P',
  currentsource: 'TERMINAL-2P',
  signalgen: 'TERMINAL-2P',
  speaker: 'TERMINAL-2P',
  microphone: 'TERMINAL-2P',
  // Dev boards break out to pin headers.
  mcu: 'HEADER-1x08',
  heltec_v4: 'HELTEC-V4',
};

// ---------------------------------------------------------------------------
// Which packages a part can sensibly be built in
// ---------------------------------------------------------------------------

/**
 * Every package the properties panel can offer, with the label it is offered
 * under. Grouped the way a parts catalogue is, because that is how someone
 * picks one.
 */
const PACKAGE_CATALOG: { group: string; id: string; label: string }[] = [
  { group: 'Through-Hole (THT)', id: 'AXIAL-0.3', label: 'Axial Resistor/Diode (0.3" / 7.62mm pitch)' },
  { group: 'Through-Hole (THT)', id: 'LED-5MM', label: 'Radial 5mm THT (LED / Capacitor)' },
  { group: 'Through-Hole (THT)', id: 'RADIAL-5MM', label: 'Radial 5mm (Electrolytic / LDR)' },
  { group: 'Through-Hole (THT)', id: 'TO-92', label: 'TO-92 Small Signal Transistor (BJT)' },
  { group: 'Through-Hole (THT)', id: 'TO-220', label: 'TO-220 Power Package (Regulator / MOSFET)' },
  { group: 'Through-Hole (THT)', id: 'TO-247', label: 'TO-247 High Power Transistor' },
  { group: 'Through-Hole (THT)', id: 'POT-3PIN', label: 'Potentiometer (3-Pin, 2.54mm)' },
  { group: 'Through-Hole (THT)', id: 'TACT-4PIN', label: '6x6mm Tactile Switch' },
  { group: 'Through-Hole (THT)', id: 'TRANSFORMER-4P', label: 'Transformer (2 Primary / 2 Secondary)' },
  { group: 'Through-Hole (THT)', id: 'DIP-8', label: 'DIP-8 IC Package' },
  { group: 'Through-Hole (THT)', id: 'DIP-10', label: 'DIP-10 (7-Segment Display)' },
  { group: 'Through-Hole (THT)', id: 'DIP-14', label: 'DIP-14 IC Package' },
  { group: 'Through-Hole (THT)', id: 'DIP-16', label: 'DIP-16 IC Package' },
  { group: 'Through-Hole (THT)', id: 'DIP-18', label: 'DIP-18 IC Package' },
  { group: 'Through-Hole (THT)', id: 'DIP-20', label: 'DIP-20 IC Package' },
  { group: 'Through-Hole (THT)', id: 'DIP-24', label: 'DIP-24 (0.3" narrow)' },
  { group: 'Through-Hole (THT)', id: 'DIP-24-W', label: 'DIP-24 (0.6" wide)' },
  { group: 'Through-Hole (THT)', id: 'DIP-28', label: 'DIP-28 (0.3" narrow — ATmega328P)' },
  { group: 'Through-Hole (THT)', id: 'DIP-28-W', label: 'DIP-28 (0.6" wide)' },
  { group: 'Through-Hole (THT)', id: 'DIP-32-W', label: 'DIP-32 (0.6" wide)' },
  { group: 'Through-Hole (THT)', id: 'DIP-40-W', label: 'DIP-40 (0.6" wide)' },

  { group: 'Connectors & Headers', id: 'HEADER-1x02', label: '1x2 Pin Header (2.54mm pitch)' },
  { group: 'Connectors & Headers', id: 'HEADER-1x03', label: '1x3 Pin Header (2.54mm pitch)' },
  { group: 'Connectors & Headers', id: 'HEADER-1x04', label: '1x4 Pin Header (2.54mm pitch)' },
  { group: 'Connectors & Headers', id: 'HEADER-1x06', label: '1x6 Pin Header (2.54mm pitch)' },
  { group: 'Connectors & Headers', id: 'HEADER-1x08', label: '1x8 Pin Header (2.54mm pitch)' },
  { group: 'Connectors & Headers', id: 'HEADER-2x02', label: '2x2 Pin Dupont Header (2.54mm pitch)' },
  { group: 'Connectors & Headers', id: 'HEADER-2x03', label: '2x3 Pin Dupont Header (2.54mm pitch)' },
  { group: 'Connectors & Headers', id: 'HEADER-2x04', label: '2x4 Pin Dupont Header (2.54mm pitch)' },
  { group: 'Connectors & Headers', id: 'HEADER-2x06', label: '2x6 Pin Dupont Header (2.54mm pitch)' },
  { group: 'Connectors & Headers', id: 'HEADER-2x08', label: '2x8 Pin Dupont Header (2.54mm pitch)' },
  { group: 'Connectors & Headers', id: 'TERMINAL-2P', label: '5.08mm Screw Terminal (2-Pin)' },
  { group: 'Connectors & Headers', id: 'TERMINAL-3P', label: '5.08mm Screw Terminal (3-Pin)' },

  { group: 'Modules', id: 'CC1101', label: 'CC1101 RF Module (2x4 Dupont Header)' },
  { group: 'Modules', id: 'HELTEC-V4', label: 'Heltec WiFi LoRa 32 V4 (Dual Header Board)' },

  { group: 'Surface Mount — Passives', id: '0402', label: 'SMD 0402 Passive (1.0 x 0.5mm)' },
  { group: 'Surface Mount — Passives', id: '0603', label: 'SMD 0603 Passive (1.6 x 0.8mm)' },
  { group: 'Surface Mount — Passives', id: '0805', label: 'SMD 0805 Passive (2.0 x 1.25mm)' },
  { group: 'Surface Mount — Passives', id: '1206', label: 'SMD 1206 Passive (3.2 x 1.6mm)' },
  { group: 'Surface Mount — Passives', id: '1210', label: 'SMD 1210 Passive (3.2 x 2.5mm)' },
  { group: 'Surface Mount — Passives', id: '2512', label: 'SMD 2512 Power Resistor (6.3 x 3.2mm)' },

  { group: 'Surface Mount — Diodes', id: 'SOD-123', label: 'SOD-123 Diode' },
  { group: 'Surface Mount — Diodes', id: 'SOD-323', label: 'SOD-323 Diode' },
  { group: 'Surface Mount — Diodes', id: 'SMA', label: 'SMA / DO-214AC Diode' },
  { group: 'Surface Mount — Diodes', id: 'SMB', label: 'SMB / DO-214AA Diode' },

  { group: 'Surface Mount — Discrete', id: 'SOT-23', label: 'SOT-23 Transistor (3-Pin)' },
  { group: 'Surface Mount — Discrete', id: 'SOT-23-5', label: 'SOT-23-5' },
  { group: 'Surface Mount — Discrete', id: 'SOT-23-6', label: 'SOT-23-6' },
  { group: 'Surface Mount — Discrete', id: 'SOT-323', label: 'SOT-323 / SC-70' },
  { group: 'Surface Mount — Discrete', id: 'SOT-89', label: 'SOT-89 Power Transistor' },
  { group: 'Surface Mount — Discrete', id: 'SOT-223', label: 'SOT-223 Regulator' },
  { group: 'Surface Mount — Discrete', id: 'TO-252', label: 'TO-252 / DPAK' },
  { group: 'Surface Mount — Discrete', id: 'TO-263', label: 'TO-263 / D2PAK' },

  { group: 'Surface Mount — Small Outline ICs', id: 'SOIC-8', label: 'SOIC-8 (1.27mm pitch)' },
  { group: 'Surface Mount — Small Outline ICs', id: 'SOIC-14', label: 'SOIC-14 (1.27mm pitch)' },
  { group: 'Surface Mount — Small Outline ICs', id: 'SOIC-16', label: 'SOIC-16 (1.27mm pitch)' },
  { group: 'Surface Mount — Small Outline ICs', id: 'SOIC-16-W', label: 'SOIC-16 Wide (7.5mm body)' },
  { group: 'Surface Mount — Small Outline ICs', id: 'SOIC-20-W', label: 'SOIC-20 Wide (7.5mm body)' },
  { group: 'Surface Mount — Small Outline ICs', id: 'SSOP-16', label: 'SSOP-16 (0.65mm pitch)' },
  { group: 'Surface Mount — Small Outline ICs', id: 'SSOP-20', label: 'SSOP-20 (0.65mm pitch)' },
  { group: 'Surface Mount — Small Outline ICs', id: 'TSSOP-8', label: 'TSSOP-8 (0.65mm pitch)' },
  { group: 'Surface Mount — Small Outline ICs', id: 'TSSOP-14', label: 'TSSOP-14 (0.65mm pitch)' },
  { group: 'Surface Mount — Small Outline ICs', id: 'TSSOP-16', label: 'TSSOP-16 (0.65mm pitch)' },
  { group: 'Surface Mount — Small Outline ICs', id: 'TSSOP-20', label: 'TSSOP-20 (0.65mm pitch)' },
  { group: 'Surface Mount — Small Outline ICs', id: 'TSSOP-28', label: 'TSSOP-28 (0.65mm pitch)' },
  { group: 'Surface Mount — Small Outline ICs', id: 'MSOP-8', label: 'MSOP-8 (0.65mm pitch)' },
  { group: 'Surface Mount — Small Outline ICs', id: 'MSOP-10', label: 'MSOP-10 (0.65mm pitch)' },
  { group: 'Surface Mount — Small Outline ICs', id: 'QSOP-16', label: 'QSOP-16 (0.635mm pitch)' },

  { group: 'Surface Mount — Quad (fine pitch)', id: 'QFN-16', label: 'QFN-16 (0.5mm pitch, 4mm body)' },
  { group: 'Surface Mount — Quad (fine pitch)', id: 'QFN-20', label: 'QFN-20 (0.5mm pitch)' },
  { group: 'Surface Mount — Quad (fine pitch)', id: 'QFN-24', label: 'QFN-24 (0.5mm pitch)' },
  { group: 'Surface Mount — Quad (fine pitch)', id: 'QFN-28', label: 'QFN-28 (0.5mm pitch)' },
  { group: 'Surface Mount — Quad (fine pitch)', id: 'QFN-32', label: 'QFN-32 (0.5mm pitch, 5mm body)' },
  { group: 'Surface Mount — Quad (fine pitch)', id: 'QFN-32-P0.65', label: 'QFN-32 (0.65mm pitch, 7mm body)' },
  { group: 'Surface Mount — Quad (fine pitch)', id: 'QFN-48', label: 'QFN-48 (0.5mm pitch, 7mm body)' },
  { group: 'Surface Mount — Quad (fine pitch)', id: 'QFN-64', label: 'QFN-64 (0.5mm pitch, 9mm body)' },
  { group: 'Surface Mount — Quad (fine pitch)', id: 'DFN-8', label: 'DFN-8 (0.5mm pitch)' },
  { group: 'Surface Mount — Quad (fine pitch)', id: 'DFN-10', label: 'DFN-10 (0.5mm pitch)' },
  { group: 'Surface Mount — Quad (fine pitch)', id: 'TQFP-32', label: 'TQFP-32 (0.8mm pitch, 7mm body)' },
  { group: 'Surface Mount — Quad (fine pitch)', id: 'TQFP-44', label: 'TQFP-44 (0.8mm pitch, 10mm body)' },
  { group: 'Surface Mount — Quad (fine pitch)', id: 'TQFP-64', label: 'TQFP-64 (0.5mm pitch, 10mm body)' },
  { group: 'Surface Mount — Quad (fine pitch)', id: 'TQFP-100', label: 'TQFP-100 (0.5mm pitch, 14mm body)' },
  { group: 'Surface Mount — Quad (fine pitch)', id: 'LQFP-48', label: 'LQFP-48 (0.5mm pitch)' },
  { group: 'Surface Mount — Quad (fine pitch)', id: 'LQFP-64', label: 'LQFP-64 (0.5mm pitch)' },
];

/** Two-lead SMD chip sizes, shared by every discrete passive. */
const CHIP_PASSIVES = ['0402', '0603', '0805', '1206', '1210'];
/** Anything a two-pin part can be wired out through. */
const TWO_PIN_CONNECTORS = ['HEADER-1x02', 'TERMINAL-2P'];
/** Dual-in-line logic bodies, THT and SMD, for the 14/16-pin gate families. */
const LOGIC_BODIES = [
  'DIP-14', 'DIP-16', 'SOIC-14', 'SOIC-16', 'TSSOP-14', 'TSSOP-16', 'SSOP-16',
];

/**
 * Packages each node type can actually be bought in, in the order they should
 * be offered. The whole catalogue is the wrong list for a specific part: a
 * DIP-16 offered for an LED is not a choice, it is a way to mill a board with
 * sixteen holes where a two-lead part goes, and nothing downstream can tell
 * that from a deliberate decision.
 *
 * A type absent from here gets the whole catalogue, which is the right
 * behaviour for anything whose shape is genuinely open — an MCU, or a node
 * type added after this table.
 */
const PACKAGES_BY_TYPE: Record<string, string[]> = {
  resistor: ['AXIAL-0.3', ...CHIP_PASSIVES, '2512', ...TWO_PIN_CONNECTORS],
  inductor: ['AXIAL-0.3', 'RADIAL-5MM', ...CHIP_PASSIVES, ...TWO_PIN_CONNECTORS],
  capacitor: ['RADIAL-5MM', 'LED-5MM', 'AXIAL-0.3', ...CHIP_PASSIVES, ...TWO_PIN_CONNECTORS],
  led: ['LED-5MM', 'RADIAL-5MM', '0603', '0805', '1206', ...TWO_PIN_CONNECTORS],
  ldr: ['RADIAL-5MM', 'LED-5MM', ...TWO_PIN_CONNECTORS],
  diode: ['AXIAL-0.3', 'SOD-123', 'SOD-323', 'SMA', 'SMB', ...TWO_PIN_CONNECTORS],
  zener: ['AXIAL-0.3', 'SOD-123', 'SOD-323', 'SMA', 'SMB', ...TWO_PIN_CONNECTORS],

  npn: ['TO-92', 'TO-220', 'SOT-23', 'SOT-323', 'SOT-89', 'SOT-223', 'TO-252'],
  pnp: ['TO-92', 'TO-220', 'SOT-23', 'SOT-323', 'SOT-89', 'SOT-223', 'TO-252'],
  nmos: ['TO-220', 'TO-247', 'TO-92', 'SOT-23', 'SOT-89', 'SOT-223', 'TO-252', 'TO-263'],
  pmos: ['TO-220', 'TO-247', 'TO-92', 'SOT-23', 'SOT-89', 'SOT-223', 'TO-252', 'TO-263'],

  switch: ['TACT-4PIN', 'HEADER-1x02', 'HEADER-1x03', 'TERMINAL-2P'],
  potentiometer: ['POT-3PIN', 'HEADER-1x03', 'TERMINAL-3P'],
  transformer: ['TRANSFORMER-4P', 'HEADER-2x02', 'HEADER-1x04', 'TERMINAL-2P'],

  // Op-amps come single (8-pin) and quad (14-pin); the 555 is 8-pin only.
  opamp: ['DIP-8', 'SOIC-8', 'TSSOP-8', 'MSOP-8', 'DFN-8', 'DIP-14', 'SOIC-14', 'TSSOP-14'],
  timer555: ['DIP-8', 'SOIC-8', 'TSSOP-8', 'MSOP-8', 'DFN-8'],

  and: LOGIC_BODIES,
  or: LOGIC_BODIES,
  nand: LOGIC_BODIES,
  nor: LOGIC_BODIES,
  xor: LOGIC_BODIES,
  not: LOGIC_BODIES,
  dff: LOGIC_BODIES,
  sevenseg: ['DIP-10', 'DIP-14', 'DIP-16'],

  // Sources and instruments are not parts on the board — they are where the
  // bench wires on, so every option is a connector.
  voltage: ['TERMINAL-2P', 'TERMINAL-3P', 'HEADER-1x02', 'HEADER-1x03'],
  acvoltage: ['TERMINAL-2P', 'TERMINAL-3P', 'HEADER-1x02', 'HEADER-1x03'],
  currentsource: ['TERMINAL-2P', 'HEADER-1x02'],
  signalgen: ['TERMINAL-2P', 'HEADER-1x02', 'HEADER-1x03'],
  speaker: ['TERMINAL-2P', 'HEADER-1x02'],
  microphone: ['TERMINAL-2P', 'HEADER-1x02', 'HEADER-1x03'],

  heltec_v4: ['HELTEC-V4', 'HEADER-2x08', 'HEADER-1x08'],
};

/**
 * Node types whose footprint is generated from their own data — pitch, drill,
 * hole size, cutout shape — and which ignore `packageId` entirely (see
 * {@link resolveFootprint}). Offering a package selector for one of these is
 * offering a control that does nothing.
 */
const SELF_DESCRIBING_TYPES = new Set([
  'pinheader', 'via', 'mountinghole', 'jumper', 'cutout',
]);

/** Whether the properties panel should offer a package selector at all. */
export function supportsPackageSelection(componentType?: string): boolean {
  return !SELF_DESCRIBING_TYPES.has((componentType || '').toLowerCase());
}

export interface PackageOptionGroup {
  label: string;
  options: { id: string; label: string }[];
}

/**
 * The packages worth offering for a node type, grouped for a `<select>`.
 *
 * `currentId` is always included even when it is not on the type's list: a
 * board saved with a package this table would not offer must keep milling the
 * footprint it was designed around, and silently swapping the selection for
 * the first sane option is how a layout changes shape behind someone's back.
 */
export function packageOptionsForType(
  componentType?: string,
  currentId?: string
): PackageOptionGroup[] {
  const type = (componentType || '').toLowerCase();
  const allowed = PACKAGES_BY_TYPE[type];

  const byId = new Map(PACKAGE_CATALOG.map(entry => [entry.id, entry]));
  const chosen = allowed
    ? allowed.filter(id => byId.has(id)).map(id => byId.get(id)!)
    : PACKAGE_CATALOG;

  const entries = [...chosen];
  if (currentId && !entries.some(e => e.id === currentId)) {
    const known = byId.get(currentId);
    entries.unshift(
      known ?? { group: 'Currently set', id: currentId, label: `${currentId} (set on this part)` }
    );
  }

  const groups: PackageOptionGroup[] = [];
  for (const entry of entries) {
    let group = groups.find(g => g.label === entry.group);
    if (!group) {
      group = { label: entry.group, options: [] };
      groups.push(group);
    }
    if (!group.options.some(o => o.id === entry.id)) {
      group.options.push({ id: entry.id, label: entry.label });
    }
  }
  return groups;
}

/** The default package id for a node type, if one is defined. */
export function defaultPackageForType(componentType?: string): string | undefined {
  return DEFAULT_PACKAGE_BY_TYPE[(componentType || '').toLowerCase()];
}

import {
  getEffectiveMcuConfig,
  rightColumnRunsUp,
  type McuGeometryConfig,
  type McuPinDef,
} from './mcuConfig';

export function generateHeaderFootprint(pinCount: number, pitch = 2.54): ComponentFootprint {
  const count = Math.max(1, pinCount);
  const totalWidth = count * pitch;
  const startX = -((count - 1) * pitch) / 2;

  const pads: PadSpec[] = [];
  for (let i = 0; i < count; i++) {
    pads.push({
      pinNumber: (i + 1).toString(),
      x: startX + i * pitch,
      y: 0,
      padWidth: 1.8,
      padHeight: 1.8,
      shape: i === 0 ? 'rect' : 'circle',
      drillDiameter: 1.0,
    });
  }

  return {
    packageId: `HEADER-1x${count}`,
    name: `${count}-Pin Header (${pitch}mm)`,
    widthMm: totalWidth + 0.5,
    heightMm: 2.54,
    pads,
  };
}

// ---------------------------------------------------------------------------
// Dual-row engine
//
// Every two-column part — DIP chips, SOIC/TSSOP, and breakout modules whose
// board width, pin pitch, row spacing and per-side pin offsets are all
// arbitrary — is the same layout problem. This one generator covers all of
// them; the named wrappers below just supply the family's dimensions.
// ---------------------------------------------------------------------------

export interface DualRowSpec {
  leftCount: number;
  rightCount: number;
  pitchMm: number;
  /** Centre-to-centre distance between the two pad columns. */
  rowSpacingMm: number;
  padWidthMm: number;
  padHeightMm: number;
  /** 0 makes the part surface-mount. */
  drillDiaMm: number;
  bodyWidthMm?: number;
  bodyHeightMm?: number;
  /**
   * Shifts a column along Y, positive towards pin 1. Modules routinely stagger
   * their two headers, and a symmetric-only generator cannot express that.
   */
  leftOffsetMm?: number;
  rightOffsetMm?: number;
  /** Pin numbers, in order, defaulting to 1..N. */
  pinLabels?: (string | number)[];
  packageId?: string;
  name?: string;
}

export function generateDualRowFootprint(spec: DualRowSpec): ComponentFootprint {
  const leftCount = Math.max(0, Math.round(spec.leftCount));
  const rightCount = Math.max(0, Math.round(spec.rightCount));
  const total = leftCount + rightCount;
  const pitch = Math.max(0.2, spec.pitchMm);
  const rowSpacing = Math.max(0, spec.rowSpacingMm);
  const isSmd = spec.drillDiaMm <= 0;
  const padW = Math.max(0.1, spec.padWidthMm);
  const padH = Math.max(0.1, spec.padHeightMm);
  const shape: PadSpec['shape'] = isSmd ? 'rect' : 'circle';

  const label = (i: number) => spec.pinLabels?.[i] ?? (i + 1).toString();

  const pads: PadSpec[] = [];

  // Left column runs top to bottom, right column bottom to top — the pin-1
  // -is-top-left, counter-clockwise convention every dual-row part uses.
  const leftSpan = ((leftCount - 1) * pitch) / 2;
  for (let i = 0; i < leftCount; i++) {
    pads.push({
      pinNumber: label(i),
      x: -rowSpacing / 2,
      y: leftSpan - i * pitch + (spec.leftOffsetMm ?? 0),
      padWidth: padW,
      padHeight: padH,
      shape: i === 0 ? 'rect' : shape,
      drillDiameter: Math.max(0, spec.drillDiaMm),
    });
  }

  const rightSpan = ((rightCount - 1) * pitch) / 2;
  for (let i = 0; i < rightCount; i++) {
    pads.push({
      pinNumber: label(leftCount + i),
      x: rowSpacing / 2,
      y: -rightSpan + i * pitch + (spec.rightOffsetMm ?? 0),
      padWidth: padW,
      padHeight: padH,
      shape,
      drillDiameter: Math.max(0, spec.drillDiaMm),
    });
  }

  // The courtyard has to contain the copper even when the caller's body size
  // does not, or the placer will happily overlap two parts that physically
  // collide.
  const padExtentX = rowSpacing + padW;
  const maxRowPins = Math.max(leftCount, rightCount, 1);
  const maxOffset = Math.max(Math.abs(spec.leftOffsetMm ?? 0), Math.abs(spec.rightOffsetMm ?? 0));
  const padExtentY = (maxRowPins - 1) * pitch + padH + maxOffset * 2;

  return {
    packageId: spec.packageId ?? `DUAL-${total}`,
    name: spec.name ?? `${total}-Pin Dual Row (${pitch}mm pitch, ${rowSpacing}mm rows)`,
    widthMm: Math.max(spec.bodyWidthMm ?? 0, padExtentX),
    heightMm: Math.max(spec.bodyHeightMm ?? 0, padExtentY),
    pads,
  };
}

/** Row spacing in mm for the two standard DIP body widths. */
export const DIP_ROW_SPACING = { narrow: 7.62, wide: 15.24 } as const;

export interface DipOptions {
  /**
   * Row spacing in mm, or 'narrow' (0.3") / 'wide' (0.6"). Defaults by pin
   * count, which is a guess — an ATmega328P is a 28-pin *narrow* part and a
   * 68HC11 is a 28-pin wide one, and only the datasheet knows which.
   */
  rowSpacing?: number | 'narrow' | 'wide';
  pitchMm?: number;
  padDiaMm?: number;
  drillDiaMm?: number;
  bodyWidthMm?: number;
  bodyHeightMm?: number;
}

export function generateDIPFootprint(pinCount: number, opts: DipOptions = {}): ComponentFootprint {
  const count = Math.max(4, pinCount % 2 === 0 ? pinCount : pinCount + 1);
  const pinsPerSide = count / 2;
  const pitch = opts.pitchMm ?? 2.54;

  // 0.6" bodies start at DIP-32 in practice; 24- and 28-pin parts exist in both
  // widths and default to narrow, which is the far more common modern part.
  const defaultSpacing = count >= 32 ? DIP_ROW_SPACING.wide : DIP_ROW_SPACING.narrow;
  const rowSpacing =
    typeof opts.rowSpacing === 'number'
      ? opts.rowSpacing
      : opts.rowSpacing === 'wide'
        ? DIP_ROW_SPACING.wide
        : opts.rowSpacing === 'narrow'
          ? DIP_ROW_SPACING.narrow
          : defaultSpacing;

  const pad = opts.padDiaMm ?? 1.6;
  const widthLabel = rowSpacing === DIP_ROW_SPACING.wide ? ' Wide' : '';

  return generateDualRowFootprint({
    leftCount: pinsPerSide,
    rightCount: pinsPerSide,
    pitchMm: pitch,
    rowSpacingMm: rowSpacing,
    padWidthMm: pad,
    padHeightMm: pad,
    drillDiaMm: opts.drillDiaMm ?? 0.8,
    bodyWidthMm: opts.bodyWidthMm ?? rowSpacing + 2.5,
    bodyHeightMm: opts.bodyHeightMm ?? pinsPerSide * pitch + 1.0,
    packageId: `DIP-${count}`,
    name: `DIP-${count}${widthLabel} Integrated Circuit (${rowSpacing}mm rows)`,
  });
}

// ---------------------------------------------------------------------------
// Gull-wing / small-outline SMD families
// ---------------------------------------------------------------------------

interface DualSmdFamily {
  pitchMm: number;
  /** Centre-to-centre across the two pad columns. */
  spanMm: number;
  /** Pad extent along X, i.e. how far the toe reaches out from the body. */
  padLengthMm: number;
  /** Pad extent along Y. */
  padWidthMm: number;
  /** Body width across the plastic, used for the courtyard. */
  bodyWidthMm: number;
  label: string;
}

export const SMD_DUAL_FAMILIES: Record<string, DualSmdFamily> = {
  SOIC: { pitchMm: 1.27, spanMm: 5.4, padLengthMm: 1.55, padWidthMm: 0.6, bodyWidthMm: 3.9, label: 'SOIC Narrow' },
  'SOIC-W': { pitchMm: 1.27, spanMm: 9.4, padLengthMm: 1.95, padWidthMm: 0.6, bodyWidthMm: 7.5, label: 'SOIC Wide' },
  SOP: { pitchMm: 1.27, spanMm: 5.4, padLengthMm: 1.55, padWidthMm: 0.6, bodyWidthMm: 3.9, label: 'SOP' },
  SOJ: { pitchMm: 1.27, spanMm: 8.0, padLengthMm: 1.4, padWidthMm: 0.7, bodyWidthMm: 7.5, label: 'SOJ' },
  QSOP: { pitchMm: 0.635, spanMm: 5.4, padLengthMm: 1.45, padWidthMm: 0.4, bodyWidthMm: 3.9, label: 'QSOP' },
  SSOP: { pitchMm: 0.65, spanMm: 7.2, padLengthMm: 1.6, padWidthMm: 0.4, bodyWidthMm: 5.3, label: 'SSOP' },
  TSSOP: { pitchMm: 0.65, spanMm: 6.4, padLengthMm: 1.45, padWidthMm: 0.45, bodyWidthMm: 4.4, label: 'TSSOP' },
  TSOP: { pitchMm: 0.5, spanMm: 11.0, padLengthMm: 1.5, padWidthMm: 0.3, bodyWidthMm: 10.16, label: 'TSOP' },
  MSOP: { pitchMm: 0.65, spanMm: 4.4, padLengthMm: 1.45, padWidthMm: 0.4, bodyWidthMm: 3.0, label: 'MSOP' },
  VSSOP: { pitchMm: 0.5, spanMm: 4.4, padLengthMm: 1.4, padWidthMm: 0.3, bodyWidthMm: 3.0, label: 'VSSOP' },
};

export interface DualSmdOptions {
  pitchMm?: number;
  spanMm?: number;
  padLengthMm?: number;
  padWidthMm?: number;
  bodyWidthMm?: number;
  bodyHeightMm?: number;
}

/**
 * SOIC / SSOP / TSSOP / MSOP and friends: two gull-wing rows, pin 1 top-left,
 * numbering counter-clockwise.
 */
export function generateDualSmdFootprint(
  family: string,
  pinCount: number,
  opts: DualSmdOptions = {}
): ComponentFootprint {
  const fam = SMD_DUAL_FAMILIES[family] ?? SMD_DUAL_FAMILIES.SOIC;
  const count = Math.max(4, pinCount % 2 === 0 ? pinCount : pinCount + 1);
  const perSide = count / 2;
  const pitch = opts.pitchMm ?? fam.pitchMm;
  const span = opts.spanMm ?? fam.spanMm;
  const padLength = opts.padLengthMm ?? fam.padLengthMm;
  const padWidth = opts.padWidthMm ?? fam.padWidthMm;

  return generateDualRowFootprint({
    leftCount: perSide,
    rightCount: perSide,
    pitchMm: pitch,
    rowSpacingMm: span,
    padWidthMm: padLength,
    padHeightMm: padWidth,
    drillDiaMm: 0,
    bodyWidthMm: opts.bodyWidthMm ?? Math.max(fam.bodyWidthMm, span + padLength),
    bodyHeightMm: opts.bodyHeightMm ?? perSide * pitch + 0.8,
    packageId: `${family}-${count}`,
    name: `${fam.label}-${count} (${pitch}mm pitch, ${span}mm span)`,
  });
}

// ---------------------------------------------------------------------------
// Quad packages: QFN / DFN / QFP / TQFP / LQFP
// ---------------------------------------------------------------------------

export interface QuadSpec {
  /** Total signal pins. Distributed evenly over four sides unless overridden. */
  pinCount: number;
  pinsPerSide?: number;
  pitchMm: number;
  /** Pad extent pointing away from the die. */
  padLengthMm: number;
  /** Pad extent along its edge. */
  padWidthMm: number;
  /** Centre-to-centre between pads on opposite sides. */
  padSpanMm: number;
  bodyWidthMm?: number;
  bodyHeightMm?: number;
  /** Exposed thermal pad, centred. Omit for a package that has none. */
  thermalPadWidthMm?: number;
  thermalPadHeightMm?: number;
  packageId?: string;
  name?: string;
}

/**
 * Pads run counter-clockwise from the top of the left edge: down the left side,
 * left-to-right along the bottom, up the right side, then right-to-left across
 * the top. That is the numbering every QFP and QFN datasheet uses.
 */
export function generateQuadFootprint(spec: QuadSpec): ComponentFootprint {
  const total = Math.max(4, Math.round(spec.pinCount));
  const perSide = Math.max(1, Math.round(spec.pinsPerSide ?? Math.ceil(total / 4)));
  const pitch = Math.max(0.15, spec.pitchMm);
  const half = Math.max(0.1, spec.padSpanMm) / 2;
  const padLength = Math.max(0.1, spec.padLengthMm);
  const padWidth = Math.max(0.1, spec.padWidthMm);

  const pads: PadSpec[] = [];
  let pin = 1;

  const edgeStart = (n: number) => ((n - 1) * pitch) / 2;

  const remaining = () => total - (pin - 1);
  const sideCount = () => Math.min(perSide, remaining());

  // Left: top to bottom.
  {
    const n = sideCount();
    const start = edgeStart(n);
    for (let i = 0; i < n; i++, pin++) {
      pads.push({
        pinNumber: pin.toString(), x: -half, y: start - i * pitch,
        padWidth: padLength, padHeight: padWidth, shape: 'rect', drillDiameter: 0,
      });
    }
  }
  // Bottom: left to right.
  {
    const n = sideCount();
    const start = -edgeStart(n);
    for (let i = 0; i < n; i++, pin++) {
      pads.push({
        pinNumber: pin.toString(), x: start + i * pitch, y: -half,
        padWidth: padWidth, padHeight: padLength, shape: 'rect', drillDiameter: 0,
      });
    }
  }
  // Right: bottom to top.
  {
    const n = sideCount();
    const start = -edgeStart(n);
    for (let i = 0; i < n; i++, pin++) {
      pads.push({
        pinNumber: pin.toString(), x: half, y: start + i * pitch,
        padWidth: padLength, padHeight: padWidth, shape: 'rect', drillDiameter: 0,
      });
    }
  }
  // Top: right to left.
  {
    const n = sideCount();
    const start = edgeStart(n);
    for (let i = 0; i < n; i++, pin++) {
      pads.push({
        pinNumber: pin.toString(), x: start - i * pitch, y: half,
        padWidth: padWidth, padHeight: padLength, shape: 'rect', drillDiameter: 0,
      });
    }
  }

  if (spec.thermalPadWidthMm && spec.thermalPadHeightMm) {
    pads.push({
      pinNumber: 'EP',
      x: 0,
      y: 0,
      padWidth: spec.thermalPadWidthMm,
      padHeight: spec.thermalPadHeightMm,
      shape: 'rect',
      drillDiameter: 0,
      role: 'thermal',
    });
  }

  const copperExtent = spec.padSpanMm + padLength;
  return {
    packageId: spec.packageId ?? `QUAD-${total}`,
    name: spec.name ?? `${total}-Pin Quad (${pitch}mm pitch)`,
    widthMm: Math.max(spec.bodyWidthMm ?? 0, copperExtent),
    heightMm: Math.max(spec.bodyHeightMm ?? 0, copperExtent),
    pads,
  };
}

interface QuadFamily {
  /** Leads are under the body (QFN/DFN) or gull-wing outside it (QFP). */
  leadless: boolean;
  defaultPitchMm: number;
  label: string;
}

export const QUAD_FAMILIES: Record<string, QuadFamily> = {
  QFN: { leadless: true, defaultPitchMm: 0.5, label: 'QFN' },
  VQFN: { leadless: true, defaultPitchMm: 0.5, label: 'VQFN' },
  WQFN: { leadless: true, defaultPitchMm: 0.4, label: 'WQFN' },
  QFP: { leadless: false, defaultPitchMm: 0.8, label: 'QFP' },
  TQFP: { leadless: false, defaultPitchMm: 0.8, label: 'TQFP' },
  LQFP: { leadless: false, defaultPitchMm: 0.5, label: 'LQFP' },
};

/**
 * DFN and SON are leadless like a QFN but carry pins on two sides only — the
 * D is for Dual. Running them through the quad generator would spread eight
 * pins over four edges and put the pads nowhere near the part.
 */
export const LEADLESS_DUAL_FAMILIES: Record<string, { defaultPitchMm: number; label: string }> = {
  DFN: { defaultPitchMm: 0.5, label: 'DFN' },
  VDFN: { defaultPitchMm: 0.5, label: 'VDFN' },
  WDFN: { defaultPitchMm: 0.4, label: 'WDFN' },
  SON: { defaultPitchMm: 0.5, label: 'SON' },
};

export function generateLeadlessDualFootprint(
  family: string,
  pinCount: number,
  opts: QuadOptions = {}
): ComponentFootprint {
  const fam = LEADLESS_DUAL_FAMILIES[family] ?? LEADLESS_DUAL_FAMILIES.DFN;
  const count = Math.max(2, pinCount % 2 === 0 ? pinCount : pinCount + 1);
  const perSide = count / 2;
  const pitch = opts.pitchMm ?? fam.defaultPitchMm;
  const nominal = quadPadForPitch(pitch, true);
  const padLength = opts.padLengthMm ?? nominal.length;
  const padWidth = opts.padWidthMm ?? nominal.width;

  const body = opts.bodyMm ?? Math.max(1.5, Math.ceil(((perSide - 1) * pitch + 1.5) * 2) / 2);
  // Same 0.2mm solder toe as a QFN. There is no adjacent edge here, so the
  // corner clamp the quad generator needs does not apply.
  const span = opts.padSpanMm ?? body + 0.4 - padLength;

  const thermal = opts.thermalPadMm ?? Math.max(0, body - 2 * padLength - 0.6);

  const fp = generateDualRowFootprint({
    leftCount: perSide,
    rightCount: perSide,
    pitchMm: pitch,
    rowSpacingMm: span,
    padWidthMm: padLength,
    padHeightMm: padWidth,
    drillDiaMm: 0,
    bodyWidthMm: body,
    bodyHeightMm: body,
    packageId: `${family}-${count}`,
    name: `${fam.label}-${count} (${pitch}mm pitch, ${body}mm body)`,
  });

  if (thermal > 0.2) {
    fp.pads.push({
      pinNumber: 'EP',
      x: 0,
      y: 0,
      padWidth: thermal,
      padHeight: Math.min(thermal, (perSide - 1) * pitch + padWidth),
      shape: 'rect',
      drillDiameter: 0,
      role: 'thermal',
    });
  }
  return fp;
}

/** Pad geometry scales with pitch; these are the usual IPC nominal-density values. */
function quadPadForPitch(pitchMm: number, leadless: boolean): { length: number; width: number } {
  if (leadless) {
    if (pitchMm <= 0.4) return { length: 0.70, width: 0.20 };
    if (pitchMm <= 0.5) return { length: 0.75, width: 0.28 };
    if (pitchMm <= 0.65) return { length: 0.85, width: 0.35 };
    return { length: 0.95, width: 0.45 };
  }
  if (pitchMm <= 0.4) return { length: 1.20, width: 0.22 };
  if (pitchMm <= 0.5) return { length: 1.35, width: 0.28 };
  if (pitchMm <= 0.65) return { length: 1.45, width: 0.38 };
  if (pitchMm <= 0.8) return { length: 1.50, width: 0.50 };
  return { length: 1.60, width: 0.60 };
}

export interface QuadOptions {
  pitchMm?: number;
  bodyMm?: number;
  padLengthMm?: number;
  padWidthMm?: number;
  padSpanMm?: number;
  /** Pass 0 to suppress the default exposed pad on a leadless package. */
  thermalPadMm?: number;
}

export function generateQuadFamilyFootprint(
  family: string,
  pinCount: number,
  opts: QuadOptions = {}
): ComponentFootprint {
  const fam = QUAD_FAMILIES[family] ?? QUAD_FAMILIES.QFN;
  const total = Math.max(4, Math.round(pinCount));
  const perSide = Math.ceil(total / 4);
  const pitch = opts.pitchMm ?? fam.defaultPitchMm;
  const nominal = quadPadForPitch(pitch, fam.leadless);
  const padWidth = opts.padWidthMm ?? nominal.width;
  let padLength = opts.padLengthMm ?? nominal.length;

  // Body holds one row of pins plus the corner keep-out, rounded up to the
  // 0.5mm steps real packages come in. For leadless parts this reproduces the
  // standard sizes exactly (QFN-16 -> 3mm, -32 -> 5mm, -48 -> 7mm, -64 -> 9mm).
  // The gull-wing estimate errs generous, since the courtyard only has to
  // contain the part; pass `bodyMm` (or a `-B` token) for an exact datasheet
  // figure.
  const bodyRaw = (perSide - 1) * pitch + (fam.leadless ? 1.5 : 2.5);
  const body = opts.bodyMm ?? Math.max(2, Math.ceil(bodyRaw * 2) / 2);

  // Gull-wing leads reach well outside the body. Leadless lands sit almost
  // flush, protruding 0.2mm past the body edge for a solder fillet.
  const leadlessToeMm = 0.2;
  const outerRadius = fam.leadless ? body / 2 + leadlessToeMm : body / 2 + 0.8 + padLength / 2;

  // The corners are the binding constraint on a leadless package. The last pin
  // of one edge sits right beside the inner end of the next edge's pads, and a
  // factory land pattern leaves as little as 0.03mm there — photolithography
  // does not care, but no milling bit fits. Shortening the land pushes its
  // inner end outward until the corner is at least as open as the gap between
  // two neighbouring pads on the same edge, which is the width the isolation
  // tool has to fit through anyway. The cost is a slightly smaller solder
  // fillet; the alternative is a package that cannot be milled at all.
  if (fam.leadless && opts.padLengthMm === undefined && opts.padSpanMm === undefined) {
    const sameEdgeGap = Math.max(0.05, pitch - padWidth);
    const cornerLimit = outerRadius - ((perSide - 1) * pitch) / 2 - padWidth / 2 - sameEdgeGap;
    padLength = Math.max(0.25, Math.min(padLength, cornerLimit));
  }

  const pad = { length: padLength, width: padWidth };
  const padSpan = opts.padSpanMm ?? (fam.leadless ? 2 * outerRadius - pad.length : body + 1.6);

  const thermal = opts.thermalPadMm ?? (fam.leadless ? Math.max(1.0, body - 2 * pad.length - 0.6) : 0);

  return generateQuadFootprint({
    pinCount: total,
    pinsPerSide: perSide,
    pitchMm: pitch,
    padLengthMm: pad.length,
    padWidthMm: pad.width,
    padSpanMm: padSpan,
    bodyWidthMm: body,
    bodyHeightMm: body,
    thermalPadWidthMm: thermal > 0 ? thermal : undefined,
    thermalPadHeightMm: thermal > 0 ? thermal : undefined,
    packageId: `${family}-${total}`,
    name: `${fam.label}-${total} (${pitch}mm pitch, ${body}mm body)`,
  });
}

// ---------------------------------------------------------------------------
// Two-terminal SMD: chip passives, SOD diodes, SMA/SMB/SMC
// ---------------------------------------------------------------------------

interface TwoPadSmd {
  bodyWidthMm: number;
  bodyHeightMm: number;
  padWidthMm: number;
  padHeightMm: number;
  /** Centre-to-centre between the two pads. */
  padSpanMm: number;
  label: string;
}

export const SMD_TWO_PAD_SIZES: Record<string, TwoPadSmd> = {
  '0201': { bodyWidthMm: 0.6, bodyHeightMm: 0.3, padWidthMm: 0.4, padHeightMm: 0.4, padSpanMm: 0.66, label: '0201 Passive' },
  '0402': { bodyWidthMm: 1.0, bodyHeightMm: 0.5, padWidthMm: 0.6, padHeightMm: 0.6, padSpanMm: 1.1, label: '0402 Passive' },
  '0603': { bodyWidthMm: 1.6, bodyHeightMm: 0.8, padWidthMm: 0.9, padHeightMm: 0.9, padSpanMm: 1.7, label: '0603 Passive' },
  // 0805 and 1206 mirror the hand-written STANDARD_FOOTPRINTS entries, which
  // take priority in resolveFootprint. Keep the two in step if either changes.
  '0805': { bodyWidthMm: 2.0, bodyHeightMm: 1.25, padWidthMm: 1.0, padHeightMm: 1.3, padSpanMm: 1.9, label: '0805 Passive' },
  '1206': { bodyWidthMm: 3.2, bodyHeightMm: 1.6, padWidthMm: 1.2, padHeightMm: 1.7, padSpanMm: 3.0, label: '1206 Passive' },
  '1210': { bodyWidthMm: 3.2, bodyHeightMm: 2.5, padWidthMm: 1.2, padHeightMm: 2.6, padSpanMm: 3.0, label: '1210 Passive' },
  '1812': { bodyWidthMm: 4.6, bodyHeightMm: 3.2, padWidthMm: 1.4, padHeightMm: 3.4, padSpanMm: 4.2, label: '1812 Passive' },
  '2010': { bodyWidthMm: 5.0, bodyHeightMm: 2.5, padWidthMm: 1.5, padHeightMm: 2.7, padSpanMm: 4.6, label: '2010 Passive' },
  '2512': { bodyWidthMm: 6.3, bodyHeightMm: 3.2, padWidthMm: 1.6, padHeightMm: 3.4, padSpanMm: 5.9, label: '2512 Power Resistor' },
  'SOD-123': { bodyWidthMm: 3.7, bodyHeightMm: 1.8, padWidthMm: 1.0, padHeightMm: 1.2, padSpanMm: 3.0, label: 'SOD-123 Diode' },
  'SOD-323': { bodyWidthMm: 2.5, bodyHeightMm: 1.4, padWidthMm: 0.8, padHeightMm: 0.9, padSpanMm: 2.2, label: 'SOD-323 Diode' },
  'SOD-523': { bodyWidthMm: 1.6, bodyHeightMm: 0.9, padWidthMm: 0.6, padHeightMm: 0.7, padSpanMm: 1.4, label: 'SOD-523 Diode' },
  SMA: { bodyWidthMm: 5.5, bodyHeightMm: 2.8, padWidthMm: 1.6, padHeightMm: 1.8, padSpanMm: 4.4, label: 'SMA (DO-214AC) Diode' },
  SMB: { bodyWidthMm: 6.0, bodyHeightMm: 3.7, padWidthMm: 2.0, padHeightMm: 2.3, padSpanMm: 4.6, label: 'SMB (DO-214AA) Diode' },
  SMC: { bodyWidthMm: 8.0, bodyHeightMm: 6.2, padWidthMm: 2.4, padHeightMm: 3.3, padSpanMm: 6.2, label: 'SMC (DO-214AB) Diode' },
  MELF: { bodyWidthMm: 5.8, bodyHeightMm: 2.2, padWidthMm: 1.6, padHeightMm: 2.4, padSpanMm: 4.4, label: 'MELF Passive' },
  MINIMELF: { bodyWidthMm: 3.6, bodyHeightMm: 1.4, padWidthMm: 1.1, padHeightMm: 1.6, padSpanMm: 2.8, label: 'MiniMELF Passive' },
};

/** Polarised parts get pin 1 as a rectangle so the silkscreen keys correctly. */
export function generateTwoPadSmdFootprint(sizeCode: string): ComponentFootprint | null {
  const s = SMD_TWO_PAD_SIZES[sizeCode];
  if (!s) return null;
  return {
    packageId: sizeCode,
    name: `${s.label} (${s.bodyWidthMm} x ${s.bodyHeightMm}mm)`,
    widthMm: Math.max(s.bodyWidthMm, s.padSpanMm + s.padWidthMm),
    heightMm: Math.max(s.bodyHeightMm, s.padHeightMm),
    pads: [
      { pinNumber: '1', x: -s.padSpanMm / 2, y: 0, padWidth: s.padWidthMm, padHeight: s.padHeightMm, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '2', x: s.padSpanMm / 2, y: 0, padWidth: s.padWidthMm, padHeight: s.padHeightMm, shape: 'rect', drillDiameter: 0 },
    ],
  };
}

// ---------------------------------------------------------------------------
// Discrete SMD transistor / regulator outlines
// ---------------------------------------------------------------------------

/**
 * SOT and DPAK style parts. These are irregular enough — offset pins, a fat
 * tab on one side — that a table of explicit pad positions beats a generator.
 */
export const DISCRETE_SMD_FOOTPRINTS: Record<string, ComponentFootprint> = {
  'SOT-23-5': {
    packageId: 'SOT-23-5', name: 'SOT-23-5 (0.95mm pitch)', widthMm: 3.0, heightMm: 3.0,
    pads: [
      { pinNumber: '1', x: -1.1, y: -0.95, padWidth: 1.0, padHeight: 0.6, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '2', x: -1.1, y: 0, padWidth: 1.0, padHeight: 0.6, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '3', x: -1.1, y: 0.95, padWidth: 1.0, padHeight: 0.6, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '4', x: 1.1, y: 0.95, padWidth: 1.0, padHeight: 0.6, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '5', x: 1.1, y: -0.95, padWidth: 1.0, padHeight: 0.6, shape: 'rect', drillDiameter: 0 },
    ],
  },
  'SOT-23-6': {
    packageId: 'SOT-23-6', name: 'SOT-23-6 (0.95mm pitch)', widthMm: 3.0, heightMm: 3.0,
    pads: [
      { pinNumber: '1', x: -1.1, y: -0.95, padWidth: 1.0, padHeight: 0.6, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '2', x: -1.1, y: 0, padWidth: 1.0, padHeight: 0.6, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '3', x: -1.1, y: 0.95, padWidth: 1.0, padHeight: 0.6, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '4', x: 1.1, y: 0.95, padWidth: 1.0, padHeight: 0.6, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '5', x: 1.1, y: 0, padWidth: 1.0, padHeight: 0.6, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '6', x: 1.1, y: -0.95, padWidth: 1.0, padHeight: 0.6, shape: 'rect', drillDiameter: 0 },
    ],
  },
  'SOT-323': {
    packageId: 'SOT-323', name: 'SOT-323 / SC-70 Transistor', widthMm: 2.2, heightMm: 2.2,
    pads: [
      { pinNumber: '1', x: -0.65, y: -0.65, padWidth: 0.7, padHeight: 0.5, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '2', x: -0.65, y: 0.65, padWidth: 0.7, padHeight: 0.5, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '3', x: 0.65, y: 0, padWidth: 0.7, padHeight: 0.5, shape: 'rect', drillDiameter: 0 },
    ],
  },
  'SOT-89': {
    packageId: 'SOT-89', name: 'SOT-89 Power Transistor / LDO', widthMm: 6.0, heightMm: 4.6,
    pads: [
      { pinNumber: '1', x: -1.5, y: -1.5, padWidth: 1.2, padHeight: 1.0, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '2', x: -1.5, y: 0, padWidth: 1.2, padHeight: 1.0, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '3', x: -1.5, y: 1.5, padWidth: 1.2, padHeight: 1.0, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '4', x: 1.5, y: 0, padWidth: 1.6, padHeight: 3.4, shape: 'rect', drillDiameter: 0, role: 'thermal' },
    ],
  },
  'SOT-223': {
    packageId: 'SOT-223', name: 'SOT-223 Regulator (2.3mm pitch)', widthMm: 9.0, heightMm: 7.0,
    pads: [
      { pinNumber: '1', x: -3.2, y: -2.3, padWidth: 2.0, padHeight: 1.5, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '2', x: -3.2, y: 0, padWidth: 2.0, padHeight: 1.5, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '3', x: -3.2, y: 2.3, padWidth: 2.0, padHeight: 1.5, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '4', x: 3.2, y: 0, padWidth: 2.0, padHeight: 6.3, shape: 'rect', drillDiameter: 0, role: 'thermal' },
    ],
  },
  'TO-252': {
    packageId: 'TO-252', name: 'TO-252 / DPAK Power Package', widthMm: 10.5, heightMm: 9.5,
    pads: [
      { pinNumber: '1', x: -3.0, y: -2.28, padWidth: 3.0, padHeight: 1.6, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '2', x: -3.0, y: 0, padWidth: 3.0, padHeight: 1.6, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '3', x: -3.0, y: 2.28, padWidth: 3.0, padHeight: 1.6, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '4', x: 2.6, y: 0, padWidth: 5.4, padHeight: 6.2, shape: 'rect', drillDiameter: 0, role: 'thermal' },
    ],
  },
  'TO-263': {
    packageId: 'TO-263', name: 'TO-263 / D2PAK Power Package', widthMm: 14.0, heightMm: 12.0,
    pads: [
      { pinNumber: '1', x: -4.4, y: -2.54, padWidth: 3.8, padHeight: 1.8, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '2', x: -4.4, y: 0, padWidth: 3.8, padHeight: 1.8, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '3', x: -4.4, y: 2.54, padWidth: 3.8, padHeight: 1.8, shape: 'rect', drillDiameter: 0 },
      { pinNumber: '4', x: 3.6, y: 0, padWidth: 6.0, padHeight: 9.5, shape: 'rect', drillDiameter: 0, role: 'thermal' },
    ],
  },
  'TO-247': {
    packageId: 'TO-247', name: 'TO-247 High Power Transistor (THT)', widthMm: 16.0, heightMm: 8.0,
    pads: [
      { pinNumber: '1', x: -5.45, y: 0, padWidth: 2.6, padHeight: 3.2, shape: 'oval', drillDiameter: 1.3 },
      { pinNumber: '2', x: 0, y: 0, padWidth: 2.6, padHeight: 3.2, shape: 'oval', drillDiameter: 1.3 },
      { pinNumber: '3', x: 5.45, y: 0, padWidth: 2.6, padHeight: 3.2, shape: 'oval', drillDiameter: 1.3 },
    ],
  },
};

/**
 * Parametric footprint generator for Dual Header Breakout Modules (e.g. ESP32, Arduino Nano, Pico)
 */
export function generateModule2xFootprint(
  pinsPerSide: number,
  widthMm = 18.0,
  heightMm = 45.0,
  pitchMm = 2.54,
  rowSpacingMm = 15.24,
  drillDiaMm = 1.0,
  padWidthMm = 1.8,
  padHeightMm = 1.8,
  /**
   * Real modules are not always symmetric: the two headers can carry different
   * pin counts and can be staggered relative to each other.
   */
  extra: { leftCount?: number; rightCount?: number; leftOffsetMm?: number; rightOffsetMm?: number } = {}
): ComponentFootprint {
  const left = extra.leftCount ?? pinsPerSide;
  const right = extra.rightCount ?? pinsPerSide;
  const count = left + right;

  const fp = generateDualRowFootprint({
    leftCount: left,
    rightCount: right,
    pitchMm,
    rowSpacingMm,
    padWidthMm,
    padHeightMm,
    drillDiaMm,
    bodyWidthMm: Math.max(widthMm, rowSpacingMm + padWidthMm + 1.0),
    bodyHeightMm: Math.max(heightMm, Math.max(left, right) * pitchMm + 1.0),
    leftOffsetMm: extra.leftOffsetMm,
    rightOffsetMm: extra.rightOffsetMm,
    packageId: `MODULE-2x${pinsPerSide}`,
    name: `Dual Header Module (${count}-Pin, ${widthMm}x${heightMm}mm)`,
  });
  return fp;
}

/**
 * Parametric footprint generator for 2-Row Matrix / Dupont Header (e.g. 2x4 for CC1101, 2x3, 2x5, etc.)
 */
export function generateMatrixHeaderFootprint(
  cols: number,
  rows = 2,
  pitchMm = 2.54,
  rowSpacingMm = 2.54,
  drillDiaMm = 1.0,
  padWidthMm = 1.8,
  padHeightMm = 1.8
): ComponentFootprint {
  const totalCount = cols * rows;
  const startX = -((cols - 1) * pitchMm) / 2;
  const startY = ((rows - 1) * rowSpacingMm) / 2;
  const pads: PadSpec[] = [];

  let pinIdx = 1;
  for (let r = 0; r < rows; r++) {
    const y = startY - r * rowSpacingMm;
    for (let c = 0; c < cols; c++) {
      const x = startX + c * pitchMm;
      pads.push({
        pinNumber: pinIdx.toString(),
        x,
        y,
        padWidth: padWidthMm,
        padHeight: padHeightMm,
        shape: pinIdx === 1 ? 'rect' : 'circle',
        drillDiameter: drillDiaMm,
      });
      pinIdx++;
    }
  }

  return {
    packageId: `HEADER-${rows}x${String(cols).padStart(2, '0')}`,
    name: `${rows}x${cols} Pin Dupont Header (${totalCount} Pins, ${pitchMm}mm pitch)`,
    widthMm: cols * pitchMm + 0.5,
    heightMm: rows * rowSpacingMm + 0.5,
    pads,
  };
}

/**
 * A single plated through-hole, used as a layer-change via or as a tie point
 * for a hand-fitted wire jumper on a single-sided board.
 */
export function generateViaFootprint(
  drillDiaMm = 0.6,
  padDiaMm = 1.2
): ComponentFootprint {
  const drill = Math.max(0.2, drillDiaMm);
  // The annular ring has to survive the isolation cut, so keep a floor on it.
  const pad = Math.max(drill + 0.4, padDiaMm);
  return {
    packageId: `VIA-${drill.toFixed(1)}`,
    name: `Via (${drill.toFixed(1)}mm drill, ${pad.toFixed(1)}mm pad)`,
    widthMm: pad,
    heightMm: pad,
    pads: [
      { pinNumber: '1', x: 0, y: 0, padWidth: pad, padHeight: pad, shape: 'circle', drillDiameter: drill },
    ],
  };
}

/**
 * An unplated mounting hole. It carries no net, so it contributes a drill and a
 * keepout but never any copper.
 */
export function generateMountingHoleFootprint(
  holeDiaMm = 3.2,
  padDiaMm?: number
): ComponentFootprint {
  const drill = Math.max(0.5, holeDiaMm);
  // Default keepout is the washer/screw-head footprint, not the hole itself.
  const pad = Math.max(drill, padDiaMm ?? drill + 2.4);
  return {
    packageId: `MOUNT-M${drill.toFixed(1)}`,
    name: `Mounting Hole (${drill.toFixed(1)}mm)`,
    widthMm: pad,
    heightMm: pad,
    pads: [
      { pinNumber: '1', x: 0, y: 0, padWidth: pad, padHeight: pad, shape: 'circle', drillDiameter: drill },
    ],
  };
}

/**
 * A two-pad wire jumper. The pads are deliberately on different nets, so the
 * router leaves the gap between them empty and a wire is fitted by hand.
 */
export function generateJumperFootprint(
  pitchMm = 5.08,
  drillDiaMm = 0.8
): ComponentFootprint {
  const pitch = Math.max(1.0, pitchMm);
  const drill = Math.max(0.3, drillDiaMm);
  const pad = drill + 1.0;
  return {
    packageId: `JUMPER-${pitch.toFixed(2)}`,
    name: `Wire Jumper (${pitch.toFixed(2)}mm pitch)`,
    widthMm: pitch + pad,
    heightMm: pad,
    pads: [
      { pinNumber: '1', x: -pitch / 2, y: 0, padWidth: pad, padHeight: pad, shape: 'rect', drillDiameter: drill },
      { pinNumber: '2', x: pitch / 2, y: 0, padWidth: pad, padHeight: pad, shape: 'circle', drillDiameter: drill },
    ],
  };
}

/**
 * A board cutout. It has no pads at all — it is milled by the profile tool, not
 * by the isolation tool, so it contributes only a courtyard and a keepout.
 */
export function generateCutoutFootprint(
  widthMm = 10,
  heightMm = 6
): ComponentFootprint {
  const w = Math.max(1, widthMm);
  const h = Math.max(1, heightMm);
  return {
    packageId: `CUTOUT-${w.toFixed(1)}x${h.toFixed(1)}`,
    name: `Board Cutout (${w.toFixed(1)} x ${h.toFixed(1)}mm)`,
    widthMm: w,
    heightMm: h,
    pads: [],
  };
}

/**
 * Parametric footprint generator for custom MCU configurations of any geometry.
 */
export function generateCustomMcuFootprint(config: McuGeometryConfig): ComponentFootprint {
  const { pins, widthMm, heightMm, pitchMm, isSmd, drillDiaMm, padWidthMm, padHeightMm, style, rowSpacingMm } = config;
  const pads: PadSpec[] = [];

  const leftPins = pins.filter(p => p.side === 'left');
  const rightPins = pins.filter(p => p.side === 'right');
  const topPins = pins.filter(p => p.side === 'top');
  const bottomPins = pins.filter(p => p.side === 'bottom');

  const shape: 'circle' | 'rect' = isSmd ? 'rect' : 'circle';
  const drill = isSmd ? 0 : drillDiaMm;

  if (style === 'header_1x') {
    const count = pins.length;
    const startY = ((count - 1) * pitchMm) / 2;
    pins.forEach((pin, i) => {
      pads.push({
        pinNumber: pin.pinNumber !== undefined ? String(pin.pinNumber) : pin.id,
        x: 0,
        y: startY - i * pitchMm,
        padWidth: padWidthMm,
        padHeight: padHeightMm,
        shape: i === 0 && !isSmd ? 'rect' : shape,
        drillDiameter: drill,
      });
    });
  } else if (style === 'quad' || (topPins.length > 0 || bottomPins.length > 0)) {
    // 4-sided module / QFP
    const halfW = widthMm / 2;
    const halfH = heightMm / 2;

    const placeAlongEdge = (edgePins: McuPinDef[], side: 'left' | 'right' | 'top' | 'bottom') => {
      const n = edgePins.length;
      if (n === 0) return;
      const start = -((n - 1) * pitchMm) / 2;
      edgePins.forEach((pin, idx) => {
        const offset = start + idx * pitchMm;
        let px = 0;
        let py = 0;
        let pw = padWidthMm;
        let ph = padHeightMm;

        if (side === 'left') {
          px = -halfW + pw / 2;
          py = -offset;
        } else if (side === 'right') {
          px = halfW - pw / 2;
          py = offset;
        } else if (side === 'top') {
          px = offset;
          py = halfH - ph / 2;
          // Swap width/height for horizontal edge pads if SMD
          if (isSmd) { pw = padHeightMm; ph = padWidthMm; }
        } else if (side === 'bottom') {
          px = -offset;
          py = -halfH + ph / 2;
          if (isSmd) { pw = padHeightMm; ph = padWidthMm; }
        }

        pads.push({
          pinNumber: pin.pinNumber !== undefined ? String(pin.pinNumber) : pin.id,
          x: px,
          y: py,
          padWidth: pw,
          padHeight: ph,
          shape: pads.length === 0 && !isSmd ? 'rect' : shape,
          drillDiameter: drill,
        });
      });
    };

    placeAlongEdge(leftPins, 'left');
    placeAlongEdge(bottomPins, 'bottom');
    placeAlongEdge(rightPins, 'right');
    placeAlongEdge(topPins, 'top');
  } else {
    // Dual row / DIP / Header 2x / Matrix / Module
    const isMatrix = style === 'header_matrix';
    const rowSpacing = rowSpacingMm || (isMatrix ? 2.54 : style === 'dip' ? 7.62 : Math.max(5.0, widthMm - 2.54));

    if (isMatrix) {
      // 2-row compact Dupont header layout: row 1 at y = +rowSpacing/2, row 2 at y = -rowSpacing/2
      const maxCols = Math.max(leftPins.length, rightPins.length, 1);
      const startX = -((maxCols - 1) * pitchMm) / 2;
      const topY = rowSpacing / 2;
      const bottomY = -rowSpacing / 2;

      leftPins.forEach((pin, i) => {
        pads.push({
          pinNumber: pin.pinNumber !== undefined ? String(pin.pinNumber) : pin.id,
          x: startX + i * pitchMm,
          y: topY,
          padWidth: padWidthMm,
          padHeight: padHeightMm,
          shape: i === 0 && !isSmd ? 'rect' : shape,
          drillDiameter: drill,
        });
      });

      rightPins.forEach((pin, i) => {
        pads.push({
          pinNumber: pin.pinNumber !== undefined ? String(pin.pinNumber) : pin.id,
          x: startX + i * pitchMm,
          y: bottomY,
          padWidth: padWidthMm,
          padHeight: padHeightMm,
          shape: shape,
          drillDiameter: drill,
        });
      });
    } else {
      const leftX = -rowSpacing / 2;
      const rightX = rowSpacing / 2;

      const maxSideCount = Math.max(leftPins.length, rightPins.length, 1);
      const startY = ((maxSideCount - 1) * pitchMm) / 2;

      leftPins.forEach((pin, i) => {
        pads.push({
          pinNumber: pin.pinNumber !== undefined ? String(pin.pinNumber) : pin.id,
          x: leftX,
          y: startY - i * pitchMm,
          padWidth: padWidthMm,
          padHeight: padHeightMm,
          shape: i === 0 && !isSmd ? 'rect' : shape,
          drillDiameter: drill,
        });
      });

      // Counter-clockwise parts (DIP, Pico) climb the right column from the
      // bottom; a Nano/DevKit/Heltec runs it downward alongside the left one.
      const runsUp = rightColumnRunsUp(config);

      rightPins.forEach((pin, i) => {
        pads.push({
          pinNumber: pin.pinNumber !== undefined ? String(pin.pinNumber) : pin.id,
          x: rightX,
          y: runsUp ? -startY + i * pitchMm : startY - i * pitchMm,
          padWidth: padWidthMm,
          padHeight: padHeightMm,
          shape: shape,
          drillDiameter: drill,
        });
      });
    }
  }

  const pkgId = config.presetKey && config.presetKey !== 'custom'
    ? `MCU-${config.presetKey.toUpperCase()}`
    : `MCU-CUSTOM-${pins.length}P-${widthMm.toFixed(0)}x${heightMm.toFixed(0)}`;

  return {
    packageId: pkgId,
    name: `MCU (${pins.length}-Pin, ${widthMm}x${heightMm}mm)`,
    widthMm,
    heightMm,
    pads,
  };
}

// ---------------------------------------------------------------------------
// Package id parsing
// ---------------------------------------------------------------------------

/**
 * Dimensional overrides carried in a package id's trailing tokens, so a part
 * whose datasheet disagrees with the family default can still be named as a
 * string (which is what the assistant and the preset files write).
 *
 *   DIP-28            narrow by default
 *   DIP-28-W          0.6" rows
 *   DIP-28-P2.54-R7.62-B10x36
 *   QFN-32-P0.5-B5x5-T3.4
 *   TSSOP-20-R6.4
 *   MODULE-2x20-P2.54-R17.78-B21x51-OL1.27
 *
 * Numbers are millimetres. A leading `_` marks a negative value, since `-` is
 * the token separator (`OL_1.27` is an offset of -1.27mm).
 */
export interface PackageModifiers {
  pitchMm?: number;
  spanMm?: number;          // row spacing (dual) or pad span (quad)
  bodyWidthMm?: number;
  bodyHeightMm?: number;
  drillDiaMm?: number;
  padWidthMm?: number;
  padHeightMm?: number;
  leftOffsetMm?: number;
  rightOffsetMm?: number;
  thermalPadMm?: number;
  wide?: boolean;
  narrow?: boolean;
}

function parseNum(raw: string): number | undefined {
  const negated = raw.startsWith('_');
  const n = parseFloat(negated ? raw.slice(1) : raw);
  if (!Number.isFinite(n)) return undefined;
  return negated ? -n : n;
}

export function parsePackageModifiers(tokens: string[]): PackageModifiers {
  const mods: PackageModifiers = {};
  for (const token of tokens) {
    const t = token.toUpperCase();
    if (t === 'W' || t === 'WIDE') { mods.wide = true; continue; }
    if (t === 'N' || t === 'NARROW') { mods.narrow = true; continue; }

    // A bare number is the family's primary dimension: row spacing / pad span.
    const bare = parseNum(t);
    if (bare !== undefined && /^[_\d.]+$/.test(t)) { mods.spanMm = bare; continue; }

    const pair = /^([A-Z]+)([_\d.]+)X([_\d.]+)$/.exec(t);
    if (pair) {
      const a = parseNum(pair[2]);
      const b = parseNum(pair[3]);
      if (a === undefined || b === undefined) continue;
      if (pair[1] === 'B') { mods.bodyWidthMm = a; mods.bodyHeightMm = b; }
      else if (pair[1] === 'S') { mods.padWidthMm = a; mods.padHeightMm = b; }
      continue;
    }

    const single = /^([A-Z]+)([_\d.]+)$/.exec(t);
    if (!single) continue;
    const value = parseNum(single[2]);
    if (value === undefined) continue;
    switch (single[1]) {
      case 'P': mods.pitchMm = value; break;
      case 'R': mods.spanMm = value; break;
      case 'D': mods.drillDiaMm = value; break;
      case 'T': mods.thermalPadMm = value; break;
      case 'OL': mods.leftOffsetMm = value; break;
      case 'OR': mods.rightOffsetMm = value; break;
    }
  }
  return mods;
}

const DUAL_SMD_PATTERN = /^(SOIC|SOICW|SOP|SOJ|QSOP|SSOP|TSSOP|TSOP|MSOP|VSSOP)(\d+)?W?$/;
const QUAD_PATTERN = /^(QFN|VQFN|WQFN|QFP|TQFP|LQFP)$/;
const LEADLESS_DUAL_PATTERN = /^(DFN|VDFN|WDFN|SON)$/;

/**
 * Turns a package id into a footprint, or returns null when the id names
 * nothing this library knows how to build. Callers must treat null as an
 * error — guessing a footprint puts the wrong holes in real copper.
 */
export function parsePackageId(raw: string, pinCountHint = 0): ComponentFootprint | null {
  const id = (raw || '').trim().toUpperCase();
  if (!id) return null;

  // Whole-id table lookups first: several of these contain the '-' that the
  // token splitter would otherwise chop up (SOD-123, SOT-23-5).
  if (STANDARD_FOOTPRINTS[id]) return STANDARD_FOOTPRINTS[id];
  if (DISCRETE_SMD_FOOTPRINTS[id]) return DISCRETE_SMD_FOOTPRINTS[id];
  const twoPad = generateTwoPadSmdFootprint(id);
  if (twoPad) return twoPad;

  const parts = id.split('-');
  const family = parts[0];
  const rest = parts.slice(1);

  // Pin count is usually the first trailing token; anything after it modifies.
  const countToken = rest.length > 0 && /^\d+$/.test(rest[0]) ? rest[0] : undefined;
  const count = countToken ? parseInt(countToken, 10) : pinCountHint;
  const mods = parsePackageModifiers(countToken ? rest.slice(1) : rest);

  if (family === 'DIP' && count >= 4) {
    return generateDIPFootprint(count, {
      rowSpacing: mods.spanMm ?? (mods.wide ? 'wide' : mods.narrow ? 'narrow' : undefined),
      pitchMm: mods.pitchMm,
      padDiaMm: mods.padWidthMm,
      drillDiaMm: mods.drillDiaMm,
      bodyWidthMm: mods.bodyWidthMm,
      bodyHeightMm: mods.bodyHeightMm,
    });
  }

  // SOIC-16W and SOIC-16-W both mean the wide body.
  const dualMatch = DUAL_SMD_PATTERN.exec(family);
  if (dualMatch && count >= 4) {
    const wide = mods.wide || family.endsWith('W') || dualMatch[1] === 'SOICW';
    const base = dualMatch[1] === 'SOICW' ? 'SOIC' : dualMatch[1];
    const key = wide && SMD_DUAL_FAMILIES[`${base}-W`] ? `${base}-W` : base;
    return generateDualSmdFootprint(key, count, {
      pitchMm: mods.pitchMm,
      spanMm: mods.spanMm,
      padLengthMm: mods.padWidthMm,
      padWidthMm: mods.padHeightMm,
      bodyWidthMm: mods.bodyWidthMm,
      bodyHeightMm: mods.bodyHeightMm,
    });
  }

  if (LEADLESS_DUAL_PATTERN.test(family) && count >= 2) {
    return generateLeadlessDualFootprint(family, count, {
      pitchMm: mods.pitchMm,
      bodyMm: mods.bodyWidthMm,
      padSpanMm: mods.spanMm,
      padLengthMm: mods.padWidthMm,
      padWidthMm: mods.padHeightMm,
      thermalPadMm: mods.thermalPadMm,
    });
  }

  if (QUAD_PATTERN.test(family) && count >= 4) {
    return generateQuadFamilyFootprint(family, count, {
      pitchMm: mods.pitchMm,
      bodyMm: mods.bodyWidthMm,
      padSpanMm: mods.spanMm,
      padLengthMm: mods.padWidthMm,
      padWidthMm: mods.padHeightMm,
      thermalPadMm: mods.thermalPadMm,
    });
  }

  // HEADER-1xN / HEADER-2x08 / DUPONT-2x04
  const gridMatch = /^(\d+)X(\d+)$/.exec(rest[0] ?? '');
  if ((family === 'HEADER' || family === 'DUPONT') && gridMatch) {
    const rows = parseInt(gridMatch[1], 10);
    const cols = parseInt(gridMatch[2], 10);
    const gridMods = parsePackageModifiers(rest.slice(1));
    if (rows === 1) {
      return generateHeaderFootprint(cols, gridMods.pitchMm ?? 2.54);
    }
    return generateMatrixHeaderFootprint(
      cols,
      rows,
      gridMods.pitchMm ?? 2.54,
      gridMods.spanMm ?? gridMods.pitchMm ?? 2.54,
      gridMods.drillDiaMm ?? 1.0,
      gridMods.padWidthMm ?? 1.8,
      gridMods.padHeightMm ?? 1.8
    );
  }

  // MODULE-2x20 (symmetric) or MODULE-18+12 (different pins per side).
  if (family === 'MODULE') {
    const head = rest[0] ?? '';
    const symmetric = /^2X(\d+)$/.exec(head);
    const asymmetric = /^(\d+)\+(\d+)$/.exec(head);
    if (symmetric || asymmetric) {
      const left = symmetric ? parseInt(symmetric[1], 10) : parseInt(asymmetric![1], 10);
      const right = symmetric ? left : parseInt(asymmetric![2], 10);
      const m = parsePackageModifiers(rest.slice(1));
      const pitch = m.pitchMm ?? 2.54;
      const rowSpacing = m.spanMm ?? 15.24;
      return generateDualRowFootprint({
        leftCount: left,
        rightCount: right,
        pitchMm: pitch,
        rowSpacingMm: rowSpacing,
        padWidthMm: m.padWidthMm ?? 1.8,
        padHeightMm: m.padHeightMm ?? 1.8,
        drillDiaMm: m.drillDiaMm ?? 1.0,
        bodyWidthMm: m.bodyWidthMm ?? rowSpacing + 3.0,
        bodyHeightMm: m.bodyHeightMm ?? Math.max(left, right) * pitch + 2.0,
        leftOffsetMm: m.leftOffsetMm,
        rightOffsetMm: m.rightOffsetMm,
        packageId: id,
        name: `Breakout Module (${left}+${right} pins, ${rowSpacing}mm rows)`,
      });
    }
  }

  if (family === 'VIA') return generateViaFootprint(mods.spanMm ?? parseNum(rest[0] ?? ''));
  if (family === 'CUTOUT') return generateCutoutFootprint(mods.bodyWidthMm, mods.bodyHeightMm);

  return null;
}

/**
 * Free-form footprint parameters attached to a node as `data.footprintParams`.
 * This is how the properties panel expresses a module whose width, pitch, row
 * spacing and per-header offsets are all arbitrary, without inventing a package
 * id for it.
 */
export interface FootprintParams {
  family?: 'dual' | 'quad' | 'dip' | 'header';
  leftCount?: number;
  rightCount?: number;
  pinCount?: number;
  pitchMm?: number;
  rowSpacingMm?: number;
  padWidthMm?: number;
  padHeightMm?: number;
  drillDiaMm?: number;
  bodyWidthMm?: number;
  bodyHeightMm?: number;
  leftOffsetMm?: number;
  rightOffsetMm?: number;
  thermalPadMm?: number;
}

export function footprintFromParams(p: FootprintParams): ComponentFootprint {
  const family = p.family ?? 'dual';

  if (family === 'quad') {
    const total = Math.max(4, p.pinCount ?? 16);
    const pitch = p.pitchMm ?? 0.5;
    const perSide = Math.ceil(total / 4);
    const padLength = p.padWidthMm ?? quadPadForPitch(pitch, true).length;
    const padWidth = p.padHeightMm ?? quadPadForPitch(pitch, true).width;
    const body = p.bodyWidthMm ?? Math.max(2, perSide * pitch + 1.0);
    return generateQuadFootprint({
      pinCount: total,
      pinsPerSide: perSide,
      pitchMm: pitch,
      padLengthMm: padLength,
      padWidthMm: padWidth,
      padSpanMm: p.rowSpacingMm ?? body - padLength,
      bodyWidthMm: body,
      bodyHeightMm: p.bodyHeightMm ?? body,
      thermalPadWidthMm: p.thermalPadMm,
      thermalPadHeightMm: p.thermalPadMm,
      packageId: `CUSTOM-QUAD-${total}`,
      name: `Custom Quad (${total} pins, ${pitch}mm pitch)`,
    });
  }

  if (family === 'header') {
    const total = Math.max(1, p.pinCount ?? p.leftCount ?? 8);
    return generateHeaderFootprint(total, p.pitchMm ?? 2.54);
  }

  const total = p.pinCount ?? (((p.leftCount ?? 0) + (p.rightCount ?? 0)) || 8);
  const left = p.leftCount ?? Math.ceil(total / 2);
  const right = p.rightCount ?? total - left;
  const pitch = p.pitchMm ?? 2.54;
  const rowSpacing = p.rowSpacingMm ?? (family === 'dip' ? 7.62 : 15.24);
  const drill = p.drillDiaMm ?? (family === 'dip' ? 0.8 : 1.0);

  return generateDualRowFootprint({
    leftCount: left,
    rightCount: right,
    pitchMm: pitch,
    rowSpacingMm: rowSpacing,
    padWidthMm: p.padWidthMm ?? (drill > 0 ? drill + 0.8 : 1.5),
    padHeightMm: p.padHeightMm ?? (drill > 0 ? drill + 0.8 : 0.6),
    drillDiaMm: drill,
    bodyWidthMm: p.bodyWidthMm,
    bodyHeightMm: p.bodyHeightMm,
    leftOffsetMm: p.leftOffsetMm,
    rightOffsetMm: p.rightOffsetMm,
    packageId: `CUSTOM-${left}+${right}`,
    name: `Custom Dual Row (${left}+${right} pins, ${pitch}mm pitch, ${rowSpacing}mm rows)`,
  });
}

/** Package ids that were asked for but could not be built, for diagnostics. */
export const UNRESOLVED_PACKAGE_IDS = new Set<string>();

function fallbackFootprint(requested: string, base: ComponentFootprint): ComponentFootprint {
  UNRESOLVED_PACKAGE_IDS.add(requested);
  return {
    ...base,
    isFallback: true,
    requestedPackageId: requested,
    name: `${base.name} (substituted for unknown package "${requested}")`,
  };
}

/**
 * The modules built by hand rather than from a catalogue entry or a parametric
 * id. Reachable both from an explicitly chosen package and from a node type's
 * default, which are the same geometry and must not disagree.
 */
function buildSpecialPackage(packageId: string): ComponentFootprint | null {
  if (packageId === 'HELTEC-V4' || packageId.startsWith('HELTEC')) {
    return generateModule2xFootprint(18, 28.0, 58.0, 2.54, 22.86, 1.0);
  }
  if (packageId === 'CC1101') {
    return generateMatrixHeaderFootprint(4, 2, 2.54, 2.54);
  }
  return null;
}

export function resolveFootprint(
  packageId?: string,
  componentType?: string,
  pinCount = 2,
  customData?: any
): ComponentFootprint {
  const type = (componentType || '').toLowerCase();

  // An explicit parametric override wins over everything. This is the escape
  // hatch for modules whose body size, pitch, row spacing and per-header
  // offsets are all arbitrary and match no catalogue part.
  if (customData?.footprintParams) {
    return footprintFromParams(customData.footprintParams as FootprintParams);
  }

  // Mechanical and connector-only parts are fully described by their own data,
  // so they resolve before any packageId or mcuConfig handling.
  if (type === 'pinheader') {
    const rows = Math.max(1, Math.round(customData?.rows ?? 1));
    const cols = Math.max(1, Math.round(customData?.cols ?? 8));
    return generateMatrixHeaderFootprint(
      cols,
      rows,
      customData?.pitchMm ?? 2.54,
      customData?.rowSpacingMm ?? customData?.pitchMm ?? 2.54
    );
  }
  if (type === 'via') {
    return generateViaFootprint(customData?.drillDiameterMm, customData?.padDiameterMm);
  }
  if (type === 'mountinghole') {
    return generateMountingHoleFootprint(customData?.holeDiameterMm, customData?.keepoutDiameterMm);
  }
  if (type === 'jumper') {
    return generateJumperFootprint(customData?.pitchMm, customData?.drillDiameterMm);
  }
  if (type === 'cutout') {
    const shape = customData?.cutoutShape === 'circle' ? 'circle' : 'rect';
    const w = Math.max(1, customData?.cutoutWidthMm ?? 10);
    const h = shape === 'circle' ? w : Math.max(1, customData?.cutoutHeightMm ?? 6);
    return generateCutoutFootprint(w, h);
  }

  // If component is an MCU and has custom geometry or mcuConfig defined, generate exact footprint
  if (type === 'mcu' || (customData && customData.mcuConfig)) {
    const config = getEffectiveMcuConfig(customData);
    // If user explicitly chose a standard package override like DIP-8, DIP-14, etc.
    if (packageId && packageId !== 'DEFAULT' && STANDARD_FOOTPRINTS[packageId]) {
      return STANDARD_FOOTPRINTS[packageId];
    }
    return generateCustomMcuFootprint(config);
  }

  if (packageId && STANDARD_FOOTPRINTS[packageId]) {
    return STANDARD_FOOTPRINTS[packageId];
  }

  if (packageId) {
    const special = buildSpecialPackage(packageId);
    if (special) return special;

    const parsed = parsePackageId(packageId, pinCount);
    if (parsed) return parsed;
  }

  // Exact node-type lookup first — this is the path that matters, since node
  // types are a closed set defined by components/nodes/registry.ts.
  const mapped = DEFAULT_PACKAGE_BY_TYPE[type];
  if (mapped) {
    if (STANDARD_FOOTPRINTS[mapped]) return STANDARD_FOOTPRINTS[mapped];
    // The same builders the explicit path uses. Without this a type whose
    // default is a hand-built module — heltec_v4 — resolved to neither a
    // standard nor a parseable id and fell all the way through to the 0805 at
    // the end of this function: a 36-pad dev board laid out as a two-pad chip
    // resistor, with every GPIO connection dropped for want of a pin to map.
    const mappedSpecial = buildSpecialPackage(mapped);
    if (mappedSpecial) return mappedSpecial;
    const mappedFp = parsePackageId(mapped, pinCount);
    if (mappedFp) return mappedFp;
  }

  // A package the user named explicitly but that nothing above could build is
  // an error, not an invitation to guess from the component type. Guessing here
  // is what silently milled an 0805 where a QFN was meant to go.
  if (packageId) {
    if (!UNRESOLVED_PACKAGE_IDS.has(packageId)) {
      console.warn(
        `[pcbFootprints] Unknown package "${packageId}" — substituting a generic footprint. ` +
          `Use a known package, a parametric id such as "DIP-28-W", "TSSOP-20", ` +
          `"QFN-32-P0.5-B5x5" or "MODULE-2x20-P2.54-R17.78", or set footprintParams on the node.`
      );
    }
    const base = pinCount > 2 ? generateDIPFootprint(pinCount) : STANDARD_FOOTPRINTS['0805'];
    return fallbackFootprint(packageId, base);
  }

  // Substring fallbacks for anything not in the registry map.
  if (type.includes('resistor') || type.includes('diode')) {
    return STANDARD_FOOTPRINTS['AXIAL-0.3'];
  }
  if (type.includes('capacitor') || type.includes('led')) {
    return STANDARD_FOOTPRINTS['LED-5MM'];
  }
  if (type.includes('transistor') || type.includes('mosfet') || type.includes('regulator')) {
    return STANDARD_FOOTPRINTS['TO-220'];
  }
  if (type.includes('switch') || type.includes('button')) {
    return STANDARD_FOOTPRINTS['TACT-4PIN'];
  }
  if (type.includes('header') || type.includes('connector')) {
    return generateHeaderFootprint(pinCount);
  }
  if (type.includes('ic') || type.includes('timer') || type.includes('mcu')) {
    return generateDIPFootprint(pinCount > 2 ? pinCount : 8);
  }

  return STANDARD_FOOTPRINTS['0805'];
}

