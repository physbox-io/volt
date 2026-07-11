import { Handle, Position } from '@xyflow/react';
import { useEffect, useRef, memo } from 'react';
import { playbackTicker } from '../../utils/playbackTicker';

export const LEDNode = memo(function LEDNode({ data, selected }: any) {
  const isHorizontal = data.orientation === 'horizontal';
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
      let idx = 0;
      for (let i = 0; i < data.time_points.length; i++) {
        if (data.time_points[i] >= elapsedMs) {
          idx = i;
          break;
        }
      }
      
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
        position={isHorizontal ? Position.Left : Position.Top} 
        id="anode" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isHorizontal ? { top: '50%', left: '0%' } : { left: '50%', top: '0%' }}
      />
      <Handle 
        type="source" 
        position={isHorizontal ? Position.Left : Position.Top} 
        id="anode" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isHorizontal ? { top: '50%', left: '0%' } : { left: '50%', top: '0%' }}
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
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-855 dark:text-slate-145">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            <line x1="4" y1="4" x2="20" y2="20" stroke="red" strokeWidth="2.0" />
            <line x1="20" y1="4" x2="4" y2="20" stroke="red" strokeWidth="2.0" />
          </svg>
        </div>
      ) : (
        <svg 
          width="32" 
          height="32" 
          viewBox="0 0 32 32" 
          fill="none" 
          stroke={selected ? '#3b82f6' : 'currentColor'} 
          strokeWidth="1.2" 
          strokeLinecap="round" 
          strokeLinejoin="round"
          style={{ overflow: 'visible' }}
          className={`text-slate-855 dark:text-slate-145 transition-colors z-10 ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.8)]' : ''}`}
        >
          {isHorizontal ? (
            <>
              {/* Left lead */}
              <path d="M -4 16 H 10" />
              {/* Triangle pointing right */}
              <path d="M 10 8 V 24 L 22 16 Z" fill="currentColor" />
              {/* Cathode bar */}
              <path d="M 22 8 V 24" strokeWidth="2.0" />
              {/* Right lead */}
              <path d="M 22 16 H 36" />
              {/* Arrows pointing up-right */}
              <path d="M 16 10 L 22 4" strokeWidth="1" />
              <path d="M 19 4 H 22 V 7" strokeWidth="1" />
              <path d="M 20 14 L 26 8" strokeWidth="1" />
              <path d="M 23 8 H 26 V 11" strokeWidth="1" />
            </>
          ) : (
            <>
              {/* Top lead */}
              <path d="M 16 -4 V 10" />
              {/* Triangle pointing down */}
              <path d="M 8 10 H 24 L 16 22 Z" fill="currentColor" />
              {/* Cathode bar */}
              <path d="M 8 22 H 24" strokeWidth="2.0" />
              {/* Bottom lead */}
              <path d="M 16 22 V 36" />
              {/* Arrows pointing up-right */}
              <path d="M 24 14 L 30 8" strokeWidth="1" />
              <path d="M 27 8 H 30 V 11" strokeWidth="1" />
              <path d="M 26 18 L 32 12" strokeWidth="1" />
              <path d="M 29 12 H 32 V 15" strokeWidth="1" />
            </>
          )}
        </svg>
      )}
      
      <div className={isHorizontal
        ? "absolute -bottom-3.5 left-1/2 -translate-x-1/2 text-[8px] font-bold font-mono text-slate-600 dark:text-slate-400 text-center pointer-events-none whitespace-nowrap"
        : "absolute right-[24px] top-[6px] text-[8px] font-bold font-mono text-slate-600 dark:text-slate-400 text-right pointer-events-none whitespace-nowrap"
      }>
        {data.label || 'LED'}
      </div>
      <div ref={textRef} className={isHorizontal
        ? "absolute -bottom-3.5 right-0 text-[8px] font-bold font-mono text-slate-600 dark:text-slate-400 pointer-events-none"
        : "absolute right-[24px] bottom-[6px] text-[8px] font-bold font-mono text-slate-600 dark:text-slate-400 text-right pointer-events-none whitespace-nowrap"
      }></div>
 
      <Handle 
        type="source" 
        position={isHorizontal ? Position.Right : Position.Bottom} 
        id="cathode" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isHorizontal ? { top: '50%', left: '100%' } : { left: '50%', top: '100%' }}
      />
      <Handle 
        type="target" 
        position={isHorizontal ? Position.Right : Position.Bottom} 
        id="cathode" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isHorizontal ? { top: '50%', left: '100%' } : { left: '50%', top: '100%' }}
      />
    </div>
  );
});
