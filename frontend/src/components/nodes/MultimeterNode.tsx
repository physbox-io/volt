import { Handle, Position, useReactFlow } from '@xyflow/react';
import { useEffect, useRef, memo } from 'react';
import { playbackTicker } from '../../utils/playbackTicker';

function calculateRms(arr: number[]): number {
  if (!arr || arr.length === 0) return 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < arr.length; i++) {
    const val = arr[i];
    if (typeof val === 'number' && !isNaN(val)) {
      sum += val * val;
      count++;
    }
  }
  return count > 0 ? Math.sqrt(sum / count) : 0;
}

export const MultimeterNode = memo(function MultimeterNode({ id, data }: any) {
  const isSimulating = !!data.isSimulating;
  const displayRef = useRef<HTMLDivElement>(null);
  const { setNodes } = useReactFlow();

  useEffect(() => {
    if (!isSimulating || !data.voltage_array || !data.time_points) {
      if (displayRef.current) {
        let fallback = '0.000';
        if (data.voltage !== undefined) {
          if (data.isRms && data.voltage_array) {
            fallback = calculateRms(data.voltage_array).toFixed(3);
          } else {
            fallback = data.voltage.toFixed(3);
          }
        }
        displayRef.current.innerText = fallback + ' V';
      }
      return;
    }

    if (data.isRms) {
      if (displayRef.current) {
        const rmsVal = calculateRms(data.voltage_array);
        displayRef.current.innerText = rmsVal.toFixed(3) + ' V';
      }
      return;
    }

    const unsubscribe = playbackTicker.subscribe((elapsedMs) => {
      let idx = 0;
      for (let i = 0; i < data.time_points.length; i++) {
        if (data.time_points[i] >= elapsedMs) {
          idx = i;
          break;
        }
      }

      const val = data.voltage_array[idx] ?? 0;
      if (displayRef.current) {
        displayRef.current.innerText = val.toFixed(3) + ' V';
      }
    });

    return unsubscribe;
  }, [data.voltage, data.voltage_array, data.time_points, isSimulating, data.isRms]);

  const rmsVal = data.voltage_array ? calculateRms(data.voltage_array) : 0;
  const fallbackVoltage = data.voltage !== undefined
    ? (data.isRms && data.voltage_array ? rmsVal.toFixed(3) : data.voltage.toFixed(3))
    : '0.000';

  return (
    <div className="bg-gray-800 border-2 border-gray-900 rounded-md p-3 w-36 flex flex-col items-center justify-center relative shadow-lg">
      <div 
        className="bg-green-900 w-full h-10 rounded text-green-400 font-mono text-lg flex items-center justify-between px-2 mb-1.5 shadow-inner relative"
      >
        <span className="text-[8px] absolute left-1 top-0.5 opacity-60 font-sans tracking-wide">
          {data.isRms ? 'RMS' : 'DC'}
        </span>
        <span ref={displayRef} className="ml-auto">
          {fallbackVoltage} V
        </span>
      </div>

      {/* RMS Switch Toggle */}
      <div className="flex items-center gap-1.5 mb-2 nodrag">
        <label className="relative inline-flex items-center cursor-pointer select-none">
          <input 
            type="checkbox" 
            checked={!!data.isRms} 
            onChange={(e) => {
              setNodes(nds => nds.map(n => 
                n.id === id ? { ...n, data: { ...n.data, isRms: e.target.checked } } : n
              ));
            }}
            className="sr-only peer"
          />
          <div className="w-7 h-4 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-500"></div>
          <span className="ml-1.5 text-[10px] font-bold text-gray-300 tracking-wider">RMS</span>
        </label>
      </div>

      <div className="flex w-full justify-between px-4">
        <div className="text-red-500 font-bold text-xs">+</div>
        <div className="text-gray-400 font-bold text-xs">-</div>
      </div>
      <Handle type="target" position={Position.Bottom} id="pos" className="w-3 h-3 bg-red-500" style={{ left: '30%' }} />
      <Handle type="source" position={Position.Bottom} id="pos" className="w-3 h-3 bg-red-500" style={{ left: '30%' }} />
      <Handle type="target" position={Position.Bottom} id="neg" className="w-3 h-3 bg-black" style={{ left: '70%' }} />
      <Handle type="source" position={Position.Bottom} id="neg" className="w-3 h-3 bg-black" style={{ left: '70%' }} />
    </div>
  );
});

