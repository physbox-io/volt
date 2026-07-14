import { Handle, Position } from '@xyflow/react';

export function JunctionNode({ selected }: any) {
  return (
    <div className="w-[1px] h-[1px] flex items-center justify-center relative select-none">
      {/* Target handle for incoming wires */}
      <Handle 
        type="target" 
        position={Position.Left} 
        id="in" 
        className="w-4 h-4 !bg-transparent !border-0 -translate-x-1/2 -translate-y-1/2 !left-1/2 !top-1/2 cursor-crosshair" 
      />
      {/* Source handle for outgoing wires */}
      <Handle 
        type="source" 
        position={Position.Left} 
        id="out" 
        className="w-4 h-4 !bg-transparent !border-0 -translate-x-1/2 -translate-y-1/2 !left-1/2 !top-1/2 cursor-crosshair" 
      />
      
      {/* Junction dot visualization */}
      <div 
        className={`w-2 h-2 rounded-full bg-slate-700 dark:bg-slate-300 pointer-events-none transition-transform -translate-x-1/2 -translate-y-1/2 absolute left-1/2 top-1/2 ${selected ? 'scale-125 ring-2 ring-blue-500' : ''}`} 
      />
    </div>
  );
}
