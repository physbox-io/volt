import type { Node, NodeProps } from '@xyflow/react';
import type { NodePropertiesProps } from './registry';
import type { CutoutNodeData } from '../../types/nodes';
import { NumberInput } from '@physbox-io/ui';
import { getCutoutGeometry, getCutoutSize } from './boardGeometry';

/**
 * A hole milled clean through the board — a slot for a connector to poke
 * through, a window, or a non-rectangular board edge feature.
 *
 * It has no pads and no handles, so it never reaches the netlist. On the board
 * it is a routing keepout and an extra profile contour in the G-code, cut with
 * the profile end mill at the profile depth.
 */

export function CutoutProperties({ node, updateData }: NodePropertiesProps) {
  const geom = getCutoutGeometry(node.data);
  const inputClass =
    'w-full text-sm border border-gray-300 rounded px-2 py-1 bg-white dark:bg-slate-900 ' +
    'text-slate-700 dark:text-slate-200 focus:border-emerald-500 focus:outline-none';

  return (
    <>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">Shape</label>
        <select
          value={geom.shape}
          onChange={e => updateData('cutoutShape', e.target.value)}
          className={inputClass}
        >
          <option value="rect">Rectangle / Slot</option>
          <option value="circle">Circle</option>
        </select>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            {geom.shape === 'circle' ? 'Diameter (mm)' : 'Width (mm)'}
          </label>
          <NumberInput
            step={0.5}
            min={1}
            value={geom.widthMm}
            onChange={v => updateData('cutoutWidthMm', v)}
                      className={inputClass}
                    />
        </div>
        {geom.shape === 'rect' && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Height (mm)</label>
            <NumberInput
              step={0.5}
              min={1}
              value={geom.heightMm}
              onChange={v => updateData('cutoutHeightMm', v)}
                      className={inputClass}
                    />
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Milled through with the profile end mill, at the profile depth. Traces are routed
        around it. Mechanical only — no net, no simulation.
      </p>
    </>
  );
}

export function CutoutNode({ data }: NodeProps<Node<CutoutNodeData>>) {
  const geom = getCutoutGeometry(data);
  const { width, height } = getCutoutSize(data);
  return (
    <div className="schematic-node relative" style={{ width, height }}>
      <svg width={width} height={height} style={{ overflow: 'visible' }}>
        {geom.shape === 'circle' ? (
          <circle
            cx={width / 2}
            cy={height / 2}
            r={Math.min(width, height) / 2 - 1}
            className="fill-slate-300/40 dark:fill-slate-900/60 stroke-rose-400"
            strokeWidth="1.6"
            strokeDasharray="4 3"
          />
        ) : (
          <rect
            x="1"
            y="1"
            width={width - 2}
            height={height - 2}
            rx="1.5"
            className="fill-slate-300/40 dark:fill-slate-900/60 stroke-rose-400"
            strokeWidth="1.6"
            strokeDasharray="4 3"
          />
        )}
      </svg>
      <div className="absolute left-0 right-0 -bottom-4 text-center text-[9px] text-slate-500 dark:text-slate-400 pointer-events-none">
        {geom.shape === 'circle'
          ? `⌀${geom.widthMm}`
          : `${geom.widthMm}×${geom.heightMm}`}
      </div>
    </div>
  );
}
