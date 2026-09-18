import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { NodePropertiesProps } from './registry';
import type { PinHeaderNodeData } from '../../types/nodes';
import { NumberInput } from '@physbox-io/ui';
import { PIN_HEADER_LIMITS } from './partDefaults';
import {
  getPinHeaderGeometry,
  getPinHeaderSize,
  pinHeaderPadOffset,
  pinHeaderPadSide,
} from './boardGeometry';

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

export function PinHeaderNode({ data }: NodeProps<Node<PinHeaderNodeData>>) {
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
