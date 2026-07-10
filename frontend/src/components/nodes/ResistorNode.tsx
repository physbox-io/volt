import { Handle, Position } from '@xyflow/react';

export function ResistorNode({ data, selected }: any) {
  const isVertical = data.orientation === 'vertical';

  return (
    <div className={`schematic-node flex items-center justify-center relative select-none ${isVertical ? 'w-[32px] h-[64px]' : 'w-[64px] h-[32px]'}`}>
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
        width={isVertical ? 32 : 64} 
        height={isVertical ? 64 : 32} 
        viewBox={isVertical ? "0 0 40 80" : "0 0 80 40"} 
        fill="none" 
        stroke={selected ? '#3b82f6' : 'currentColor'} 
        strokeWidth="1.5" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        style={{ overflow: 'visible' }}
        className={`text-slate-850 dark:text-slate-150 transition-colors ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.8)]' : ''}`}
      >
        {isVertical ? (
          <path d="M 20 -4 V 25 L 10 27.5 L 30 32.5 L 10 37.5 L 30 42.5 L 10 47.5 L 30 52.5 L 20 55 V 84" />
        ) : (
          <path d="M -4 20 H 25 L 27.5 10 L 32.5 30 L 37.5 10 L 42.5 30 L 47.5 10 L 52.5 30 L 55 20 H 84" />
        )}
      </svg>

      <div className={isVertical 
        ? "absolute left-[26px] top-[30px] text-[10px] font-bold font-mono text-slate-700 dark:text-slate-350 pointer-events-none whitespace-nowrap" 
        : "absolute -top-4 text-[10px] font-bold font-mono text-slate-700 dark:text-slate-350 text-center w-full pointer-events-none"
      }>
        {data.label || '1kΩ'}
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


