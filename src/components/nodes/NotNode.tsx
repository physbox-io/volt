import { Handle, Position } from '@xyflow/react';

export function NotNode({ selected }: any) {
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
          {/* Input lead */}
          <path d="M -4 50 H 25" />
          {/* Output lead */}
          <path d="M 80 50 H 104" />
        </g>

        <polygon 
          points="25,25 25,75 70,50" 
          className="fill-white dark:fill-slate-900 stroke-slate-700 dark:stroke-slate-200 transition-colors"
          style={{ stroke: selected ? '#3b82f6' : undefined }}
          strokeWidth="1.75" 
          strokeLinejoin="round" 
        />
        <circle 
          cx="75" 
          cy="50" 
          r="5" 
          className="fill-white dark:fill-slate-900 stroke-slate-700 dark:stroke-slate-200 transition-colors"
          style={{ stroke: selected ? '#3b82f6' : undefined }}
          strokeWidth="1.75" 
        />
        <text 
          x="40" 
          y="54" 
          textAnchor="middle"
          fontSize="11" 
          fontWeight="bold"
          className="fill-slate-700 dark:fill-slate-200 transition-colors font-sans"
        >
          NOT
        </text>
      </svg>
      
      {/* Input */}
      <Handle type="target" position={Position.Left} id="in1" className="w-2.5 h-2.5 bg-blue-500 !border-0 !top-[50%]" />
      <Handle type="source" position={Position.Left} id="in1" className="w-2.5 h-2.5 bg-blue-500 !border-0 !top-[50%]" />
      
      {/* Output */}
      <Handle type="source" position={Position.Right} id="out" className="w-2.5 h-2.5 bg-blue-500 !border-0 !top-[50%]" />
      <Handle type="target" position={Position.Right} id="out" className="w-2.5 h-2.5 bg-blue-500 !border-0 !top-[50%]" />
    </div>
  );
}

