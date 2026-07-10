import { Handle, Position } from '@xyflow/react';

export function GroundNode() {
  return (
    <div className="schematic-node flex flex-col items-center justify-start relative w-[32px] h-[32px]">
      <Handle type="target" position={Position.Top} id="in" className="w-3 h-3 bg-green-500" />
      <Handle type="source" position={Position.Top} id="in" className="w-3 h-3 bg-green-500" />
      
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-700">
        <path d="M12 0v12" />
        <path d="M4 12h16" />
        <path d="M7 16h10" />
        <path d="M10 20h4" />
      </svg>
    </div>
  );
}
