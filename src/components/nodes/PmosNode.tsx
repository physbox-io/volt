import { Handle, Position } from '@xyflow/react';
import { SchematicLabel } from './schematic';

export function PmosNode({ data, selected }: any) {
  return (
    <div className="schematic-node w-[48px] h-[48px] flex items-center justify-center relative select-none">
      <Handle type="target" position={Position.Top} id="s" className="w-2 h-2 bg-emerald-500 !border-0" style={{ left: '75%' }} />
      <Handle type="target" position={Position.Left} id="g" className="w-2 h-2 bg-emerald-500 !border-0" style={{ top: '50%' }} />
      <Handle type="source" position={Position.Bottom} id="d" className="w-2 h-2 bg-emerald-500 !border-0" style={{ left: '75%' }} />
      
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
        {/* Gate Lead & Bubble */}
        <path d="M 0 20 H 12" />
        <circle cx="14" cy="20" r="2" fill="none" strokeWidth="1.17" />
        {/* Gate Plate */}
        <path d="M 16 10 V 30" strokeWidth="2" />
        {/* Channel Plate (3 segments) */}
        <path d="M 20 10 V 15" strokeWidth="2" />
        <path d="M 20 18 V 22" strokeWidth="2" />
        <path d="M 20 25 V 30" strokeWidth="2" />
        {/* Source Lead (Top) */}
        <path d="M 20 12 H 30 V 0" />
        {/* Drain Lead (Bottom) */}
        <path d="M 20 28 H 30 V 40" />
        {/* Substrate line */}
        <path d="M 20 20 H 30" />
        {/* Body arrow pointing outwards */}
        <path d="M 30 20 L 24 17 M 30 20 L 24 23" strokeWidth="1.17" />
      </svg>

      <SchematicLabel placement="right">
        {data.label || 'PMOS'}
      </SchematicLabel>
    </div>
  );
}


