import { Handle, Position } from '@xyflow/react';

export function Timer555Node() {
  return (
    <div className="bg-gray-800 border-2 border-gray-900 rounded-md p-2 w-32 flex flex-col relative shadow-md">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-4 bg-gray-900 rounded-b-full"></div>
      <div className="text-white text-center font-bold text-xs mb-2 mt-2">NE555</div>
      
      <div className="flex justify-between w-full mt-2">
        <div className="flex flex-col gap-4">
          <div className="flex items-center relative">
            <Handle type="target" position={Position.Left} id="1" className="w-3 h-3 bg-gray-400 !-left-2" />
            <Handle type="source" position={Position.Left} id="1" className="w-3 h-3 bg-gray-400 !-left-2" />
            <span className="text-gray-300 text-[8px] ml-1">1 GND</span>
          </div>
          <div className="flex items-center relative">
            <Handle type="target" position={Position.Left} id="2" className="w-3 h-3 bg-gray-400 !-left-2" />
            <Handle type="source" position={Position.Left} id="2" className="w-3 h-3 bg-gray-400 !-left-2" />
            <span className="text-gray-300 text-[8px] ml-1">2 TRIG</span>
          </div>
          <div className="flex items-center relative">
            <Handle type="target" position={Position.Left} id="3" className="w-3 h-3 bg-gray-400 !-left-2" />
            <Handle type="source" position={Position.Left} id="3" className="w-3 h-3 bg-gray-400 !-left-2" />
            <span className="text-gray-300 text-[8px] ml-1">3 OUT</span>
          </div>
          <div className="flex items-center relative">
            <Handle type="target" position={Position.Left} id="4" className="w-3 h-3 bg-gray-400 !-left-2" />
            <Handle type="source" position={Position.Left} id="4" className="w-3 h-3 bg-gray-400 !-left-2" />
            <span className="text-gray-300 text-[8px] ml-1">4 RST</span>
          </div>
        </div>

        <div className="flex flex-col gap-4 items-end">
          <div className="flex items-center justify-end relative">
            <span className="text-gray-300 text-[8px] mr-1">VCC 8</span>
            <Handle type="target" position={Position.Right} id="8" className="w-3 h-3 bg-gray-400 !-right-2" />
            <Handle type="source" position={Position.Right} id="8" className="w-3 h-3 bg-gray-400 !-right-2" />
          </div>
          <div className="flex items-center justify-end relative">
            <span className="text-gray-300 text-[8px] mr-1">DIS 7</span>
            <Handle type="target" position={Position.Right} id="7" className="w-3 h-3 bg-gray-400 !-right-2" />
            <Handle type="source" position={Position.Right} id="7" className="w-3 h-3 bg-gray-400 !-right-2" />
          </div>
          <div className="flex items-center justify-end relative">
            <span className="text-gray-300 text-[8px] mr-1">THR 6</span>
            <Handle type="target" position={Position.Right} id="6" className="w-3 h-3 bg-gray-400 !-right-2" />
            <Handle type="source" position={Position.Right} id="6" className="w-3 h-3 bg-gray-400 !-right-2" />
          </div>
          <div className="flex items-center justify-end relative">
            <span className="text-gray-300 text-[8px] mr-1">CTRL 5</span>
            <Handle type="target" position={Position.Right} id="5" className="w-3 h-3 bg-gray-400 !-right-2" />
            <Handle type="source" position={Position.Right} id="5" className="w-3 h-3 bg-gray-400 !-right-2" />
          </div>
        </div>
      </div>
    </div>
  );
}
