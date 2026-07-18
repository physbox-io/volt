import { Handle, Position } from '@xyflow/react';
import { getNodeDefaultName } from '../../utils/nodeNaming';
import type { NodePropertiesProps } from './registry';

export function CapacitorProperties({ node, updateData }: NodePropertiesProps) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-gray-700 mb-1">Capacitance</label>
      <input type="text" value={(node.data.label as string) || '10u'} onChange={e => updateData('label', e.target.value)} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
    </div>
  );
}

export function CapacitorNode({ id, data, selected }: any) {
  const orientation = data.orientation || 'horizontal';
  const isVertical = orientation === 'vertical' || orientation === 'up';
  const isLeft = orientation === 'left';
  const isUp = orientation === 'up';

  const name = data.name !== undefined ? data.name : getNodeDefaultName(id, 'capacitor');

  return (
    <div className={`schematic-node flex items-center justify-center relative select-none ${isVertical ? 'w-[24px] h-[36px]' : 'w-[36px] h-[24px]'}`}>
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
            {/* Top lead and plate */}
            <path d="M 12 -2 V 16" />
            <path d="M 4 16 H 20" strokeWidth="2.0" />
            {/* Bottom plate and lead */}
            <path d="M 4 20 H 20" strokeWidth="2.0" />
            <path d="M 12 20 V 38" />
          </>
        ) : (
          <>
            {/* Left lead and plate */}
            <path d="M -2 12 H 16" />
            <path d="M 16 4 V 20" strokeWidth="2.0" />
            {/* Right plate and lead */}
            <path d="M 20 4 V 20" strokeWidth="2.0" />
            <path d="M 20 12 H 38" />
          </>
        )}
      </svg>

      <div className={isVertical
        ? "absolute left-[20px] top-1/2 -translate-y-1/2 text-[8px] font-bold font-mono text-slate-600 dark:text-slate-400 pointer-events-none whitespace-nowrap"
        : "absolute -bottom-3.5 left-1/2 -translate-x-1/2 text-[8px] font-bold font-mono text-slate-600 dark:text-slate-400 text-center pointer-events-none whitespace-nowrap"
      }>
        {name}: {data.label || '10u'}
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
