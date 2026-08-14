import { Handle, Position } from '@xyflow/react';
import { getNodeDefaultName } from '../../utils/nodeNaming';
import type { NodePropertiesProps } from './registry';
import { SchematicLabel } from './schematic';

export function ResistorProperties({ node, updateData }: NodePropertiesProps) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-gray-700 mb-1">Resistance (Ω)</label>
      <input type="text" value={(node.data.label as string) || '1k'} onChange={e => updateData('label', e.target.value)} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
    </div>
  );
}

export function ResistorNode({ id, data, selected }: any) {
  const orientation = data.orientation || 'horizontal';
  const isVertical = orientation === 'vertical' || orientation === 'up';
  const isLeft = orientation === 'left';
  const isUp = orientation === 'up';

  const name = data.name !== undefined ? data.name : getNodeDefaultName(id, 'resistor');

  return (
    <div className={`schematic-node flex items-center justify-center relative select-none ${isVertical ? 'w-[24px] h-[40px]' : 'w-[40px] h-[24px]'}`}>
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
          <path d="M 12 0 V 8 L 6 10 L 18 14 L 6 18 L 18 22 L 6 26 L 18 30 L 12 32 V 40" />
        ) : (
          <path d="M 0 12 H 8 L 10 6 L 14 18 L 18 6 L 22 18 L 26 6 L 30 18 L 32 12 H 40" />
        )}
      </svg>

      <SchematicLabel
        placement={isVertical ? 'right' : 'below'}
        name={name}
        value={data.label || '1k'}
      />
      
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
