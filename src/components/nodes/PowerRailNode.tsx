import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { NumberInput } from '@physbox-io/ui';
import type { NodePropertiesProps } from './registry';
import type { PowerRailNodeData } from '../../types/nodes';
import {
  DEFAULT_RAIL,
  POWER_RAIL_PRESETS,
  netDisplayName,
  railVoltage,
} from '../../utils/netNaming';

/**
 * A power rail: ground's opposite number.
 *
 * Like a net label it joins every pin carrying the same name onto one net
 * without a wire. Unlike a label it also *drives* that net — one DC source
 * against ground per rail, however many flags are drawn — so `+5V` means five
 * volts and not merely "the same node as the other +5V".
 */

export function PowerRailProperties({ node, updateData }: NodePropertiesProps) {
  const rail = netDisplayName(node.data?.rail, DEFAULT_RAIL);
  const preset = POWER_RAIL_PRESETS.find(p => p.rail.toUpperCase() === rail);
  const volts = railVoltage(node.data);
  const inputClass =
    'w-full text-sm border border-gray-300 dark:border-slate-800 rounded px-2 py-1 bg-white dark:bg-slate-900 ' +
    'text-slate-800 dark:text-slate-200 focus:border-emerald-500 focus:outline-none';

  return (
    <>
      <div className="mb-3">
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Rail</label>
        <div className="grid grid-cols-3 gap-1 mb-2">
          {POWER_RAIL_PRESETS.map(p => (
            <button
              key={p.rail}
              type="button"
              onClick={() => { updateData('rail', p.rail); updateData('voltage', p.voltage); }}
              className={`text-[11px] font-mono px-1.5 py-1 rounded border transition-colors ${
                rail === p.rail.toUpperCase()
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                  : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {p.rail}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={rail}
          onChange={e => updateData('rail', e.target.value)}
          className={inputClass + ' font-mono'}
        />
      </div>
      <div className="mb-3">
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Supplies (V)</label>
        <NumberInput
          step={0.1}
          value={volts}
          onChange={v => updateData('voltage', v)}
          className={inputClass}
        />
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        {preset
          ? `Every pin on ${rail} sees ${volts}V against ground, with no wire drawn to it.`
          : `A rail of your own: every pin on ${rail} sees ${volts}V against ground.`}
        {' '}Drop as many flags as the circuit needs — they are one supply, not one each.
      </p>
    </>
  );
}

export function PowerRailNode({ data, selected }: NodeProps<Node<PowerRailNodeData>>) {
  const rail = netDisplayName(data?.rail, DEFAULT_RAIL);

  return (
    <div className="schematic-node relative flex flex-col items-center justify-end w-[24px] h-[24px]">
      {/* The pin is underneath the bar: the wire comes up into the rail, the
          mirror of a ground symbol's wire going down into it. */}
      <Handle type="target" position={Position.Bottom} id="in" className="w-3 h-3 bg-green-500" />
      <Handle type="source" position={Position.Bottom} id="in" className="w-3 h-3 bg-green-500" />

      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        className={selected ? 'text-emerald-500' : 'text-slate-700 dark:text-slate-200 transition-colors'}
        style={{ overflow: 'visible' }}
      >
        {/* Stem down to the pin, bar across the top, name above it. */}
        <path d="M12 24V8" />
        <path d="M2 8h20" />
        <text
          x="12"
          y="4"
          textAnchor="middle"
          stroke="none"
          className={selected ? 'fill-emerald-500' : 'fill-slate-700 dark:fill-slate-200'}
          style={{ font: '600 9px ui-monospace, monospace' }}
        >
          {rail.length > 6 ? `${rail.slice(0, 5)}…` : rail}
        </text>
      </svg>
    </div>
  );
}
