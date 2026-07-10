import { Handle, Position } from '@xyflow/react';

export function InductorNode({ data, selected }: any) {
  const isVertical = data.orientation === 'vertical';

  return (
    <div className={`schematic-node flex items-center justify-center relative select-none ${isVertical ? 'w-[30px] h-[60px]' : 'w-[60px] h-[30px]'}`}>
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
        width={isVertical ? 30 : 60} 
        height={isVertical ? 60 : 30} 
        viewBox={isVertical ? "0 0 40 80" : "0 0 80 40"} 
        fill="none" 
        stroke={selected ? '#3b82f6' : 'currentColor'} 
        strokeWidth="1.5" 
        strokeLinecap="round" 
        style={{ overflow: 'visible' }}
        className={`text-slate-855 dark:text-slate-145 transition-colors ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.8)]' : ''}`}
      >
        {isVertical ? (
          <path d="M 20 -4 V 16 A 6,6 0 0,1 20,28 A 6,6 0 0,1 20,40 A 6,6 0 0,1 20,52 A 6,6 0 0,1 20,64 V 84" />
        ) : (
          <path d="M -4 20 H 16 A 6,6 0 0,1 28,20 A 6,6 0 0,1 40,20 A 6,6 0 0,1 52,20 A 6,6 0 0,1 64,20 H 84" />
        )}
      </svg>

      <div className={isVertical
        ? "absolute left-[26px] top-[30px] text-[10px] font-bold font-mono text-slate-700 dark:text-slate-350 pointer-events-none whitespace-nowrap"
        : "absolute -bottom-4 text-[10px] font-bold font-mono text-slate-700 dark:text-slate-350 text-center w-full pointer-events-none"
      }>
        {data.label || '100uH'}
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


