import { Handle, Position } from '@xyflow/react';

export function SwitchNode({ data, selected }: any) {
  const isOpen = data.isOpen !== false; // Default to open
  const orientation = data.orientation || 'horizontal';
  const isVertical = orientation === 'vertical' || orientation === 'up';
  const isLeft = orientation === 'left';
  const isUp = orientation === 'up';

  return (
    <div className={`schematic-node flex items-center justify-center relative select-none ${isVertical ? 'w-[36px] h-[48px]' : 'w-[48px] h-[36px]'}`}>
      <Handle 
        type="target" 
        position={isVertical ? (isUp ? Position.Bottom : Position.Top) : (isLeft ? Position.Right : Position.Left)} 
        id="in" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isVertical ? { left: '50%', top: isUp ? '100%' : '0%' } : { top: '50%', left: isLeft ? '100%' : '0%' }}
      />
      <Handle 
        type="source" 
        position={isVertical ? (isUp ? Position.Bottom : Position.Top) : (isLeft ? Position.Right : Position.Left)} 
        id="in" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isVertical ? { left: '50%', top: isUp ? '100%' : '0%' } : { top: '50%', left: isLeft ? '100%' : '0%' }}
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
        style={{ overflow: 'visible', transform: isLeft ? 'scaleX(-1)' : isUp ? 'scaleY(-1)' : undefined }}
        className={`text-slate-855 dark:text-slate-145 transition-colors ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.8)]' : ''}`}
      >
        {isVertical ? (
          <>
            {/* Top & Bottom Leads */}
            <path d="M 24 -4 V 20" />
            <path d="M 24 44 V 68" />
            {/* Contacts */}
            <circle cx="24" cy="20" r="2.5" fill="currentColor" stroke="none" />
            <circle cx="24" cy="44" r="2.5" fill="currentColor" stroke="none" />
            {/* Switch Lever */}
            <line 
              x1="24" 
              y1="20" 
              x2={isOpen ? 12 : 24} 
              y2={isOpen ? 40 : 44} 
              strokeWidth="2.5"
              style={{ transition: 'all 0.1s ease-in-out' }}
            />
          </>
        ) : (
          <>
            {/* Left and Right Leads */}
            <path d="M -4 24 H 20" />
            <path d="M 44 24 H 68" />
            {/* Contacts */}
            <circle cx="20" cy="24" r="2.5" fill="currentColor" stroke="none" />
            <circle cx="44" cy="24" r="2.5" fill="currentColor" stroke="none" />
            {/* Switch Lever */}
            <line 
              x1="20" 
              y1="24" 
              x2={isOpen ? 40 : 44} 
              y2={isOpen ? 12 : 24} 
              strokeWidth="2.5"
              style={{ transition: 'all 0.1s ease-in-out' }}
            />
          </>
        )}
      </svg>

      <div className="absolute -top-4 text-[10px] font-bold font-mono text-slate-700 dark:text-slate-350 text-center w-full pointer-events-none">
        {data.label || 'Switch'}
      </div>
      
      <div className={`absolute -bottom-4 text-[8px] font-extrabold tracking-wider ${isOpen ? 'text-rose-500' : 'text-emerald-500'} pointer-events-none`}>
        {isOpen ? 'OPEN' : 'CLOSED'}
      </div>
      
      <Handle 
        type="source" 
        position={isVertical ? (isUp ? Position.Top : Position.Bottom) : (isLeft ? Position.Left : Position.Right)} 
        id="out" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isVertical ? { left: '50%', top: isUp ? '0%' : '100%' } : { top: '50%', left: isLeft ? '0%' : '100%' }}
      />
      <Handle 
        type="target" 
        position={isVertical ? (isUp ? Position.Top : Position.Bottom) : (isLeft ? Position.Left : Position.Right)} 
        id="out" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isVertical ? { left: '50%', top: isUp ? '0%' : '100%' } : { top: '50%', left: isLeft ? '0%' : '100%' }}
      />
    </div>
  );
}
