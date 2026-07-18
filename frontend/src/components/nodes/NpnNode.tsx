import { Handle, Position } from '@xyflow/react';
import type { NodePropertiesProps } from './registry';

/** Shared by NpnNode and PnpNode — both BJT types expose the same single "current gain" property. */
export function BJTProperties({ node, updateData }: NodePropertiesProps) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-gray-700 mb-1">Current Gain (BF)</label>
      <input type="number" value={(node.data.bf as number) || 300} onChange={e => updateData('bf', parseInt(e.target.value))} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
    </div>
  );
}

export function NpnNode({ data, selected }: any) {
  return (
    <div className="schematic-node w-[32px] h-[32px] flex items-center justify-center relative select-none">
      <Handle type="target" position={Position.Top} id="c" className="w-2 h-2 bg-blue-500 !border-0" style={{ left: '75%' }} />
      <Handle type="source" position={Position.Top} id="c" className="w-2 h-2 bg-blue-500 !border-0" style={{ left: '75%' }} />
      <Handle type="target" position={Position.Left} id="b" className="w-2 h-2 bg-blue-500 !border-0" style={{ top: '50%' }} />
      <Handle type="source" position={Position.Left} id="b" className="w-2 h-2 bg-blue-500 !border-0" style={{ top: '50%' }} />
      <Handle type="source" position={Position.Bottom} id="e" className="w-2 h-2 bg-blue-500 !border-0" style={{ left: '75%' }} />
      <Handle type="target" position={Position.Bottom} id="e" className="w-2 h-2 bg-blue-500 !border-0" style={{ left: '75%' }} />
      
      <svg 
        width="32" 
        height="32" 
        viewBox="0 0 32 32" 
        fill="none" 
        stroke={selected ? '#3b82f6' : 'currentColor'} 
        strokeWidth="1.2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        style={{ overflow: 'visible' }}
        className={`text-slate-855 dark:text-slate-145 transition-colors ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.8)]' : ''}`}
      >
        {/* Base Lead */}
        <path d="M -4 16 H 12" />
        {/* Base Plate */}
        <path d="M 12 8 V 24" strokeWidth="2.0" />
        {/* Collector Lead: diagonal then vertical */}
        <path d="M 12 12 L 24 4 V -4" />
        {/* Emitter Lead: diagonal then vertical */}
        <path d="M 12 20 L 24 28 V 36" />
        {/* Emitter Arrow in the middle of the leg, pointing outward */}
        <path d="M 21 26 L 16 26 M 21 26 L 19 22" strokeWidth="1.2" />
      </svg>

      <div className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 text-[8px] font-bold font-mono text-slate-600 dark:text-slate-400 pointer-events-none whitespace-nowrap">
        {data.label || 'NPN'}
      </div>
    </div>
  );
}


