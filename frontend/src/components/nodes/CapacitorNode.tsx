import { Handle, Position } from '@xyflow/react';

export function CapacitorNode({ data, selected }: any) {
  const isVertical = data.orientation === 'vertical';

  return (
    <div className={`schematic-node flex items-center justify-center relative select-none ${isVertical ? 'w-[24px] h-[48px]' : 'w-[48px] h-[24px]'}`}>
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
        width={isVertical ? 24 : 48} 
        height={isVertical ? 48 : 24} 
        viewBox={isVertical ? "0 0 24 48" : "0 0 48 24"} 
        fill="none" 
        stroke={selected ? '#3b82f6' : 'currentColor'} 
        strokeWidth="1.2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        style={{ overflow: 'visible' }}
        className={`text-slate-855 dark:text-slate-145 transition-colors ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.8)]' : ''}`}
      >
        {isVertical ? (
          <>
            {/* Top lead and plate */}
            <path d="M 12 -4 V 22" />
            <path d="M 4 22 H 20" strokeWidth="2.0" />
            {/* Bottom plate and lead */}
            <path d="M 4 26 H 20" strokeWidth="2.0" />
            <path d="M 12 26 V 52" />
          </>
        ) : (
          <>
            {/* Left lead and plate */}
            <path d="M -4 12 H 22" />
            <path d="M 22 4 V 20" strokeWidth="2.0" />
            {/* Right plate and lead */}
            <path d="M 26 4 V 20" strokeWidth="2.0" />
            <path d="M 26 12 H 52" />
          </>
        )}
      </svg>

      <div className={isVertical
        ? "absolute left-[20px] top-1/2 -translate-y-1/2 text-[8px] font-bold font-mono text-slate-600 dark:text-slate-400 pointer-events-none whitespace-nowrap"
        : "absolute -bottom-3.5 left-1/2 -translate-x-1/2 text-[8px] font-bold font-mono text-slate-600 dark:text-slate-400 text-center pointer-events-none whitespace-nowrap"
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


