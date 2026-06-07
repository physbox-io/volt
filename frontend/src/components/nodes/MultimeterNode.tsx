import { Handle, Position } from '@xyflow/react';
import { useEffect, useRef } from 'react';

export function MultimeterNode({ data }: any) {
  const isSimulating = !!data.isSimulating;
  const displayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isSimulating || !data.voltage_array || !data.time_points) {
      if (displayRef.current) {
        const fallback = data.voltage !== undefined ? data.voltage.toFixed(3) : '0.000';
        displayRef.current.innerText = fallback + ' V';
      }
      return;
    }

    let animationFrame: number;
    let startTime = Date.now();
    const duration = data.time_points[data.time_points.length - 1] || 1000;

    const animate = () => {
      let elapsedMs = Date.now() - startTime;
      if (elapsedMs > duration) {
        startTime = Date.now();
        elapsedMs = 0;
      }

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

      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [data.voltage, data.voltage_array, data.time_points, isSimulating]);

  const fallbackVoltage = data.voltage !== undefined ? data.voltage.toFixed(3) : '0.000';

  return (
    <div className="bg-gray-800 border-2 border-gray-900 rounded-md p-3 w-32 flex flex-col items-center justify-center relative shadow-lg">
      <div 
        ref={displayRef}
        className="bg-green-900 w-full h-10 rounded text-green-400 font-mono text-lg flex items-center justify-end px-2 mb-2 shadow-inner"
      >
        {fallbackVoltage} V
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
}
