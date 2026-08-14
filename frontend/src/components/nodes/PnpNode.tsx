import { Handle, Position } from '@xyflow/react';
import { SchematicLabel } from './schematic';

export function PnpNode({ data, selected }: any) {
  return (
    <div className="schematic-node w-[32px] h-[32px] flex items-center justify-center relative select-none">
      <Handle type="target" position={Position.Top} id="e" className="w-2 h-2 bg-blue-500 !border-0" style={{ left: '75%' }} />
      <Handle type="source" position={Position.Top} id="e" className="w-2 h-2 bg-blue-500 !border-0" style={{ left: '75%' }} />
      <Handle type="target" position={Position.Left} id="b" className="w-2 h-2 bg-blue-500 !border-0" style={{ top: '50%' }} />
      <Handle type="source" position={Position.Left} id="b" className="w-2 h-2 bg-blue-500 !border-0" style={{ top: '50%' }} />
      <Handle type="source" position={Position.Bottom} id="c" className="w-2 h-2 bg-blue-500 !border-0" style={{ left: '75%' }} />
      <Handle type="target" position={Position.Bottom} id="c" className="w-2 h-2 bg-blue-500 !border-0" style={{ left: '75%' }} />
      
      <svg 
        width="32" 
        height="32" 
        viewBox="0 0 32 32" 
        fill="none" 
        stroke={selected ? '#3b82f6' : 'currentColor'} 
        strokeWidth="1.4" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        style={{ overflow: 'visible' }}
        className={`text-slate-700 dark:text-slate-200 transition-colors ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.65)]' : ''}`}
      >
        {/* Base Lead */}
        <path d="M -4 16 H 12" />
        {/* Base Plate */}
        <path d="M 12 8 V 24" strokeWidth="2.4" />
        {/* Emitter Lead: diagonal then vertical (top) */}
        <path d="M 12 12 L 24 4 V -4" />
        {/* Collector Lead: diagonal then vertical (bottom) */}
        <path d="M 12 20 L 24 28 V 36" />
        {/* Emitter Arrow pointing inward toward base plate */}
        <path d="M 15 10 L 20 10 M 15 10 L 17 6" strokeWidth="1.4" />
      </svg>

      <SchematicLabel placement="below">
        {data.label || 'PNP'}
      </SchematicLabel>
    </div>
  );
}


