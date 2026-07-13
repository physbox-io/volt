import { Handle, Position, useReactFlow } from '@xyflow/react';
import { useEffect, useRef, memo } from 'react';
import { playbackTicker, findIndexForTime } from '../../utils/playbackTicker';

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

function formatReading(val: number, mode?: 'voltage' | 'current'): string {
  if (mode === 'current') {
    const absVal = Math.abs(val);
    if (absVal === 0) return '0.000 A';
    if (absVal < 1e-6) {
      return (val * 1e9).toFixed(3) + ' nA';
    } else if (absVal < 1e-3) {
      return (val * 1e6).toFixed(3) + ' µA';
    } else if (absVal < 1) {
      return (val * 1e3).toFixed(3) + ' mA';
    } else {
      return val.toFixed(3) + ' A';
    }
  } else {
    return val.toFixed(3) + ' V';
  }
}

export const MultimeterNode = memo(function MultimeterNode({ id, data }: any) {
  const isSimulating = !!data.isSimulating;
  const displayRef = useRef<HTMLDivElement>(null);
  const { setNodes } = useReactFlow();

  useEffect(() => {
    if (!isSimulating || !data.voltage_array || !data.time_points) {
      if (displayRef.current) {
        let fallback = 0;
        if (data.voltage !== undefined) {
          if (data.isRms && data.voltage_array) {
            fallback = calculateRms(data.voltage_array);
          } else {
            fallback = data.voltage;
          }
        }
        displayRef.current.innerText = formatReading(fallback, data.mode);
      }
      return;
    }

    if (data.isRms) {
      if (displayRef.current) {
        const rmsVal = calculateRms(data.voltage_array);
        displayRef.current.innerText = formatReading(rmsVal, data.mode);
      }
      return;
    }

    const unsubscribe = playbackTicker.subscribe((elapsedMs) => {
      const idx = findIndexForTime(data.time_points, elapsedMs);

      const val = data.voltage_array[idx] ?? 0;
      if (displayRef.current) {
        displayRef.current.innerText = formatReading(val, data.mode);
      }
    });

    return unsubscribe;
  }, [data.voltage, data.voltage_array, data.time_points, isSimulating, data.isRms, data.mode]);

  const rmsVal = data.voltage_array ? calculateRms(data.voltage_array) : 0;
  const fallbackVoltage = data.voltage !== undefined
    ? (data.isRms && data.voltage_array ? rmsVal : data.voltage)
    : 0;
  const displayText = data.voltage !== undefined
    ? formatReading(fallbackVoltage, data.mode)
    : (data.mode === 'current' ? '0.000 A' : '0.000 V');

  return (
    <div className="bg-gray-800 border-2 border-gray-900 rounded-md p-2 w-32 flex flex-col items-center justify-center relative shadow-lg">
      {data.label && (
        <div className="text-[9px] font-bold text-gray-300 mb-1 truncate max-w-[110px] tracking-wider uppercase">
          {data.label}
        </div>
      )}
      <div 
        className="bg-green-900 w-full h-8 rounded text-green-400 font-mono text-xs flex items-center justify-between px-2 mb-1 shadow-inner relative"
      >
        <span className="text-[7px] absolute left-1 top-0.5 opacity-60 font-sans tracking-wide">
          {data.isRms ? 'RMS' : (data.mode === 'current' ? 'DC I' : 'DC V')}
        </span>
        <span ref={displayRef} className="ml-auto text-xs truncate">
          {displayText}
        </span>
      </div>

      {/* Switches Panel - Horizontal Layout */}
      <div className="flex items-center justify-between w-full px-0.5 mb-1 nodrag">
        {/* RMS Switch Toggle */}
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
          <div className="w-5 h-3 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[1px] after:left-[1px] after:bg-gray-300 after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-blue-500"></div>
          <span className="ml-1 text-[8px] font-bold text-gray-300 tracking-wider">RMS</span>
        </label>

        {/* Mode Switch Toggle (Volts/Amps) */}
        <label className="relative inline-flex items-center cursor-pointer select-none">
          <input 
            type="checkbox" 
            checked={data.mode === 'current'} 
            onChange={(e) => {
              setNodes(nds => nds.map(n => 
                n.id === id ? { ...n, data: { ...n.data, mode: e.target.checked ? 'current' : 'voltage' } } : n
              ));
            }}
            className="sr-only peer"
          />
          <div className="w-5 h-3 bg-gray-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[1px] after:left-[1px] after:bg-gray-300 after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-blue-500"></div>
          <span className="ml-1 text-[8px] font-bold text-gray-300 tracking-wider">AMPS</span>
        </label>
      </div>

      <div className="flex w-full justify-between px-3 mt-0.5">
        <div className="text-red-500 font-bold text-[10px]">+</div>
        <div className="text-gray-400 font-bold text-[10px]">-</div>
      </div>
      <Handle type="target" position={Position.Bottom} id="pos" className="w-2.5 h-2.5 bg-red-500" style={{ left: '30%' }} />
      <Handle type="source" position={Position.Bottom} id="pos" className="w-2.5 h-2.5 bg-red-500" style={{ left: '30%' }} />
      <Handle type="target" position={Position.Bottom} id="neg" className="w-2.5 h-2.5 bg-black" style={{ left: '70%' }} />
      <Handle type="source" position={Position.Bottom} id="neg" className="w-2.5 h-2.5 bg-black" style={{ left: '70%' }} />
    </div>
  );
});

