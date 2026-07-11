import { Handle, Position } from '@xyflow/react';

export function SignalGeneratorNode({ data }: any) {
  const type = data.waveform || 'sine';
  const freq = data.frequency || 1;
  const amp = data.amplitude || 5;

  return (
    <div className="bg-blue-100 border-2 border-blue-600 rounded-md p-3 w-32 h-[96px] flex flex-col items-center justify-center relative shadow-sm">
      <div className="text-xs font-bold text-blue-900 mb-1">Signal Gen</div>
      <div className="text-[10px] font-mono text-gray-700 bg-white px-2 py-1 rounded w-full mb-1 border border-gray-300">
        Type: {type}
      </div>
      <div className="text-[10px] font-mono text-gray-700 bg-white px-2 py-1 rounded w-full border border-gray-300">
        {amp}V, {freq}Hz
      </div>
      <Handle type="source" position={Position.Right} id="out" className="w-3 h-3 bg-blue-500" />
      <Handle type="target" position={Position.Right} id="out" className="w-3 h-3 bg-blue-500" />
      <Handle type="source" position={Position.Bottom} id="gnd" className="w-3 h-3 bg-black" />
      <Handle type="target" position={Position.Bottom} id="gnd" className="w-3 h-3 bg-black" />
    </div>
  );
}
