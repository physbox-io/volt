// ---------------------------------------------------------------------------
// Standard PCB Component Footprint Library & Parametric Generators
// Coordinates are in millimeters relative to component origin (0,0) at center.
// ---------------------------------------------------------------------------

export interface PadSpec {
  pinNumber: string | number;
  x: number;             // X offset relative to component center (mm)
  y: number;             // Y offset relative to component center (mm)
  padWidth: number;      // Copper pad width in mm
  padHeight: number;     // Copper pad height in mm
  shape: 'circle' | 'rect' | 'oval';
  drillDiameter: number; // 0 for SMD, e.g. 0.8mm for THT
}

export interface ComponentFootprint {
  packageId: string;     // e.g. 'DIP-8', '0805', 'HEADER-1x04'
  name: string;
  widthMm: number;       // Courtyard physical width in mm
  heightMm: number;      // Courtyard physical height in mm
  pads: PadSpec[];
}

export const STANDARD_FOOTPRINTS: Record<string, ComponentFootprint> = {
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

/** The default package id for a node type, if one is defined. */
export function defaultPackageForType(componentType?: string): string | undefined {
  return DEFAULT_PACKAGE_BY_TYPE[(componentType || '').toLowerCase()];
}

import { getEffectiveMcuConfig, type McuGeometryConfig, type McuPinDef } from './mcuConfig';

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

export function generateDIPFootprint(pinCount: number): ComponentFootprint {
  const count = Math.max(4, pinCount % 2 === 0 ? pinCount : pinCount + 1);
  const pinsPerSide = count / 2;
  const pinPitch = 2.54;
  const rowSpacing = count >= 24 ? 15.24 : 7.62;

  const startY = ((pinsPerSide - 1) * pinPitch) / 2;
  const leftX = -rowSpacing / 2;
  const rightX = rowSpacing / 2;

  const pads: PadSpec[] = [];
  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      pinNumber: (i + 1).toString(),
      x: leftX,
      y: startY - i * pinPitch,
      padWidth: 1.6,
      padHeight: 1.6,
      shape: i === 0 ? 'rect' : 'circle',
      drillDiameter: 0.8,
    });
  }

  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      pinNumber: (pinsPerSide + i + 1).toString(),
      x: rightX,
      y: -startY + i * pinPitch,
      padWidth: 1.6,
      padHeight: 1.6,
      shape: 'circle',
      drillDiameter: 0.8,
    });
  }

  return {
    packageId: `DIP-${count}`,
    name: `DIP-${count} Integrated Circuit`,
    widthMm: rowSpacing + 2.5,
    heightMm: pinsPerSide * pinPitch + 1.0,
    pads,
  };
}

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
  padHeightMm = 1.8
): ComponentFootprint {
  const count = pinsPerSide * 2;
  const startY = ((pinsPerSide - 1) * pitchMm) / 2;
  const leftX = -rowSpacingMm / 2;
  const rightX = rowSpacingMm / 2;

  const pads: PadSpec[] = [];
  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      pinNumber: (i + 1).toString(),
      x: leftX,
      y: startY - i * pitchMm,
      padWidth: padWidthMm,
      padHeight: padHeightMm,
      shape: i === 0 ? 'rect' : 'circle',
      drillDiameter: drillDiaMm,
    });
  }

  for (let i = 0; i < pinsPerSide; i++) {
    pads.push({
      pinNumber: (pinsPerSide + i + 1).toString(),
      x: rightX,
      y: -startY + i * pitchMm,
      padWidth: padWidthMm,
      padHeight: padHeightMm,
      shape: 'circle',
      drillDiameter: drillDiaMm,
    });
  }

  return {
    packageId: `MODULE-2x${pinsPerSide}`,
    name: `Dual Header Module (${count}-Pin, ${widthMm}x${heightMm}mm)`,
    widthMm: Math.max(widthMm, rowSpacingMm + padWidthMm + 1.0),
    heightMm: Math.max(heightMm, pinsPerSide * pitchMm + 1.0),
    pads,
  };
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

      rightPins.forEach((pin, i) => {
        pads.push({
          pinNumber: pin.pinNumber !== undefined ? String(pin.pinNumber) : pin.id,
          x: rightX,
          y: -startY + i * pitchMm,
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

export function resolveFootprint(
  packageId?: string,
  componentType?: string,
  pinCount = 2,
  customData?: any
): ComponentFootprint {
  const type = (componentType || '').toLowerCase();

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
    if (packageId === 'HELTEC-V4' || packageId.startsWith('HELTEC')) {
      return generateModule2xFootprint(18, 28.0, 58.0, 2.54, 22.86, 1.0);
    }
    if (packageId === 'CC1101') {
      return generateMatrixHeaderFootprint(4, 2, 2.54, 2.54);
    }
    if (packageId.startsWith('DIP-')) {
      const pins = parseInt(packageId.replace('DIP-', ''), 10) || pinCount || 8;
      return generateDIPFootprint(pins);
    }
    if (packageId.startsWith('HEADER-1x')) {
      const pins = parseInt(packageId.replace('HEADER-1x', ''), 10) || pinCount || 4;
      return generateHeaderFootprint(pins);
    }
    if (packageId.startsWith('HEADER-2x') || packageId.startsWith('DUPONT-2x')) {
      const cols = parseInt(packageId.replace(/^(HEADER|DUPONT)-2x/, ''), 10) || Math.ceil(pinCount / 2);
      return generateMatrixHeaderFootprint(cols, 2);
    }
    if (packageId.startsWith('MODULE-2x')) {
      const pinsPerSide = parseInt(packageId.replace(/^MODULE-2x/, ''), 10) || Math.ceil(pinCount / 2);
      return generateModule2xFootprint(pinsPerSide);
    }
  }

  // Exact node-type lookup first — this is the path that matters, since node
  // types are a closed set defined by components/nodes/registry.ts.
  const mapped = DEFAULT_PACKAGE_BY_TYPE[type];
  if (mapped) {
    if (STANDARD_FOOTPRINTS[mapped]) return STANDARD_FOOTPRINTS[mapped];
    if (mapped.startsWith('DIP-')) {
      return generateDIPFootprint(parseInt(mapped.slice(4), 10));
    }
    if (mapped.startsWith('HEADER-1x')) {
      return generateHeaderFootprint(parseInt(mapped.slice(9), 10));
    }
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

