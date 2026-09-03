import { Handle, Position } from '@xyflow/react';
import type { NodePropertiesProps } from './registry';
import { SchematicLabel } from './schematic';
import { NumberInput } from '../NumberInput';

export function DiodeProperties({ node, updateData }: NodePropertiesProps) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-gray-700 mb-1">Forward Voltage Drop (V)</label>
      <NumberInput step={0.1}
          value={Number.isFinite(node.data.v_drop as number) ? (node.data.v_drop as number) : 0.7}
          onChange={v => updateData('v_drop', v)}
          className="w-full text-sm border border-gray-300 rounded px-2 py-1"
        />
      <div className="text-[10px] text-gray-400 mt-1">Silicon: 0.7V, Germanium: 0.3V</div>
    </div>
  );
}

export function DiodeNode({ data, selected }: any) {
  const orientation = data.orientation || 'horizontal';
  const isVertical = orientation === 'vertical' || orientation === 'up';
  const isLeft = orientation === 'left';
  const isUp = orientation === 'up';

  return (
    <div className={`schematic-node flex items-center justify-center relative select-none ${isVertical ? 'w-[24px] h-[40px]' : 'w-[40px] h-[24px]'}`}>
      <Handle 
        type="target" 
        position={isVertical ? (isUp ? Position.Bottom : Position.Top) : (isLeft ? Position.Right : Position.Left)} 
        id="anode" 
        className="w-2 h-2 bg-emerald-500 !border-0" 
        style={isVertical ? { left: '50%', top: isUp ? '100%' : '0%' } : { top: '50%', left: isLeft ? '100%' : '0%' }}
      />
      <Handle 
        type="source" 
        position={isVertical ? (isUp ? Position.Bottom : Position.Top) : (isLeft ? Position.Right : Position.Left)} 
        id="anode" 
        className="w-2 h-2 bg-emerald-500 !border-0" 
        style={isVertical ? { left: '50%', top: isUp ? '100%' : '0%' } : { top: '50%', left: isLeft ? '100%' : '0%' }}
      />
      
      <svg 
        width={isVertical ? 24 : 40} 
        height={isVertical ? 40 : 24} 
        viewBox={isVertical ? "0 0 24 40" : "0 0 40 24"} 
        fill="none" 
        stroke={selected ? '#3b82f6' : 'currentColor'} 
        strokeWidth="1.4" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        style={{ overflow: 'visible', transform: isLeft ? 'scaleX(-1)' : isUp ? 'scaleY(-1)' : undefined }}
        className={`text-slate-700 dark:text-slate-200 transition-colors ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.65)]' : ''}`}
      >
        {isVertical ? (
          <>
            {/* Top lead */}
            <path d="M 12 0 V 14" />
            {/* Triangle (Anode) */}
            <path d="M 6 14 H 18 L 12 22 Z" fill="currentColor" />
            {/* Cathode bar */}
            <path d="M 6 22 H 18" strokeWidth="2.4" />
            {/* Bottom lead */}
            <path d="M 12 22 V 40" />
          </>
        ) : (
          <>
            {/* Left lead */}
            <path d="M 0 12 H 14" />
            {/* Triangle (Anode) */}
            <path d="M 14 6 L 22 12 L 14 18 Z" fill="currentColor" />
            {/* Cathode bar */}
            <path d="M 22 6 V 18" strokeWidth="2.4" />
            {/* Right lead */}
            <path d="M 22 12 H 40" />
          </>
        )}
      </svg>

      <SchematicLabel placement={isVertical ? 'right' : 'below'}>
        {data.label || '1N4148'}
      </SchematicLabel>
      
      <Handle 
        type="source" 
        position={isVertical ? (isUp ? Position.Top : Position.Bottom) : (isLeft ? Position.Left : Position.Right)} 
        id="cathode" 
        className="w-2 h-2 bg-emerald-500 !border-0" 
        style={isVertical ? { left: '50%', top: isUp ? '0%' : '100%' } : { top: '50%', left: isLeft ? '0%' : '100%' }}
      />
      <Handle 
        type="target" 
        position={isVertical ? (isUp ? Position.Top : Position.Bottom) : (isLeft ? Position.Left : Position.Right)} 
        id="cathode" 
        className="w-2 h-2 bg-emerald-500 !border-0" 
        style={isVertical ? { left: '50%', top: isUp ? '0%' : '100%' } : { top: '50%', left: isLeft ? '0%' : '100%' }}
      />
    </div>
  );
}


