import { Handle, Position } from '@xyflow/react';
import type { NodePropertiesProps } from './registry';
import { NumberInput } from '../NumberInput';

/**
 * A bare pin header of arbitrary rows x cols. It is a mechanical breakout
 * only — it contributes no device to the SPICE netlist, but its pins do join
 * whatever nets they are wired to, so the board router treats them as real
 * copper.
 *
 * Handle ids are the pad numbers as strings, numbered row-major from 1, which
 * is exactly the numbering `generateMatrixHeaderFootprint` produces. That makes
 * handle-to-pad resolution fall out with no mapping table.
 */

export interface PinHeaderGeometry {
  rows: number;
  cols: number;
  pitchMm: number;
  rowSpacingMm: number;
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

/** Reads the geometry off a node's data, clamped to something buildable. */
export function getPinHeaderGeometry(data?: any): PinHeaderGeometry {
  const rows = Math.min(
    PIN_HEADER_LIMITS.maxRows,
    Math.max(PIN_HEADER_LIMITS.minRows, Math.round(data?.rows ?? 1))
  );
  const cols = Math.min(
    PIN_HEADER_LIMITS.maxCols,
    Math.max(PIN_HEADER_LIMITS.minCols, Math.round(data?.cols ?? 8))
  );
  const pitchMm = data?.pitchMm > 0 ? data.pitchMm : 2.54;
  return {
    rows,
    cols,
    pitchMm,
    rowSpacingMm: data?.rowSpacingMm > 0 ? data.rowSpacingMm : pitchMm,
  };
}

/** Pad numbers, row-major from 1 — the handle ids for this node. */
export function getPinHeaderHandles(data?: any): string[] {
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
export function pinHeaderQuarterTurns(data?: any): 0 | 1 | 2 | 3 {
  const i = ['horizontal', 'vertical', 'left', 'up'].indexOf(data?.orientation);
  return (i < 0 ? 0 : i) as 0 | 1 | 2 | 3;
}

/** True when the strip runs down the canvas rather than across it. */
export function isPinHeaderVertical(data?: any): boolean {
  return pinHeaderQuarterTurns(data) % 2 === 1;
}

/** On-canvas pixel size. Kept in one place so edge routing can agree with it. */
export const PIN_HEADER_CELL_PX = 16;
export function getPinHeaderSize(data?: any): { width: number; height: number } {
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
  data: any,
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
  data: any,
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

export function PinHeaderNode({ data }: { data?: any }) {
  const { rows, cols } = getPinHeaderGeometry(data);
  const { width, height } = getPinHeaderSize(data);

  return (
    <div
      className="schematic-node relative rounded-sm border border-slate-500 bg-slate-200 dark:bg-slate-700"
      style={{ width, height }}
    >
      {Array.from({ length: rows }).map((_, r) =>
        Array.from({ length: cols }).map((_, c) => {
          const pin = r * cols + c + 1;
          const { dx: left, dy: top } = pinHeaderPadOffset(data, pin)!;
          // Wires leave the header by the nearest long edge, which is a
          // different edge of the canvas depending on how the strip is turned.
          const side = {
            top: Position.Top,
            bottom: Position.Bottom,
            left: Position.Left,
            right: Position.Right,
          }[pinHeaderPadSide(data, pin)];
          return (
            <div key={pin}>
              {/* Pad graphic: square for pin 1, the usual polarity mark. */}
              <div
                className={`absolute border border-slate-600 bg-amber-300 dark:bg-amber-400 ${
                  pin === 1 ? '' : 'rounded-full'
                }`}
                style={{
                  width: 9,
                  height: 9,
                  left: left - 4.5,
                  top: top - 4.5,
                  pointerEvents: 'none',
                }}
              />
              <Handle
                type="target"
                position={side}
                id={String(pin)}
                style={{ left, top, transform: 'translate(-50%, -50%)' }}
                className="!w-2.5 !h-2.5 !bg-transparent !border-0"
              />
              <Handle
                type="source"
                position={side}
                id={String(pin)}
                style={{ left, top, transform: 'translate(-50%, -50%)' }}
                className="!w-2.5 !h-2.5 !bg-transparent !border-0"
              />
            </div>
          );
        })
      )}
      <div className="absolute left-0 right-0 -bottom-4 text-center text-[9px] text-slate-500 dark:text-slate-400 pointer-events-none">
        {rows}x{cols}
      </div>
    </div>
  );
}

export function PinHeaderProperties({ node, updateData }: NodePropertiesProps) {
  const geom = getPinHeaderGeometry(node.data);
  const inputClass =
    'w-full text-sm border border-gray-300 rounded px-2 py-1 bg-white dark:bg-slate-900 ' +
    'text-slate-700 dark:text-slate-200 focus:border-emerald-500 focus:outline-none';

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Rows</label>
          <NumberInput
            min={PIN_HEADER_LIMITS.minRows}
            max={PIN_HEADER_LIMITS.maxRows}
            value={geom.rows}
            onChange={v => updateData('rows', v)}
                      className={inputClass}
                      integer
                    />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Columns</label>
          <NumberInput
            min={PIN_HEADER_LIMITS.minCols}
            max={PIN_HEADER_LIMITS.maxCols}
            value={geom.cols}
            onChange={v => updateData('cols', v)}
                      className={inputClass}
                      integer
                    />
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Pitch (mm)</label>
          <NumberInput
            step={0.01}
            min={0.5}
            value={geom.pitchMm}
            onChange={v => updateData('pitchMm', v)}
                      className={inputClass}
                    />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Row Spacing (mm)</label>
          <NumberInput
            step={0.01}
            min={0.5}
            value={geom.rowSpacingMm}
            onChange={v => updateData('rowSpacingMm', v)}
                      className={inputClass}
                    />
        </div>
      </div>

      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        {geom.rows * geom.cols} pins, numbered row-major from pin 1 (square pad). Mechanical
        only — a header is ignored by the simulator, but its pins are routed on the board.
      </p>
    </>
  );
}
