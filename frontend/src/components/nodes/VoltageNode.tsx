import { Handle, Position } from '@xyflow/react';

export function VoltageNode({ data, selected }: any) {
  const isHorizontal = data.orientation === 'horizontal';

  return (
    <div className="schematic-node w-[32px] h-[32px] flex items-center justify-center relative select-none">
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
        width="32" 
        height="32" 
        viewBox="0 0 48 48" 
        fill="none" 
        stroke={selected ? '#3b82f6' : 'currentColor'} 
        strokeWidth="1.5" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        style={{ overflow: 'visible' }}
        className={`text-slate-855 dark:text-slate-145 transition-colors ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.8)]' : ''}`}
      >
        {isHorizontal ? (
          <>
            {/* Left & Right Leads */}
            <path d="M -4 24 H 8" />
            <path d="M 40 24 H 52" />
            {/* Circle */}
            <circle cx="24" cy="24" r="16" />
            {/* Plus Sign (Left) */}
            <path d="M 16 21 V 27" strokeWidth="1.5" />
            <path d="M 13 24 H 19" strokeWidth="1.5" />
            {/* Minus Sign (Right) */}
            <path d="M 29 24 H 35" strokeWidth="1.5" />
          </>
        ) : (
          <>
            {/* Top & Bottom Leads */}
            <path d="M 24 -4 V 8" />
            <path d="M 24 40 V 52" />
            {/* Circle */}
            <circle cx="24" cy="24" r="16" />
            {/* Plus Sign (Top) */}
            <path d="M 24 13 V 19" strokeWidth="1.5" />
            <path d="M 21 16 H 27" strokeWidth="1.5" />
            {/* Minus Sign (Bottom) */}
            <path d="M 21 32 H 27" strokeWidth="1.5" />
          </>
        )}
      </svg>

      <div className={isHorizontal
        ? "absolute -top-4 text-[10px] font-bold font-mono text-slate-700 dark:text-slate-350 text-center w-full pointer-events-none"
        : "absolute left-[54px] text-[10px] font-bold font-mono text-slate-700 dark:text-slate-350 whitespace-nowrap pointer-events-none"
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


