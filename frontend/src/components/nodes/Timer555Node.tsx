import { Handle, Position } from '@xyflow/react';
import { DEVICE_CARD_DARK } from './schematic';

export function Timer555Node() {
  return (
    <div className={`${DEVICE_CARD_DARK} px-2 pt-[3px] pb-2 w-24 flex flex-col relative`}>
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-1.5 bg-slate-900 rounded-b-full"></div>
      {/* Header is PIN_ROW_TOP tall (see nodeGeometry.getHandleCoord). */}
      <div className="h-5 flex items-end justify-center text-slate-100 font-semibold font-mono text-[9px] tracking-wide leading-none pb-1">NE555</div>
      
      <div className="flex justify-between w-full">
        <div className="flex flex-col">
          <div className="flex items-center h-4 relative">
            <Handle type="target" position={Position.Left} id="1" className="w-3 h-3 bg-gray-400 !-left-2" />
            <Handle type="source" position={Position.Left} id="1" className="w-3 h-3 bg-gray-400 !-left-2" />
            <span className="text-slate-300 font-mono text-[8px] ml-1">1 GND</span>
          </div>
          <div className="flex items-center h-4 relative">
            <Handle type="target" position={Position.Left} id="2" className="w-3 h-3 bg-gray-400 !-left-2" />
            <Handle type="source" position={Position.Left} id="2" className="w-3 h-3 bg-gray-400 !-left-2" />
            <span className="text-slate-300 font-mono text-[8px] ml-1">2 TRIG</span>
          </div>
          <div className="flex items-center h-4 relative">
            <Handle type="target" position={Position.Left} id="3" className="w-3 h-3 bg-gray-400 !-left-2" />
            <Handle type="source" position={Position.Left} id="3" className="w-3 h-3 bg-gray-400 !-left-2" />
            <span className="text-slate-300 font-mono text-[8px] ml-1">3 OUT</span>
          </div>
          <div className="flex items-center h-4 relative">
            <Handle type="target" position={Position.Left} id="4" className="w-3 h-3 bg-gray-400 !-left-2" />
            <Handle type="source" position={Position.Left} id="4" className="w-3 h-3 bg-gray-400 !-left-2" />
            <span className="text-slate-300 font-mono text-[8px] ml-1">4 RST</span>
          </div>
        </div>

        <div className="flex flex-col items-end">
          <div className="flex items-center justify-end h-4 relative">
            <span className="text-slate-300 font-mono text-[8px] mr-1">VCC 8</span>
            <Handle type="target" position={Position.Right} id="8" className="w-3 h-3 bg-gray-400 !-right-2" />
            <Handle type="source" position={Position.Right} id="8" className="w-3 h-3 bg-gray-400 !-right-2" />
          </div>
          <div className="flex items-center justify-end h-4 relative">
            <span className="text-slate-300 font-mono text-[8px] mr-1">DIS 7</span>
            <Handle type="target" position={Position.Right} id="7" className="w-3 h-3 bg-gray-400 !-right-2" />
            <Handle type="source" position={Position.Right} id="7" className="w-3 h-3 bg-gray-400 !-right-2" />
          </div>
          <div className="flex items-center justify-end h-4 relative">
            <span className="text-slate-300 font-mono text-[8px] mr-1">THR 6</span>
            <Handle type="target" position={Position.Right} id="6" className="w-3 h-3 bg-gray-400 !-right-2" />
            <Handle type="source" position={Position.Right} id="6" className="w-3 h-3 bg-gray-400 !-right-2" />
          </div>
          <div className="flex items-center justify-end h-4 relative">
            <span className="text-slate-300 font-mono text-[8px] mr-1">CTRL 5</span>
            <Handle type="target" position={Position.Right} id="5" className="w-3 h-3 bg-gray-400 !-right-2" />
            <Handle type="source" position={Position.Right} id="5" className="w-3 h-3 bg-gray-400 !-right-2" />
          </div>
        </div>
      </div>
    </div>
  );
}
