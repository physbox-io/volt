import { Handle, Position } from '@xyflow/react';
import type { NodePropertiesProps } from './registry';
import { SchematicLabel } from './schematic';

/** Shared by NmosNode and PmosNode. */
export function MosfetProperties({ node, updateData }: NodePropertiesProps) {
  return (
    <>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">Threshold Voltage (VTO)</label>
        <input type="number" step="0.1" value={(node.data.vto as number) || (node.type === 'nmos' ? 2.0 : -2.0)} onChange={e => updateData('vto', parseFloat(e.target.value))} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
      </div>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">Transconductance (KP)</label>
        <input type="number" step="0.01" value={(node.data.kp as number) || (node.type === 'nmos' ? 0.05 : 0.02)} onChange={e => updateData('kp', parseFloat(e.target.value))} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
      </div>
    </>
  );
}

export function NmosNode({ data, selected }: any) {
  return (
    <div className="schematic-node w-[48px] h-[48px] flex items-center justify-center relative select-none">
      <Handle type="target" position={Position.Top} id="d" className="w-2 h-2 bg-blue-500 !border-0" style={{ left: '75%' }} />
      <Handle type="target" position={Position.Left} id="g" className="w-2 h-2 bg-blue-500 !border-0" style={{ top: '50%' }} />
      <Handle type="source" position={Position.Bottom} id="s" className="w-2 h-2 bg-blue-500 !border-0" style={{ left: '75%' }} />
      
      <svg 
        width="48" 
        height="48" 
        viewBox="0 0 40 40" 
        fill="none" 
        stroke={selected ? '#3b82f6' : 'currentColor'} 
        strokeWidth="1.17" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        className={`text-slate-700 dark:text-slate-200 transition-colors ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.65)]' : ''}`}
      >
        {/* Gate Lead */}
        <path d="M 0 20 H 16" />
        {/* Gate Plate */}
        <path d="M 16 10 V 30" strokeWidth="2" />
        {/* Channel Plate (3 segments) */}
        <path d="M 20 10 V 15" strokeWidth="2" />
        <path d="M 20 18 V 22" strokeWidth="2" />
        <path d="M 20 25 V 30" strokeWidth="2" />
        {/* Drain Lead */}
        <path d="M 20 12 H 30 V 0" />
        {/* Source Lead */}
        <path d="M 20 28 H 30 V 40" />
        {/* Substrate line */}
        <path d="M 20 20 H 30" />
        {/* Body arrow pointing inwards */}
        <path d="M 20 20 L 26 17 M 20 20 L 26 23" strokeWidth="1.17" />
      </svg>

      <SchematicLabel placement="right">
        {data.label || 'NMOS'}
      </SchematicLabel>
    </div>
  );
}


