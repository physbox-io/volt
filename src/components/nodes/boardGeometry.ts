import type { RawNodeData } from '../../types/nodes';
import { PIN_HEADER_LIMITS } from './partDefaults';

/**
 * Where the pads of a board-only part sit, and how big its body is on canvas.
 *
 * Edge routing, the PCB exporter and the symbols themselves all measure from
 * these, so they cannot live beside the symbol components: a file that exports
 * both a component and a helper loses React Fast Refresh, and on this canvas a
 * full reload resets the simulation and the circuit view mid-edit.
 */

export interface PinHeaderGeometry {
  rows: number;
  cols: number;
  pitchMm: number;
  rowSpacingMm: number;
}

/**
 * Coerces the way the arithmetic below used to coerce on its own.
 *
 * These helpers are called from edge routing and the PCB exporter as well as
 * from the symbol, so what arrives is `Node['data']` — a bag of `unknown` that
 * may have come from a saved file or an MCP agent. `Math.round` and `>` both
 * did this conversion implicitly while the parameter was `any`.
 */
const num = (v: unknown): number => Number(v);

/** Reads the geometry off a node's data, clamped to something buildable. */
export function getPinHeaderGeometry(data?: RawNodeData): PinHeaderGeometry {
  const rows = Math.min(
    PIN_HEADER_LIMITS.maxRows,
    Math.max(PIN_HEADER_LIMITS.minRows, Math.round(num(data?.rows ?? 1)))
  );
  const cols = Math.min(
    PIN_HEADER_LIMITS.maxCols,
    Math.max(PIN_HEADER_LIMITS.minCols, Math.round(num(data?.cols ?? 8)))
  );
  const pitchMm = num(data?.pitchMm) > 0 ? num(data?.pitchMm) : 2.54;
  return {
    rows,
    cols,
    pitchMm,
    rowSpacingMm: num(data?.rowSpacingMm) > 0 ? num(data?.rowSpacingMm) : pitchMm,
  };
}

/** Pad numbers, row-major from 1 — the handle ids for this node. */
export function getPinHeaderHandles(data?: RawNodeData): string[] {
  const { rows, cols } = getPinHeaderGeometry(data);
  return Array.from({ length: rows * cols }, (_, i) => String(i + 1));
}

/**
 * How far the header has been turned, in quarter turns clockwise.
 *
 * A header is a strip, and which way the strip runs is a placement decision as
 * ordinary as it is for a resistor: the same `orientation` field, the same four
 * values the rest of the parts use. Two turns is not the same as none — the pad
 * grid is reversed, so a strip whose pins faced the top faces the bottom — which
 * is the whole point of turning it: the pins end up on the side the wiring is
 * on, instead of every wire having to travel round the body to reach them.
 *
 * The pad *numbering* never changes — pin 1 stays pin 1 — so nothing wired to
 * the header comes loose, and the footprint keeps its row-major order.
 */
export function pinHeaderQuarterTurns(data?: RawNodeData): 0 | 1 | 2 | 3 {
  const i = ['horizontal', 'vertical', 'left', 'up'].indexOf(String(data?.orientation));
  return (i < 0 ? 0 : i) as 0 | 1 | 2 | 3;
}

/** True when the strip runs down the canvas rather than across it. */
export function isPinHeaderVertical(data?: RawNodeData): boolean {
  return pinHeaderQuarterTurns(data) % 2 === 1;
}

/** On-canvas pixel size. Kept in one place so edge routing can agree with it. */
export const PIN_HEADER_CELL_PX = 16;
export function getPinHeaderSize(data?: RawNodeData): { width: number; height: number } {
  const { rows, cols } = getPinHeaderGeometry(data);
  const across = isPinHeaderVertical(data) ? rows : cols;
  const down = isPinHeaderVertical(data) ? cols : rows;
  return {
    width: across * PIN_HEADER_CELL_PX + 8,
    height: down * PIN_HEADER_CELL_PX + 8,
  };
}

/**
 * Where pad `pin` sits inside the header body, in pixels from its top-left.
 * The single definition of the layout: the node draws from it and edge routing
 * measures from it, so a rotated header cannot end up with its wires landing
 * where the pads used to be.
 */
export function pinHeaderPadOffset(
  data: RawNodeData | undefined,
  pin: number
): { dx: number; dy: number } | null {
  const { rows, cols } = getPinHeaderGeometry(data);
  if (!(pin >= 1 && pin <= rows * cols)) return null;
  const r = Math.floor((pin - 1) / cols);
  const c = (pin - 1) % cols;
  // The pad matrix turned clockwise about the body: column-across and row-down
  // trade places on the odd turns, and each turn puts one of them in reverse.
  const [across, down] = ([
    [c, r],
    [rows - 1 - r, c],
    [cols - 1 - c, rows - 1 - r],
    [r, cols - 1 - c],
  ] as const)[pinHeaderQuarterTurns(data)];
  return {
    dx: 4 + across * PIN_HEADER_CELL_PX + PIN_HEADER_CELL_PX / 2,
    dy: 4 + down * PIN_HEADER_CELL_PX + PIN_HEADER_CELL_PX / 2,
  };
}

/**
 * Which edge of the body pad `pin` faces out of: the first row leaves by the
 * near long edge and every other row by the far one, turned along with the body.
 */
export function pinHeaderPadSide(
  data: RawNodeData | undefined,
  pin: number
): 'top' | 'bottom' | 'left' | 'right' {
  const { cols } = getPinHeaderGeometry(data);
  const firstRow = pin >= 1 && pin <= cols;
  const sides = ([
    ['top', 'bottom'],
    ['right', 'left'],
    ['bottom', 'top'],
    ['left', 'right'],
  ] as const)[pinHeaderQuarterTurns(data)];
  return firstRow ? sides[0] : sides[1];
}

export interface CutoutGeometry {
  shape: 'rect' | 'circle';
  widthMm: number;
  heightMm: number;
}

/**
 * Reads the geometry off a node's data, clamped to something millable.
 *
 * Called from edge routing and the PCB exporter as well as from the symbol, so
 * what arrives is `Node['data']` — a bag of `unknown` that may have come from a
 * saved file or an MCP agent. `Math.max` did this conversion implicitly while
 * the parameter was `any`.
 */
export function getCutoutGeometry(data?: RawNodeData): CutoutGeometry {
  const shape = data?.cutoutShape === 'circle' ? 'circle' : 'rect';
  const widthMm = Math.max(1, Number(data?.cutoutWidthMm ?? 10));
  // A circular cutout is defined by its diameter alone.
  const heightMm = shape === 'circle' ? widthMm : Math.max(1, Number(data?.cutoutHeightMm ?? 6));
  return { shape, widthMm, heightMm };
}

/** On-canvas pixel size, at roughly 2px per mm. */
export function getCutoutSize(data?: RawNodeData): { width: number; height: number } {
  const { widthMm, heightMm } = getCutoutGeometry(data);
  return {
    width: Math.max(24, Math.min(160, widthMm * 2)),
    height: Math.max(20, Math.min(160, heightMm * 2)),
  };
}
