import { Handle, Position } from '@xyflow/react';

export function OpAmpNode({ selected }: any) {
  return (
    <div className="schematic-node bg-transparent w-[80px] h-[80px] relative flex items-center justify-center select-none">
      {/* Triangle representation */}
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
          {/* Inverting input lead */}
          <path d="M -4 30 H 10" />
          {/* Non-inverting input lead */}
          <path d="M -4 70 H 10" />
          {/* Output lead */}
          <path d="M 90 50 H 104" />
          {/* VCC lead */}
          <path d="M 50 -4 V 30" />
          {/* VEE lead */}
          <path d="M 50 70 V 104" />
        </g>

        <polygon 
          points="10,10 10,90 90,50" 
          className="fill-white dark:fill-slate-900 stroke-slate-700 dark:stroke-slate-200 transition-colors"
          style={{ stroke: selected ? '#3b82f6' : undefined }}
          strokeWidth="1.75" 
          strokeLinejoin="round" 
        />
        <text x="26" y="36" textAnchor="middle" fontSize="11" fontWeight="bold" className="fill-slate-700 dark:fill-slate-200 transition-colors font-sans">-</text>
        <text x="26" y="76" textAnchor="middle" fontSize="11" fontWeight="bold" className="fill-slate-700 dark:fill-slate-200 transition-colors font-sans">+</text>
        <text x="42" y="55" textAnchor="middle" fontSize="9" fontWeight="bold" className="fill-slate-700 dark:fill-slate-200 transition-colors font-sans">LM358</text>
      </svg>
      
      {/* Handles */}
      {/* Inverting input */}
      <Handle type="target" position={Position.Left} id="in_inv" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[30%]" />
      <Handle type="source" position={Position.Left} id="in_inv" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[30%]" />
      {/* Non-inverting input */}
      <Handle type="target" position={Position.Left} id="in_non" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[70%]" />
      <Handle type="source" position={Position.Left} id="in_non" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[70%]" />
      
      {/* Output */}
      <Handle type="source" position={Position.Right} id="out" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[50%]" />
      <Handle type="target" position={Position.Right} id="out" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[50%]" />
      
      {/* Power pins (top/bottom) */}
      <Handle type="target" position={Position.Top} id="vcc" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !left-[50%]" />
      <Handle type="source" position={Position.Top} id="vcc" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !left-[50%]" />
      <Handle type="target" position={Position.Bottom} id="vee" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !left-[50%]" />
      <Handle type="source" position={Position.Bottom} id="vee" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !left-[50%]" />
    </div>
  );
}

