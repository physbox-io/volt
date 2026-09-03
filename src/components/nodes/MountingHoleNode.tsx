import type { NodePropertiesProps } from './registry';
import { NumberInput } from '../NumberInput';

/**
 * An unplated screw / mounting hole. It carries no net and has no handles, so
 * it never appears in the netlist and never grows copper — but it is placed on
 * the board, it is drilled, and the router keeps its keepout clear so no trace
 * runs under the screw head.
 */

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

export function MountingHoleProperties({ node, updateData }: NodePropertiesProps) {
  const hole = node.data?.holeDiameterMm ?? 3.2;
  const keepout = node.data?.keepoutDiameterMm ?? 6.5;
  const inputClass =
    'w-full text-sm border border-gray-300 rounded px-2 py-1 bg-white dark:bg-slate-900 ' +
    'text-slate-700 dark:text-slate-200 focus:border-emerald-500 focus:outline-none';

  return (
    <>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">Screw Size</label>
        <select
          value={node.data?.screwSize ?? 'M3'}
          onChange={e => {
            const preset = MOUNTING_HOLE_PRESETS.find(p => p.id === e.target.value);
            updateData('screwSize', e.target.value);
            if (preset) {
              updateData('holeDiameterMm', preset.holeMm);
              updateData('keepoutDiameterMm', preset.keepoutMm);
            }
          }}
          className={inputClass}
        >
          {MOUNTING_HOLE_PRESETS.map(p => (
            <option key={p.id} value={p.id}>
              {p.label} — {p.holeMm}mm drill
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Hole (mm)</label>
          <NumberInput
            step={0.1}
            min={0.5}
            value={hole}
            onChange={v => {
              updateData('screwSize', 'custom');
              updateData('holeDiameterMm', v);
            }} className={inputClass}
                    />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Keepout (mm)</label>
          <NumberInput
            step={0.1}
            min={0.5}
            value={keepout}
            onChange={v => {
              updateData('screwSize', 'custom');
              updateData('keepoutDiameterMm', v);
            }} className={inputClass}
                    />
        </div>
      </div>

      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Mechanical only — no net, no copper, no simulation. The keepout is the washer or
        screw-head diameter; traces are routed around it.
      </p>
    </>
  );
}

export function MountingHoleNode({ data }: { data?: any }) {
  const label = data?.screwSize && data.screwSize !== 'custom' ? data.screwSize : '';
  return (
    <div className="schematic-node relative w-[24px] h-[24px] flex items-center justify-center">
      <svg width="22" height="22" viewBox="0 0 22 22" style={{ overflow: 'visible' }}>
        <circle
          cx="11"
          cy="11"
          r="9"
          className="fill-none stroke-slate-400 dark:stroke-slate-500"
          strokeWidth="1"
          strokeDasharray="2 2"
        />
        <circle
          cx="11"
          cy="11"
          r="5"
          className="fill-slate-100 dark:fill-slate-800 stroke-slate-600 dark:stroke-slate-300"
          strokeWidth="1.4"
        />
      </svg>
      {label && (
        <div className="absolute left-0 right-0 -bottom-4 text-center text-[9px] text-slate-500 dark:text-slate-400 pointer-events-none">
          {label}
        </div>
      )}
    </div>
  );
}
