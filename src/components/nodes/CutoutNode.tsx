import type { NodePropertiesProps } from './registry';

/**
 * A hole milled clean through the board — a slot for a connector to poke
 * through, a window, or a non-rectangular board edge feature.
 *
 * It has no pads and no handles, so it never reaches the netlist. On the board
 * it is a routing keepout and an extra profile contour in the G-code, cut with
 * the profile end mill at the profile depth.
 */

export interface CutoutGeometry {
  shape: 'rect' | 'circle';
  widthMm: number;
  heightMm: number;
}

export function cutoutDefaultData(label?: string) {
  return {
    label: label || 'Cutout',
    cutoutShape: 'rect' as const,
    cutoutWidthMm: 10,
    cutoutHeightMm: 6,
  };
}

/** Reads the geometry off a node's data, clamped to something millable. */
export function getCutoutGeometry(data?: any): CutoutGeometry {
  const shape = data?.cutoutShape === 'circle' ? 'circle' : 'rect';
  const widthMm = Math.max(1, data?.cutoutWidthMm ?? 10);
  // A circular cutout is defined by its diameter alone.
  const heightMm = shape === 'circle' ? widthMm : Math.max(1, data?.cutoutHeightMm ?? 6);
  return { shape, widthMm, heightMm };
}

/** On-canvas pixel size, at roughly 2px per mm. */
export function getCutoutSize(data?: any): { width: number; height: number } {
  const { widthMm, heightMm } = getCutoutGeometry(data);
  return {
    width: Math.max(24, Math.min(160, widthMm * 2)),
    height: Math.max(20, Math.min(160, heightMm * 2)),
  };
}

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
          <input
            type="number"
            step="0.5"
            min="1"
            value={geom.widthMm}
            onChange={e => updateData('cutoutWidthMm', parseFloat(e.target.value) || 10)}
            className={inputClass}
          />
        </div>
        {geom.shape === 'rect' && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Height (mm)</label>
            <input
              type="number"
              step="0.5"
              min="1"
              value={geom.heightMm}
              onChange={e => updateData('cutoutHeightMm', parseFloat(e.target.value) || 6)}
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

export function CutoutNode({ data }: { data?: any }) {
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
