import { Handle, Position } from '@xyflow/react';
import { useEffect, useRef, memo } from 'react';
import { playbackTicker, findIndexForTime } from '../../utils/playbackTicker';
import type { NodePropertiesProps } from './registry';
import { SchematicLabel } from './schematic';
import { NumberInput } from '../NumberInput';

export function LEDProperties({ node, updateData, webcam }: NodePropertiesProps) {
  const { stream, videoRef, isRecordingWebcam, startRecordingWebcam } = webcam;
  return (
    <>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">Color (CSS)</label>
        <input type="text" value={(node.data.color as string) || 'red'} onChange={e => updateData('color', e.target.value)} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
      </div>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">Forward Voltage Drop (V)</label>
        <NumberInput step={0.1}
          value={Number.isFinite(node.data.v_drop as number) ? (node.data.v_drop as number) : 2.0}
          onChange={v => updateData('v_drop', v)}
          className="w-full text-sm border border-gray-300 rounded px-2 py-1"
        />
      </div>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">Max Current (mA)</label>
        <NumberInput
          value={Number.isFinite(node.data.max_current as number) ? (node.data.max_current as number) : 20}
          onChange={v => updateData('max_current', v)}
          className="w-full text-sm border border-gray-300 rounded px-2 py-1"
        />
      </div>

      <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2 mb-2">
          <input
            type="checkbox"
            id="led-photo"
            checked={!!node.data.photodiodeMode}
            onChange={e => updateData('photodiodeMode', e.target.checked)}
            className="cursor-pointer"
          />
          <label htmlFor="led-photo" className="text-xs font-semibold text-gray-700 select-none cursor-pointer">
            Enable Photodiode Mode
          </label>
        </div>
        {node.data.photodiodeMode && (
          <>
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-700 mb-1">Reverse Sensitivity (μA)</label>
              <NumberInput min={0} step={1} value={node.data.lightSensitivity !== undefined ? node.data.lightSensitivity : 10} onChange={v => updateData('lightSensitivity', v)}
                      className="w-full text-sm border border-gray-300 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:border-emerald-500 focus:outline-none"
                      integer
                    />
            </div>

            <div className="mb-3 flex items-center gap-2">
              <input
                type="checkbox"
                id="led-webcam"
                checked={!!node.data.isWebcamActive}
                onChange={e => updateData('isWebcamActive', e.target.checked)}
                className="cursor-pointer"
              />
              <label htmlFor="led-webcam" className="text-xs font-semibold text-gray-700 dark:text-gray-300 select-none cursor-pointer">
                Use Webcam Sensor
              </label>
            </div>

            {stream && (
              <div className="mb-3 rounded-lg overflow-hidden border border-gray-300 dark:border-slate-800 h-28 bg-black relative flex items-center justify-center shadow-inner">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                />
                <div className="absolute bottom-1.5 right-1.5 bg-black/70 text-white text-[8px] font-mono px-1.5 py-0.5 rounded shadow-sm">
                  Live LED Light: {Math.round((node.data.lightLevel ?? 0) * 100)}%
                </div>
              </div>
            )}

            {!!node.data.isWebcamActive && (
              <div className="mb-3">
                <button
                  onClick={isRecordingWebcam ? undefined : startRecordingWebcam}
                  className={`w-full py-2 rounded-lg font-bold text-xs shadow-md transition-all text-white ${
                    isRecordingWebcam ? 'bg-red-500 animate-pulse' : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-lg'
                  }`}
                >
                  {isRecordingWebcam ? '🔴 Recording Webcam...' : '📹 Record Light Stream'}
                </button>
                {node.data.pwlData && (
                  <div className="text-[9px] text-green-600 dark:text-green-400 font-bold mt-1.5 flex items-center gap-1">
                    <span>✓</span> PWL Light Stream Loaded ({node.data.pwlData.length} pts)
                  </div>
                )}
              </div>
            )}

            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Light Exposure (0-100%)
              </label>
              <input
                type="range"
                min="0"
                max="100"
                disabled={!!node.data.isWebcamActive}
                value={Math.round((node.data.lightLevel ?? 0) * 100)}
                onChange={e => updateData('lightLevel', parseInt(e.target.value) / 100)}
                className="w-full"
              />
              <div className="text-[9px] text-gray-400 mt-1">Simulates photocurrent generated when light shines on reverse-biased LED.</div>
            </div>
          </>
        )}
      </div>

      {node.data.isExploded && (
        <button
          onClick={() => { updateData('isExploded', false); updateData('brightness', 0); }}
          className="w-full mt-2 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-1 px-2 rounded shadow-sm text-sm"
        >
          Repair Component
        </button>
      )}
    </>
  );
}

