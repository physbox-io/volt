import { Handle, Position } from '@xyflow/react';

export function ZenerDiodeNode({ data, selected }: any) {
  const isVertical = data.orientation === 'vertical';

  return (
    <div className={`schematic-node flex items-center justify-center relative select-none ${isVertical ? 'w-[36px] h-[48px]' : 'w-[48px] h-[36px]'}`}>
      <Handle 
        type="target" 
        position={isVertical ? Position.Top : Position.Left} 
        id="anode" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isVertical ? { left: '50%', top: '0%' } : { top: '50%', left: '0%' }}
      />
      <Handle 
        type="source" 
        position={isVertical ? Position.Top : Position.Left} 
        id="anode" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isVertical ? { left: '50%', top: '0%' } : { top: '50%', left: '0%' }}
      />
      
      <svg 
        width={isVertical ? 36 : 48} 
        height={isVertical ? 48 : 36} 
        viewBox={isVertical ? "0 0 48 64" : "0 0 64 48"} 
        fill="none" 
        stroke={selected ? '#3b82f6' : 'currentColor'} 
        strokeWidth="1.5" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        style={{ overflow: 'visible' }}
        className={`text-slate-855 dark:text-slate-145 transition-colors ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.8)]' : ''}`}
      >
        {isVertical ? (
          <>
            {/* Top lead */}
            <path d="M 24 -4 V 24" />
            {/* Triangle (Anode) */}
            <path d="M 14 24 H 34 L 24 36 Z" fill="currentColor" />
            {/* Zener Cathode bar */}
            <path d="M 14 36 H 34" strokeWidth="2.2" />
            <path d="M 14 36 V 32" strokeWidth="2.2" />
            <path d="M 34 36 V 40" strokeWidth="2.2" />
            {/* Bottom lead */}
            <path d="M 24 36 V 68" />
          </>
        ) : (
          <>
            {/* Left lead */}
            <path d="M -4 24 H 24" />
            {/* Triangle (Anode) */}
            <path d="M 24 14 L 36 24 L 24 34 Z" fill="currentColor" />
            {/* Zener Cathode bar */}
            <path d="M 36 14 V 34" strokeWidth="2.2" />
            <path d="M 36 14 H 40" strokeWidth="2.2" />
            <path d="M 32 34 H 36" strokeWidth="2.2" />
            {/* Right lead */}
            <path d="M 36 24 H 68" />
          </>
        )}
      </svg>

      <div className={isVertical
        ? "absolute left-[30px] top-[22px] text-[10px] font-bold font-mono text-slate-700 dark:text-slate-350 pointer-events-none whitespace-nowrap"
        : "absolute -bottom-4 text-[10px] font-bold font-mono text-slate-700 dark:text-slate-350 text-center w-full pointer-events-none"
      }>
        {data.label || '5.1V'}
      </div>
      
      <Handle 
        type="source" 
        position={isVertical ? Position.Bottom : Position.Right} 
        id="cathode" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isVertical ? { left: '50%', top: '100%' } : { top: '50%', left: '100%' }}
      />
      <Handle 
        type="target" 
        position={isVertical ? Position.Bottom : Position.Right} 
        id="cathode" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isVertical ? { left: '50%', top: '100%' } : { top: '50%', left: '100%' }}
      />
    </div>
  );
}


