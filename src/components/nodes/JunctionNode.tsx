import { Handle, Position } from '@xyflow/react';

export function JunctionNode({ selected }: any) {
  return (
    <div className="w-[1px] h-[1px] flex items-center justify-center relative select-none">
      <style>{`
        .junction-handle {
          width: 0px !important;
          height: 0px !important;
          min-width: 0px !important;
          min-height: 0px !important;
          border: 0px !important;
          background: transparent !important;
        }
        .junction-handle::after {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 16px;
          height: 16px;
          background: transparent;
          cursor: crosshair;
        }
      `}</style>
      {/* Target handle for incoming wires */}
      <Handle 
        type="target" 
        position={Position.Left} 
        id="in" 
        style={{ width: 0, height: 0, minWidth: 0, minHeight: 0, border: 0, background: 'transparent' }}
        className="junction-handle -translate-x-1/2 -translate-y-1/2 !left-1/2 !top-1/2" 
      />
      {/* Source handle for outgoing wires */}
      <Handle 
        type="source" 
        position={Position.Left} 
        id="out" 
        style={{ width: 0, height: 0, minWidth: 0, minHeight: 0, border: 0, background: 'transparent' }}
        className="junction-handle -translate-x-1/2 -translate-y-1/2 !left-1/2 !top-1/2" 
      />
      
      {/* Junction dot visualization */}
      <div 
        className={`w-2 h-2 rounded-full bg-slate-700 dark:bg-slate-300 pointer-events-none transition-transform -translate-x-1/2 -translate-y-1/2 absolute left-1/2 top-1/2 ${selected ? 'scale-125 ring-2 ring-blue-500' : ''}`} 
      />
    </div>
  );
}
