import { Handle, Position } from '@xyflow/react';
import type { NodePropertiesProps } from './registry';
import { NumberInput } from '../NumberInput';

/**
 * A plated through-hole. On a single-sided milled board this is the tie point
 * for a hand-fitted wire jumper, which is how you get a net across a trace the
 * router could not go around.
 *
 * It has one pad and one handle, so wiring two nets to it merges them.
 */

export function viaDefaultData(label?: string) {
  return {
    label: label || 'Via',
    drillDiameterMm: 0.6,
    padDiameterMm: 1.2,
  };
}

export function ViaProperties({ node, updateData }: NodePropertiesProps) {
  const drill = node.data?.drillDiameterMm ?? 0.6;
  const pad = node.data?.padDiameterMm ?? 1.2;
  const inputClass =
    'w-full text-sm border border-gray-300 rounded px-2 py-1 bg-white dark:bg-slate-900 ' +
    'text-slate-700 dark:text-slate-200 focus:border-emerald-500 focus:outline-none';

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Drill (mm)</label>
          <NumberInput
            step={0.1}
            min={0.2}
            value={drill}
            onChange={v => updateData('drillDiameterMm', v)}
                      className={inputClass}
                    />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Pad (mm)</label>
          <NumberInput
            step={0.1}
            min={0.4}
            value={pad}
            onChange={v => updateData('padDiameterMm', v)}
                      className={inputClass}
                    />
        </div>
      </div>
      {pad < drill + 0.4 && (
        <p className="mb-2 text-[11px] text-amber-600 dark:text-amber-400">
          The pad is raised to {(drill + 0.4).toFixed(1)}mm so the annular ring survives the
          isolation cut.
        </p>
      )}
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Mechanical only — a via is ignored by the simulator. Wiring two nets to it joins them,
        which on a single-layer board means a wire jumper.
      </p>
    </>
  );
}

export function ViaNode() {
  return (
    <div className="schematic-node relative w-[16px] h-[16px] flex items-center justify-center">
      <Handle
        type="target"
        position={Position.Top}
        id="1"
        className="!w-3 !h-3 !bg-transparent !border-0"
        style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
      />
      <Handle
        type="source"
        position={Position.Top}
        id="1"
        className="!w-3 !h-3 !bg-transparent !border-0"
        style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
      />
      <svg width="16" height="16" viewBox="0 0 16 16" style={{ overflow: 'visible' }}>
        <circle cx="8" cy="8" r="6" className="fill-amber-400 stroke-slate-600" strokeWidth="1.2" />
        <circle cx="8" cy="8" r="2.4" className="fill-slate-800 dark:fill-slate-950" />
      </svg>
    </div>
  );
}
