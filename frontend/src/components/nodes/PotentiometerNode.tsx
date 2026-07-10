import { Handle, Position } from '@xyflow/react';

export function PotentiometerNode({ data, selected }: any) {
  const position = data.position ?? 50; // wiper position 0-100%
  const label = data.label || '10k';
  const isVertical = data.orientation === 'vertical';

  return (
    <div className={`schematic-node flex items-center justify-center relative select-none ${isVertical ? 'w-[36px] h-[60px]' : 'w-[60px] h-[36px]'}`}>
      {/* Terminal handles */}
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
      <Handle 
        type="target" 
        position={isVertical ? Position.Left : Position.Top} 
        id="wiper" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isVertical ? { top: '50%', left: '0%' } : { left: '50%', top: '0%' }}
      />
      <Handle 
        type="source" 
        position={isVertical ? Position.Left : Position.Top} 
        id="wiper" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isVertical ? { top: '50%', left: '0%' } : { left: '50%', top: '0%' }}
      />

      <svg 
        width={isVertical ? 36 : 60} 
        height={isVertical ? 60 : 36} 
        viewBox={isVertical ? "0 0 48 80" : "0 0 80 48"} 
        fill="none" 
        stroke={selected ? '#3b82f6' : 'currentColor'} 
        strokeWidth="1.5" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        className={`text-slate-855 dark:text-slate-145 transition-colors ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.8)]' : ''}`}
      >
        {isVertical ? (
          <>
            {/* Top & Bottom Leads */}
            <path d="M 24 0 V 25" />
            <path d="M 24 55 V 80" />
            
            {/* Resistor Body */}
            <path d="M 24 25 L 14 27.5 L 34 32.5 L 14 37.5 L 34 42.5 L 14 47.5 L 34 52.5 L 24 55" />
            
            {/* Wiper Line & Arrow (Left to Center) */}
            <path d="M 0 40 H 14" />
            <path d="M 8 36 L 14 40 L 8 44" />
          </>
        ) : (
          <>
            {/* Left & Right leads */}
            <path d="M 0 24 H 25" />
            <path d="M 55 24 H 80" />
            
            {/* Resistor Body */}
            <path d="M 25 24 L 27.5 14 L 32.5 34 L 37.5 14 L 42.5 34 L 47.5 14 L 52.5 34 L 55 24" />
            
            {/* Wiper Line & Arrow (Top to Center) */}
            <path d="M 40 0 V 10" />
            <path d="M 37 6 L 40 10 L 43 6" />
          </>
        )}
      </svg>

      <div className={isVertical
        ? "absolute left-[30px] top-[40px] text-[9px] font-bold font-mono text-slate-700 dark:text-slate-350 pointer-events-none whitespace-nowrap"
        : "absolute -bottom-4 text-[9px] font-bold font-mono text-slate-700 dark:text-slate-350 text-center w-full pointer-events-none"
      }>
        {label} • {position}%
      </div>
    </div>
  );
}


