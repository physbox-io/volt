import { Handle, Position } from '@xyflow/react';

export function OpAmpNode({ selected }: any) {
  return (
    <div className="schematic-node bg-transparent w-[72px] h-[72px] relative flex items-center justify-center select-none">
      {/* Triangle representation */}
      <svg 
        width="100%" 
        height="100%" 
        viewBox="0 0 100 100" 
        className={`absolute top-0 left-0 transition-all ${selected ? 'drop-shadow-[0_0_4px_rgba(59,130,246,0.8)]' : 'drop-shadow-md'}`}
      >
        <polygon 
          points="10,10 10,90 90,50" 
          className="fill-white dark:fill-slate-900 stroke-slate-800 dark:stroke-slate-200 transition-colors"
          style={{ stroke: selected ? '#3b82f6' : undefined }}
          strokeWidth="4" 
          strokeLinejoin="round" 
        />
        <text x="25" y="35" fontSize="12" fontWeight="bold" className="fill-slate-800 dark:fill-slate-200 transition-colors font-sans">-</text>
        <text x="25" y="75" fontSize="12" fontWeight="bold" className="fill-slate-800 dark:fill-slate-200 transition-colors font-sans">+</text>
        <text x="45" y="55" fontSize="10" fontWeight="bold" className="fill-slate-800 dark:fill-slate-200 transition-colors font-sans">LM358</text>
      </svg>
      
      {/* Handles */}
      {/* Inverting input */}
      <Handle type="target" position={Position.Left} id="in_inv" className="w-2.5 h-2.5 bg-blue-500 !border-0 !top-[30%]" />
      <Handle type="source" position={Position.Left} id="in_inv" className="w-2.5 h-2.5 bg-blue-500 !border-0 !top-[30%]" />
      {/* Non-inverting input */}
      <Handle type="target" position={Position.Left} id="in_non" className="w-2.5 h-2.5 bg-blue-500 !border-0 !top-[70%]" />
      <Handle type="source" position={Position.Left} id="in_non" className="w-2.5 h-2.5 bg-blue-500 !border-0 !top-[70%]" />
      
      {/* Output */}
      <Handle type="source" position={Position.Right} id="out" className="w-2.5 h-2.5 bg-blue-500 !border-0 !top-[50%]" />
      <Handle type="target" position={Position.Right} id="out" className="w-2.5 h-2.5 bg-blue-500 !border-0 !top-[50%]" />
      
      {/* Power pins (top/bottom) */}
      <Handle type="target" position={Position.Top} id="vcc" className="w-2.5 h-2.5 bg-blue-500 !border-0 !left-[50%]" />
      <Handle type="source" position={Position.Top} id="vcc" className="w-2.5 h-2.5 bg-blue-500 !border-0 !left-[50%]" />
      <Handle type="target" position={Position.Bottom} id="vee" className="w-2.5 h-2.5 bg-blue-500 !border-0 !left-[50%]" />
      <Handle type="source" position={Position.Bottom} id="vee" className="w-2.5 h-2.5 bg-blue-500 !border-0 !left-[50%]" />
    </div>
  );
}

