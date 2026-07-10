import { Handle, Position } from '@xyflow/react';

export function NpnNode({ data, selected }: any) {
  return (
    <div className="schematic-node w-[48px] h-[48px] flex items-center justify-center relative select-none">
      <Handle type="target" position={Position.Top} id="c" className="w-2 h-2 bg-blue-500 !border-0" style={{ left: '66.67%' }} />
      <Handle type="source" position={Position.Top} id="c" className="w-2 h-2 bg-blue-500 !border-0" style={{ left: '66.67%' }} />
      <Handle type="target" position={Position.Left} id="b" className="w-2 h-2 bg-blue-500 !border-0" style={{ top: '50%' }} />
      <Handle type="source" position={Position.Left} id="b" className="w-2 h-2 bg-blue-500 !border-0" style={{ top: '50%' }} />
      <Handle type="source" position={Position.Bottom} id="e" className="w-2 h-2 bg-blue-500 !border-0" style={{ left: '66.67%' }} />
      <Handle type="target" position={Position.Bottom} id="e" className="w-2 h-2 bg-blue-500 !border-0" style={{ left: '66.67%' }} />
      
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
        {/* Base Lead */}
        <path d="M 0 20 H 16" />
        {/* Base Plate */}
        <path d="M 16 10 V 30" strokeWidth="2.2" />
        {/* Collector Lead */}
        <path d="M 16 15 L 26.67 5 V 0" />
        {/* Emitter Lead */}
        <path d="M 16 25 L 26.67 35 V 40" />
        {/* Emitter Arrow pointing out */}
        <path d="M 26.67 35 L 20 34 M 26.67 35 L 24 28" strokeWidth="1.2" />
      </svg>

      <div className="absolute left-1 top-2 text-[9px] font-bold font-mono text-slate-500 dark:text-slate-400 pointer-events-none">
        {data.label || 'NPN'}
      </div>
    </div>
  );
}


