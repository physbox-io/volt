import { Handle, Position } from '@xyflow/react';
import { useEffect, useState, memo } from 'react';
import { playbackTicker, findIndexForTime } from '../../utils/playbackTicker';
import type { NodePropertiesProps } from './registry';
import { DEVICE_CARD_DARK, pinRow } from './schematic';

export function SevenSegmentProperties(_props: NodePropertiesProps) {
  return (
    <div className="mb-3">
      <div className="text-xs text-gray-500 mb-1">Segments: a(top) b(TR) c(BR) d(bot) e(BL) f(TL) g(mid)</div>
      <div className="text-xs text-gray-500">Connect 5V through resistors to segment inputs. Common cathode → GND.</div>
    </div>
  );
}

const SEGMENT_PATHS: Record<string, string> = {
  a: 'M6,2 L18,2 L16,4 L8,4 Z',
  b: 'M19,3 L19,11 L17,9 L17,5 Z',
  c: 'M19,13 L19,21 L17,19 L17,15 Z',
  d: 'M6,22 L18,22 L16,20 L8,20 Z',
  e: 'M5,13 L5,21 L7,19 L7,15 Z',
  f: 'M5,3 L5,11 L7,9 L7,5 Z',
  g: 'M6,12 L18,12 L16,14 L8,14 Z',
};

const SEG_COLORS: Record<string, string> = {
  a: 'bg-red-400', b: 'bg-orange-400', c: 'bg-yellow-400',
  d: 'bg-green-400', e: 'bg-teal-400', f: 'bg-emerald-400', g: 'bg-purple-400',
};

export const SevenSegmentNode = memo(function SevenSegmentNode({ data }: any) {
  const segs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const [currentVoltages, setCurrentVoltages] = useState<Record<string, number>>(data.segmentVoltages || {});
  const isSimulating = !!data.isSimulating;

  useEffect(() => {
    if (!isSimulating || !data.segmentVoltageArrays || !data.timePoints || data.timePoints.length === 0) {
      setCurrentVoltages(data.segmentVoltages || {});
      return;
    }

    const unsubscribe = playbackTicker.subscribe((elapsedMs) => {
      const idx = findIndexForTime(data.timePoints, elapsedMs);

      const nextVoltages: Record<string, number> = {};
      segs.forEach(s => {
        nextVoltages[s] = data.segmentVoltageArrays[s]?.[idx] || 0;
      });
      setCurrentVoltages(nextVoltages);
    });

    return unsubscribe;
  }, [data.segmentVoltageArrays, data.timePoints, data.segmentVoltages, isSimulating]);

  return (
    <div className={`${DEVICE_CARD_DARK} p-1.5 w-16 h-20 flex flex-col items-center justify-center relative`}>
      {segs.map((s, i) => (
        <span key={s}>
          <Handle type="target" position={Position.Left} id={s} className={`w-2.5 h-2.5 ${SEG_COLORS[s]}`} style={{ top: pinRow(12 + i * 12) }} />
          <Handle type="source" position={Position.Left} id={s} className={`w-2.5 h-2.5 ${SEG_COLORS[s]}`} style={{ top: pinRow(12 + i * 12) }} />
        </span>
      ))}
      <Handle type="target" position={Position.Bottom} id="common" className="w-3 h-3 bg-gray-400" />
      <Handle type="source" position={Position.Bottom} id="common" className="w-3 h-3 bg-gray-400" />

      <svg width="40" height="40" viewBox="0 0 24 24">
        {segs.map(s => {
          const on = (currentVoltages[s] ?? 0) > 2.5;
          return (
            <path key={s} d={SEGMENT_PATHS[s]}
              fill={on ? '#ef4444' : '#1f1f1f'} stroke={on ? '#fca5a5' : '#333'}
              strokeWidth="0.3" opacity={on ? 1 : 0.3}
              style={on ? { filter: 'drop-shadow(0 0 3px #ef4444)' } : undefined}
            />
          );
        })}
      </svg>
      <div className="text-[8px] text-gray-500 font-mono mt-0.5">7-SEG</div>
    </div>
  );
});
