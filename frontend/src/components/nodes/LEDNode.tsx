import { Handle, Position } from '@xyflow/react';
import { useEffect, useRef } from 'react';

export function LEDNode({ data, selected }: any) {
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
      
      animationFrame = requestAnimationFrame(animate);
    };
    
    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [data.current_array, data.time_points, isExploded, max_current, color, isSimulating]);

  // static fallback
  const staticBrightness = typeof data.brightness === 'number' ? data.brightness : 0;
  const glowShadow = staticBrightness > 0 && !isExploded ? `0 0 ${10 + staticBrightness * 20}px ${color}` : 'none';
  const opacity = isExploded ? 0 : 0.3 + (staticBrightness * 0.7);

    return (
    <div className={`schematic-node flex items-center justify-center relative select-none w-[48px] h-[48px]`}>
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
          className="absolute w-8 h-8 rounded-full pointer-events-none transition-all duration-75"
          style={{ 
            backgroundColor: color, 
            boxShadow: glowShadow, 
            opacity: opacity * 0.4, 
            filter: 'blur(6px)',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 0
          }}
        />
      )}

      {isExploded ? (
        <div className="w-8 h-8 relative flex items-center justify-center z-10">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-855 dark:text-slate-145">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            <line x1="4" y1="4" x2="20" y2="20" stroke="red" strokeWidth="2.2" />
            <line x1="20" y1="4" x2="4" y2="20" stroke="red" strokeWidth="2.2" />
          </svg>
        </div>
      ) : (
        <svg 
          width="48" 
          height="48" 
          viewBox="0 0 64 64" 
          fill="none" 
          stroke={selected ? '#3b82f6' : 'currentColor'} 
          strokeWidth="1.5" 
          strokeLinecap="round" 
          strokeLinejoin="round"
          style={{ overflow: 'visible' }}
          className={`text-slate-855 dark:text-slate-145 transition-colors z-10 ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.8)]' : ''}`}
        >
          {isHorizontal ? (
            <>
              {/* Left lead */}
              <path d="M -4 32 H 22" />
              {/* Triangle pointing right */}
              <path d="M 22 22 V 42 L 42 32 Z" fill="currentColor" />
              {/* Cathode bar */}
              <path d="M 42 22 V 42" strokeWidth="2.2" />
              {/* Right lead */}
              <path d="M 42 32 H 68" />
              {/* Arrows pointing up-right */}
              <path d="M 34 24 L 42 16" strokeWidth="1.2" />
              <path d="M 38 16 H 42 V 20" strokeWidth="1.2" />
              <path d="M 40 30 L 48 22" strokeWidth="1.2" />
              <path d="M 44 22 H 48 V 26" strokeWidth="1.2" />
            </>
          ) : (
            <>
              {/* Top lead */}
              <path d="M 32 -4 V 22" />
              {/* Triangle pointing down */}
              <path d="M 22 22 H 42 L 32 42 Z" fill="currentColor" />
              {/* Cathode bar */}
              <path d="M 22 42 H 42" strokeWidth="2.2" />
              {/* Bottom lead */}
              <path d="M 32 42 V 68" />
              {/* Arrows pointing up-right */}
              <path d="M 38 28 L 46 20" strokeWidth="1.2" />
              <path d="M 42 20 H 46 V 24" strokeWidth="1.2" />
              <path d="M 42 34 L 50 26" strokeWidth="1.2" />
              <path d="M 46 26 H 50 V 30" strokeWidth="1.2" />
            </>
          )}
        </svg>
      )}
      
      <div className="absolute left-1 top-2 text-[9px] font-bold font-mono text-slate-500 dark:text-slate-400 pointer-events-none">
        {data.label || 'LED'}
      </div>
      <div ref={textRef} className="absolute right-1 top-2 text-[9px] font-bold font-mono text-slate-600 dark:text-slate-400 pointer-events-none"></div>

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
}
