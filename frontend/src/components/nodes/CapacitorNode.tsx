import { Handle, Position } from '@xyflow/react';

export function CapacitorNode({ data, selected }: any) {
  const isVertical = data.orientation === 'vertical';

  return (
    <div className={`schematic-node flex items-center justify-center relative select-none ${isVertical ? 'w-[36px] h-[48px]' : 'w-[48px] h-[36px]'}`}>
      <Handle 
        type="target" 
        position={isVertical ? Position.Top : Position.Left} 
        id="in" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isVertical ? { left: '50%', top: '0%' } : { top: '50%', left: '0%' }}
      />
      <Handle 
        type="source" 
        position={isVertical ? Position.Top : Position.Left} 
        id="in" 
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
        className={`text-slate-850 dark:text-slate-150 transition-colors ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.8)]' : ''}`}
      >
        {isVertical ? (
          <>
            {/* Top lead and plate */}
            <path d="M 24 -4 V 29" />
            <path d="M 12 29 H 36" strokeWidth="2.2" />
            {/* Bottom plate and lead */}
            <path d="M 12 35 H 36" strokeWidth="2.2" />
            <path d="M 24 35 V 68" />
          </>
        ) : (
          <>
            {/* Left lead and plate */}
            <path d="M -4 24 H 29" />
            <path d="M 29 12 V 36" strokeWidth="2.2" />
            {/* Right plate and lead */}
            <path d="M 35 12 V 36" strokeWidth="2.2" />
            <path d="M 35 24 H 68" />
          </>
        )}
      </svg>

      <div className={isVertical
        ? "absolute left-[30px] top-[22px] text-[10px] font-bold font-mono text-slate-700 dark:text-slate-350 pointer-events-none whitespace-nowrap"
        : "absolute -bottom-4 text-[10px] font-bold font-mono text-slate-700 dark:text-slate-350 text-center w-full pointer-events-none"
      }>
        {data.label || '10uF'}
      </div>
      
      <Handle 
        type="source" 
        position={isVertical ? Position.Bottom : Position.Right} 
        id="out" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isVertical ? { left: '50%', top: '100%' } : { top: '50%', left: '100%' }}
      />
      <Handle 
        type="target" 
        position={isVertical ? Position.Bottom : Position.Right} 
        id="out" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isVertical ? { left: '50%', top: '100%' } : { top: '50%', left: '100%' }}
      />
    </div>
  );
}


