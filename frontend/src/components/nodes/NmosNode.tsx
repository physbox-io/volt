import { Handle, Position } from '@xyflow/react';

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
        strokeWidth="1.5" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        className={`text-slate-855 dark:text-slate-145 transition-colors ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.8)]' : ''}`}
      >
        {/* Gate Lead */}
        <path d="M 0 20 H 16" />
        {/* Gate Plate */}
        <path d="M 16 10 V 30" strokeWidth="2.2" />
        {/* Channel Plate (3 segments) */}
        <path d="M 20 10 V 15" strokeWidth="2.0" />
        <path d="M 20 18 V 22" strokeWidth="2.0" />
        <path d="M 20 25 V 30" strokeWidth="2.0" />
        {/* Drain Lead */}
        <path d="M 20 12 H 30 V 0" />
        {/* Source Lead */}
        <path d="M 20 28 H 30 V 40" />
        {/* Substrate line */}
        <path d="M 20 20 H 30" />
        {/* Body arrow pointing inwards */}
        <path d="M 20 20 L 26 17 M 20 20 L 26 23" strokeWidth="1.2" />
      </svg>

      <div className="absolute left-1 top-2 text-[9px] font-bold font-mono text-slate-500 dark:text-slate-400 pointer-events-none">
        {data.label || 'NMOS'}
      </div>
    </div>
  );
}


