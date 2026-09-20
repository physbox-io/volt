import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { NodePropertiesProps } from './registry';
import type { NetLabelNodeData } from '../../types/nodes';
import { DEFAULT_NET_LABEL, netDisplayName } from '../../utils/netNaming';

/**
 * A named net: a flag hung on a wire that says what that wire is called.
 *
 * Every pin carrying the same name is one net, with no wire drawn between
 * them — the mechanism ground has always had, opened up to any name. A signal
 * that crossed the whole schematic as a wire becomes two flags reading `SDA`.
 */

export function NetLabelProperties({ node, updateData }: NodePropertiesProps) {
  const name = netDisplayName(node.data?.net, DEFAULT_NET_LABEL);

  return (
    <>
      <div className="mb-3">
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Net name</label>
        <input
          type="text"
          value={name}
          onChange={e => updateData('net', e.target.value)}
          className="w-full text-sm font-mono border border-gray-300 dark:border-slate-800 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:border-emerald-500 focus:outline-none"
        />
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Every pin with a label of this name is on one net, wire or no wire. Case is
        ignored, so <span className="font-mono">sda</span> and <span className="font-mono">SDA</span> are the
        same net. A label named <span className="font-mono">GND</span> (or <span className="font-mono">VSS</span>)
        is the ground net itself.
      </p>
    </>
  );
}

export function NetLabelNode({ data, selected }: NodeProps<Node<NetLabelNodeData>>) {
  const name = netDisplayName(data?.net, DEFAULT_NET_LABEL);

  return (
    <div
      className="schematic-node relative flex items-center"
      style={{ width: 64, height: 20 }}
    >
      {/* The wire arrives at the left point of the flag. Both handle roles on
          one id, as the ground symbol does, so a wire can be drawn either way. */}
      <Handle type="target" position={Position.Left} id="in" className="w-3 h-3 bg-green-500" />
      <Handle type="source" position={Position.Left} id="in" className="w-3 h-3 bg-green-500" />

      <svg width="64" height="20" viewBox="0 0 64 20" style={{ overflow: 'visible' }}>
        <path
          d="M 0 10 L 8 2 L 63 2 L 63 18 L 8 18 Z"
          className="fill-white dark:fill-slate-900 stroke-slate-600 dark:stroke-slate-200"
          strokeWidth="1.2"
          strokeLinejoin="round"
          style={selected ? { stroke: '#10b981' } : undefined}
        />
        <text
          x="35"
          y="14"
          textAnchor="middle"
          className="fill-slate-700 dark:fill-slate-100"
          style={{ font: '600 10px ui-monospace, monospace' }}
        >
          {name.length > 8 ? `${name.slice(0, 7)}…` : name}
        </text>
      </svg>
    </div>
  );
}
