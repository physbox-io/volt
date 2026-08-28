import { Handle, Position } from '@xyflow/react';
import type { NodePropertiesProps } from './registry';

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

/** On-canvas pixel size. Kept in one place so edge routing can agree with it. */
export const PIN_HEADER_CELL_PX = 16;
export function getPinHeaderSize(data?: any): { width: number; height: number } {
  const { rows, cols } = getPinHeaderGeometry(data);
  return {
    width: cols * PIN_HEADER_CELL_PX + 8,
    height: rows * PIN_HEADER_CELL_PX + 8,
  };
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
          const left = 4 + c * PIN_HEADER_CELL_PX + PIN_HEADER_CELL_PX / 2;
          const top = 4 + r * PIN_HEADER_CELL_PX + PIN_HEADER_CELL_PX / 2;
          // Pins on the top row face up, everything else faces down, so wires
          // leave the header on the nearest side.
          const side = r === 0 ? Position.Top : Position.Bottom;
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
          <input
            type="number"
            min={PIN_HEADER_LIMITS.minRows}
            max={PIN_HEADER_LIMITS.maxRows}
            value={geom.rows}
            onChange={e => updateData('rows', parseInt(e.target.value, 10) || 1)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Columns</label>
          <input
            type="number"
            min={PIN_HEADER_LIMITS.minCols}
            max={PIN_HEADER_LIMITS.maxCols}
            value={geom.cols}
            onChange={e => updateData('cols', parseInt(e.target.value, 10) || 1)}
            className={inputClass}
          />
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Pitch (mm)</label>
          <input
            type="number"
            step="0.01"
            min="0.5"
            value={geom.pitchMm}
            onChange={e => updateData('pitchMm', parseFloat(e.target.value) || 2.54)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Row Spacing (mm)</label>
          <input
            type="number"
            step="0.01"
            min="0.5"
            value={geom.rowSpacingMm}
            onChange={e => updateData('rowSpacingMm', parseFloat(e.target.value) || 2.54)}
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
