import type { HeltecV4NodeData, NetLabelNodeData, PowerRailNodeData } from '../../types/nodes';
import { DEFAULT_NET_LABEL, DEFAULT_RAIL, POWER_RAIL_PRESETS } from '../../utils/netNaming';

/**
 * The seed data a part is dropped onto the canvas with, and the fixed tables
 * the properties panels offer.
 *
 * The registry is the only caller, but each factory used to sit in its part's
 * own component file — which cost that file React Fast Refresh, since a module
 * that exports anything but components is reloaded whole. On this canvas a full
 * reload resets the simulation and the circuit view mid-edit.
 */

export function transformerDefaultData() {
  return { label: 'Transformer', l_pri: '10m', l_sec: '10m', k: 0.99, l_pri_label: '10mH', l_sec_label: '10mH' };
}

export function dffDefaultData() {
  return { label: 'DFF' };
}

export function ldrDefaultData() {
  return { label: 'LDR', r_dark: 100000, r_dark_label: '100k', lightLevel: 0.5 };
}

/** The board's GPIO pins, in the order the symbol and the netlist walk them. */
export const HELTEC_V4_GPIO_PINS = ['GPIO_1', 'GPIO_3', 'GPIO_33', 'GPIO_36', 'GPIO_37', 'GPIO_41'];

export function heltecV4DefaultData(): HeltecV4NodeData {
  return {
    label: 'Heltec V4',
    ip: '192.168.1.244',
    hilExecutionMode: 'native',
    hilMemoizationEnabled: true,
    hilInputDP: 3,
    hilIcDP: 3,
    hilMaxConsecutiveHits: 50,
    pins: {
      GPIO_1: 'analog_in',
      GPIO_3: 'digital_out',
      GPIO_33: 'digital_in',
      GPIO_36: 'digital_in',
      GPIO_37: 'digital_in',
      GPIO_41: 'digital_in'
    },
    pinVoltages: {
      GPIO_1: 0.0,
      GPIO_3: 0.0,
      GPIO_33: 0.0,
      GPIO_36: 0.0,
      GPIO_37: 0.0,
      GPIO_41: 0.0
    },
    // Opt-in: nothing contacts the board over ws:// until the user clicks Connect on
    // the node (or starts a HIL run). Auto-connecting from an https page is blocked as
    // mixed content and can take WebSerial down with it.
    hilEnabled: false,
    isConnected: false
  };
}

export const PIN_HEADER_LIMITS = { minRows: 1, maxRows: 8, minCols: 1, maxCols: 40 };

export function pinHeaderDefaultData(label?: string) {
  return {
    label: label || 'Header',
    rows: 1,
    cols: 8,
    pitchMm: 2.54,
    rowSpacingMm: 2.54,
  };
}

export function viaDefaultData(label?: string) {
  return {
    label: label || 'Via',
    drillDiameterMm: 0.6,
    padDiameterMm: 1.2,
  };
}

/** Common metric screw sizes, with the clearance drill for each. */
export const MOUNTING_HOLE_PRESETS = [
  { id: 'M2', label: 'M2', holeMm: 2.2, keepoutMm: 4.5 },
  { id: 'M2.5', label: 'M2.5', holeMm: 2.7, keepoutMm: 5.5 },
  { id: 'M3', label: 'M3', holeMm: 3.2, keepoutMm: 6.5 },
  { id: 'M4', label: 'M4', holeMm: 4.3, keepoutMm: 8.0 },
];

export function mountingHoleDefaultData(label?: string) {
  return {
    label: label || 'Mount',
    screwSize: 'M3',
    holeDiameterMm: 3.2,
    keepoutDiameterMm: 6.5,
  };
}

export function jumperDefaultData(label?: string) {
  return {
    label: label || 'Jumper',
    pitchMm: 5.08,
    drillDiameterMm: 0.8,
  };
}

export function cutoutDefaultData(label?: string) {
  return {
    label: label || 'Cutout',
    cutoutShape: 'rect' as const,
    cutoutWidthMm: 10,
    cutoutHeightMm: 6,
  };
}

/**
 * A net label is dropped on a net of its own; `FlowArea` renames it past the
 * labels already on the canvas, since two labels sharing a name are one net.
 */
export function netLabelDefaultData(label?: string): NetLabelNodeData {
  return { label: label || 'Net', net: DEFAULT_NET_LABEL };
}

export function powerRailDefaultData(label?: string): PowerRailNodeData {
  const rail = label && POWER_RAIL_PRESETS.some(p => p.rail === label) ? label : DEFAULT_RAIL;
  return {
    label: rail,
    rail,
    voltage: POWER_RAIL_PRESETS.find(p => p.rail === rail)?.voltage ?? 5,
  };
}
