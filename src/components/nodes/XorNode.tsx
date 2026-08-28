import { Handle, Position } from '@xyflow/react';

export function XorNode({ selected }: any) {
  return (
    <div className="schematic-node bg-transparent w-[80px] h-[80px] relative flex items-center justify-center select-none">
      <svg 
        width="100%" 
        height="100%" 
        viewBox="0 0 100 100" 
        style={{ overflow: 'visible' }}
        className={`absolute top-0 left-0 transition-all ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.65)]' : ''}`}
      >
        {/* Connection Leads */}
        <g 
          className="stroke-slate-700 dark:stroke-slate-200 transition-colors"
          style={{ stroke: selected ? '#3b82f6' : undefined }}
          strokeWidth="1.75"
          strokeLinecap="round"
        >
          {/* Input 1 lead */}
          <path d="M -4 30 H 18" />
          {/* Input 2 lead */}
          <path d="M -4 70 H 18" />
          {/* Output lead */}
          <path d="M 90 50 H 104" />
        </g>

        <path 
          d="M 20 20 Q 55 20 90 50 Q 55 80 20 80 Q 35 50 20 20 Z" 
          className="fill-white dark:fill-slate-900 stroke-slate-700 dark:stroke-slate-200 transition-colors"
          style={{ stroke: selected ? '#3b82f6' : undefined }}
          strokeWidth="1.75" 
          strokeLinejoin="round" 
        />
        <path 
          d="M 12 20 Q 27 50 12 80" 
          className="fill-none stroke-slate-700 dark:stroke-slate-200 transition-colors"
          style={{ stroke: selected ? '#3b82f6' : undefined }}
          strokeWidth="1.75" 
          strokeLinejoin="round" 
        />
        <text 
          x="48" 
          y="54" 
          textAnchor="middle"
          fontSize="11" 
          fontWeight="bold"
          className="fill-slate-700 dark:fill-slate-200 transition-colors font-sans"
        >
          XOR
        </text>
      </svg>
      
      {/* Inputs */}
      <Handle type="target" position={Position.Left} id="in1" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[30%]" />
      <Handle type="source" position={Position.Left} id="in1" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[30%]" />
      <Handle type="target" position={Position.Left} id="in2" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[70%]" />
      <Handle type="source" position={Position.Left} id="in2" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[70%]" />
      
      {/* Output */}
      <Handle type="source" position={Position.Right} id="out" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[50%]" />
      <Handle type="target" position={Position.Right} id="out" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[50%]" />
    </div>
  );
}

