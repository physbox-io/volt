import { Handle, Position } from '@xyflow/react';

export function AndNode({ selected }: any) {
  return (
    <div className="schematic-node bg-transparent w-[72px] h-[72px] relative flex items-center justify-center select-none">
      <svg 
        width="100%" 
        height="100%" 
        viewBox="0 0 100 100" 
        style={{ overflow: 'visible' }}
        className={`absolute top-0 left-0 transition-all ${selected ? 'drop-shadow-[0_0_4px_rgba(59,130,246,0.8)]' : 'drop-shadow-md'}`}
      >
        {/* Connection Leads */}
        <g 
          className="stroke-slate-800 dark:stroke-slate-200 transition-colors"
          style={{ stroke: selected ? '#3b82f6' : undefined }}
          strokeWidth="3.0"
          strokeLinecap="round"
        >
          {/* Input 1 lead */}
          <path d="M -4 30 H 20" />
          {/* Input 2 lead */}
          <path d="M -4 70 H 20" />
          {/* Output lead */}
          <path d="M 80 50 H 104" />
        </g>

        <path 
          d="M 20 20 L 50 20 A 30 30 0 0 1 50 80 L 20 80 Z" 
          className="fill-white dark:fill-slate-900 stroke-slate-800 dark:stroke-slate-200 transition-colors"
          style={{ stroke: selected ? '#3b82f6' : undefined }}
          strokeWidth="4" 
          strokeLinejoin="round" 
        />
        <text 
          x="35" 
          y="54" 
          fontSize="12" 
          fontWeight="bold"
          className="fill-slate-800 dark:fill-slate-200 transition-colors font-sans"
        >
          AND
        </text>
      </svg>
      
      {/* Inputs */}
      <Handle type="target" position={Position.Left} id="in1" className="w-2.5 h-2.5 bg-blue-500 !border-0 !top-[30%]" />
      <Handle type="source" position={Position.Left} id="in1" className="w-2.5 h-2.5 bg-blue-500 !border-0 !top-[30%]" />
      <Handle type="target" position={Position.Left} id="in2" className="w-2.5 h-2.5 bg-blue-500 !border-0 !top-[70%]" />
      <Handle type="source" position={Position.Left} id="in2" className="w-2.5 h-2.5 bg-blue-500 !border-0 !top-[70%]" />
      
      {/* Output */}
      <Handle type="source" position={Position.Right} id="out" className="w-2.5 h-2.5 bg-blue-500 !border-0 !top-[50%]" />
      <Handle type="target" position={Position.Right} id="out" className="w-2.5 h-2.5 bg-blue-500 !border-0 !top-[50%]" />
    </div>
  );
}

