import { Handle, Position } from '@xyflow/react';
import type { NodePropertiesProps } from './registry';

export function ZenerDiodeProperties({ node, updateData }: NodePropertiesProps) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-gray-700 mb-1">Breakdown Voltage (V)</label>
      <input type="text" value={(node.data.label as string) || '5.1V'} onChange={e => updateData('label', e.target.value)} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
      <div className="text-[10px] text-gray-400 mt-1">Common: 3.3V, 5.1V, 12V</div>
    </div>
  );
}

export function ZenerDiodeNode({ data, selected }: any) {
  const orientation = data.orientation || 'horizontal';
  const isVertical = orientation === 'vertical' || orientation === 'up';
  const isLeft = orientation === 'left';
  const isUp = orientation === 'up';

  return (
    <div className={`schematic-node flex items-center justify-center relative select-none ${isVertical ? 'w-[24px] h-[36px]' : 'w-[36px] h-[24px]'}`}>
      <Handle 
        type="target" 
        position={isVertical ? (isUp ? Position.Bottom : Position.Top) : (isLeft ? Position.Right : Position.Left)} 
        id="anode" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isVertical ? { left: '50%', top: isUp ? '100%' : '0%' } : { top: '50%', left: isLeft ? '100%' : '0%' }}
      />
      <Handle 
        type="source" 
        position={isVertical ? (isUp ? Position.Bottom : Position.Top) : (isLeft ? Position.Right : Position.Left)} 
        id="anode" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isVertical ? { left: '50%', top: isUp ? '100%' : '0%' } : { top: '50%', left: isLeft ? '100%' : '0%' }}
      />
      
      <svg 
        width={isVertical ? 24 : 36} 
        height={isVertical ? 36 : 24} 
        viewBox={isVertical ? "0 0 24 36" : "0 0 36 24"} 
        fill="none" 
        stroke={selected ? '#3b82f6' : 'currentColor'} 
        strokeWidth="1.2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        style={{ overflow: 'visible', transform: isLeft ? 'scaleX(-1)' : isUp ? 'scaleY(-1)' : undefined }}
        className={`text-slate-855 dark:text-slate-145 transition-colors ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.8)]' : ''}`}
      >
        {isVertical ? (
          <>
            {/* Top lead */}
            <path d="M 12 -2 V 12" />
            {/* Triangle (Anode) */}
            <path d="M 6 12 H 18 L 12 20 Z" fill="currentColor" />
            {/* Zener Cathode bar */}
            <path d="M 6 20 H 18" strokeWidth="2.0" />
            <path d="M 6 20 V 16" strokeWidth="2.0" />
            <path d="M 18 20 V 24" strokeWidth="2.0" />
            {/* Bottom lead */}
            <path d="M 12 20 V 38" />
          </>
        ) : (
          <>
            {/* Left lead */}
            <path d="M -2 12 H 12" />
            {/* Triangle (Anode) */}
            <path d="M 12 6 L 20 12 L 12 18 Z" fill="currentColor" />
            {/* Zener Cathode bar */}
            <path d="M 20 6 V 18" strokeWidth="2.0" />
            {/* Zener Cathode curls */}
            <path d="M 20 6 H 24" strokeWidth="2.0" />
            <path d="M 16 18 H 20" strokeWidth="2.0" />
            {/* Right lead */}
            <path d="M 20 12 H 38" />
          </>
        )}
      </svg>

      <div className={isVertical 
        ? "absolute left-[20px] top-1/2 -translate-y-1/2 text-[8px] font-bold font-mono text-slate-600 dark:text-slate-400 pointer-events-none whitespace-nowrap" 
        : "absolute -bottom-3.5 left-1/2 -translate-x-1/2 text-[8px] font-bold font-mono text-slate-600 dark:text-slate-400 text-center pointer-events-none whitespace-nowrap"
      }>
        {data.label || '5.1V'}
      </div>
      
      <Handle 
        type="source" 
        position={isVertical ? (isUp ? Position.Top : Position.Bottom) : (isLeft ? Position.Left : Position.Right)} 
        id="cathode" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isVertical ? { left: '50%', top: isUp ? '0%' : '100%' } : { top: '50%', left: isLeft ? '0%' : '100%' }}
      />
      <Handle 
        type="target" 
        position={isVertical ? (isUp ? Position.Top : Position.Bottom) : (isLeft ? Position.Left : Position.Right)} 
        id="cathode" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={isVertical ? { left: '50%', top: isUp ? '0%' : '100%' } : { top: '50%', left: isLeft ? '0%' : '100%' }}
      />
    </div>
  );
}