export const LEDNode = memo(function LEDNode({ data, selected }: any) {
  const orientation = data.orientation || 'horizontal';
  const isHorizontal = orientation === 'horizontal' || orientation === 'left';
  const isLeft = orientation === 'left';
  const isUp = orientation === 'up';
  const color = (data.color as string) || 'red';
  const isExploded = !!data.isExploded;
  const max_current = data.max_current || 20;
  
  const glowRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  const isSimulating = !!data.isSimulating;
  
  useEffect(() => {
    if (!isSimulating || isExploded || !data.current_array || !data.time_points) {
      if (textRef.current && !isSimulating && data.current_array) {
        // show final value when stopped
        const finalmA = data.current_array[data.current_array.length-1] * 1000;
        textRef.current.innerText = finalmA.toFixed(1) + 'mA';
      }
      return;
    }
    
    const unsubscribe = playbackTicker.subscribe((elapsedMs) => {
      const idx = findIndexForTime(data.time_points, elapsedMs);
      
      const currentmA = (data.current_array[idx] || 0) * 1000;
      let brightness = 0;
      if (currentmA > 0.5) {
        brightness = Math.min(1, currentmA / max_current);
      }
      
      if (glowRef.current) {
        glowRef.current.style.opacity = (0.3 + (brightness * 0.7)).toString();
        glowRef.current.style.boxShadow = brightness > 0 ? `0 0 ${10 + brightness * 20}px ${color}` : 'none';
      }
      if (textRef.current) {
        textRef.current.innerText = currentmA.toFixed(1) + 'mA';
      }
    });
    
    return unsubscribe;
  }, [data.current_array, data.time_points, isExploded, max_current, color, isSimulating]);

  // static fallback
  const staticBrightness = typeof data.brightness === 'number' ? data.brightness : 0;
  const glowShadow = staticBrightness > 0 && !isExploded ? `0 0 ${10 + staticBrightness * 20}px ${color}` : 'none';
  const opacity = isExploded ? 0 : 0.3 + (staticBrightness * 0.7);

  return (
    <div className={`schematic-node flex items-center justify-center relative select-none w-[32px] h-[32px]`}>
      <Handle 
        type="target" 
        position={isHorizontal ? (isLeft ? Position.Right : Position.Left) : (isUp ? Position.Bottom : Position.Top)} 
        id="anode" 
        className="w-2 h-2 bg-emerald-500 !border-0" 
        style={isHorizontal ? { top: '50%' } : { left: '50%' }}
      />
      <Handle 
        type="source" 
        position={isHorizontal ? (isLeft ? Position.Right : Position.Left) : (isUp ? Position.Bottom : Position.Top)} 
        id="anode" 
        className="w-2 h-2 bg-emerald-500 !border-0" 
        style={isHorizontal ? { top: '50%' } : { left: '50%' }}
      />
      
      {/* Glow Halo behind SVG */}
      {!isExploded && (
        <div 
          ref={glowRef}
          className="absolute w-6 h-6 rounded-full pointer-events-none transition-all duration-75"
          style={{ 
            backgroundColor: color, 
            boxShadow: glowShadow, 
            opacity: opacity * 0.4, 
            filter: 'blur(4px)',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 0
          }}
        />
      )}

      {isExploded ? (
        <div className="w-6 h-6 relative flex items-center justify-center z-10">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="text-slate-700 dark:text-slate-200">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            <line x1="4" y1="4" x2="20" y2="20" stroke="red" strokeWidth="2.4" />
            <line x1="20" y1="4" x2="4" y2="20" stroke="red" strokeWidth="2.4" />
          </svg>
        </div>
      ) : (
        <svg 
          width="32" 
          height="32" 
          viewBox="0 0 32 32" 
          fill="none" 
          stroke={selected ? '#3b82f6' : 'currentColor'} 
          strokeWidth="1.4" 
          strokeLinecap="round" 
          strokeLinejoin="round"
          style={{ overflow: 'visible', transform: isLeft ? 'scaleX(-1)' : isUp ? 'scaleY(-1)' : undefined }}
          className={`text-slate-700 dark:text-slate-200 transition-colors z-10 ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.65)]' : ''}`}
        >
          {isHorizontal ? (
            <>
              {/* Left lead */}
              <path d="M 0 16 H 10" />
              {/* Triangle pointing right */}
              <path d="M 10 8 V 24 L 22 16 Z" fill="currentColor" />
              {/* Cathode bar */}
              <path d="M 22 8 V 24" strokeWidth="2.4" />
              {/* Right lead */}
              <path d="M 22 16 H 32" />
              {/* Arrows pointing up-right */}
              <path d="M 16 10 L 22 4" strokeWidth="1" />
              <path d="M 19 4 H 22 V 7" strokeWidth="1" />
              <path d="M 20 14 L 26 8" strokeWidth="1" />
              <path d="M 23 8 H 26 V 11" strokeWidth="1" />
            </>
          ) : (
            <>
              {/* Top lead */}
              <path d="M 16 0 V 10" />
              {/* Triangle pointing down */}
              <path d="M 8 10 H 24 L 16 22 Z" fill="currentColor" />
              {/* Cathode bar */}
              <path d="M 8 22 H 24" strokeWidth="2.4" />
              {/* Bottom lead */}
              <path d="M 16 22 V 32" />
              {/* Arrows pointing up-right */}
              <path d="M 24 14 L 30 8" strokeWidth="1" />
              <path d="M 27 8 H 30 V 11" strokeWidth="1" />
              <path d="M 26 18 L 32 12" strokeWidth="1" />
              <path d="M 29 12 H 32 V 15" strokeWidth="1" />
            </>
          )}
        </svg>
      )}
      
      {/* Name and live current share one caption block. Kept out of the top-right
          quadrant, which is where the emission arrows overhang the node box. */}
      <SchematicLabel placement={isHorizontal ? 'below' : 'right'}>
        <div>{data.label || 'LED'}</div>
        <div ref={textRef} className="text-slate-400 dark:text-slate-500 empty:hidden" />
      </SchematicLabel>

      <Handle 
        type="source" 
        position={isHorizontal ? (isLeft ? Position.Left : Position.Right) : (isUp ? Position.Top : Position.Bottom)} 
        id="cathode" 
        className="w-2 h-2 bg-emerald-500 !border-0" 
        style={isHorizontal ? { top: '50%' } : { left: '50%' }}
      />
      <Handle 
        type="target" 
        position={isHorizontal ? (isLeft ? Position.Left : Position.Right) : (isUp ? Position.Top : Position.Bottom)} 
        id="cathode" 
        className="w-2 h-2 bg-emerald-500 !border-0" 
        style={isHorizontal ? { top: '50%' } : { left: '50%' }}
      />
    </div>
  );
});
