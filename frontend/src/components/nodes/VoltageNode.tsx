import { Handle, Position } from '@xyflow/react';

export function VoltageNode({ data, selected }: any) {
  const isHorizontal = data.orientation === 'horizontal';

  return (
    <div className="schematic-node w-[24px] h-[24px] flex items-center justify-center relative select-none">
      <Handle 
        type="target" 
        position={isHorizontal ? Position.Left : Position.Top} 
        id="pos" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isHorizontal ? { top: '50%', left: '0%' } : { left: '50%', top: '0%' }}
      />
      <Handle 
        type="source" 
        position={isHorizontal ? Position.Left : Position.Top} 
        id="pos" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isHorizontal ? { top: '50%', left: '0%' } : { left: '50%', top: '0%' }}
      />
      
      <svg 
        width="24" 
        height="24" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke={selected ? '#3b82f6' : 'currentColor'} 
        strokeWidth="1.2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        style={{ overflow: 'visible' }}
        className={`text-slate-855 dark:text-slate-145 transition-colors ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.8)]' : ''}`}
      >
        {isHorizontal ? (
          <>
            {/* Left & Right Leads */}
            <path d="M -4 12 H 4" />
            <path d="M 20 12 H 28" />
            {/* Circle */}
            <circle cx="12" cy="12" r="8" />
            {/* Plus Sign (Left) */}
            <path d="M 8 10 V 14" strokeWidth="1" />
            <path d="M 6 12 H 10" strokeWidth="1" />
            {/* Minus Sign (Right) */}
            <path d="M 14 12 H 18" strokeWidth="1" />
          </>
        ) : (
          <>
            {/* Top & Bottom Leads */}
            <path d="M 12 -4 V 4" />
            <path d="M 12 20 V 28" />
            {/* Circle */}
            <circle cx="12" cy="12" r="8" />
            {/* Plus Sign (Top) */}
            <path d="M 12 6 V 10" strokeWidth="1" />
            <path d="M 10 8 H 14" strokeWidth="1" />
            {/* Minus Sign (Bottom) */}
            <path d="M 10 16 H 14" strokeWidth="1" />
          </>
        )}
      </svg>

      <div className={isHorizontal
        ? "absolute -bottom-3.5 left-1/2 -translate-x-1/2 text-[8px] font-bold font-mono text-slate-600 dark:text-slate-400 text-center pointer-events-none whitespace-nowrap"
        : "absolute left-[28px] top-1/2 -translate-y-1/2 text-[8px] font-bold font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap pointer-events-none"
      }>
        {data.label || '5V'}
      </div>
      
      <Handle 
        type="source" 
        position={isHorizontal ? Position.Right : Position.Bottom} 
        id="neg" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isHorizontal ? { top: '50%', left: '100%' } : { left: '50%', top: '100%' }}
      />
      <Handle 
        type="target" 
        position={isHorizontal ? Position.Right : Position.Bottom} 
        id="neg" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isHorizontal ? { top: '50%', left: '100%' } : { left: '50%', top: '100%' }}
      />
    </div>
  );
}


