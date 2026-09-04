import { Handle, Position } from '@xyflow/react';
import type { NodePropertiesProps } from './registry';
import { SchematicLabel } from './schematic';

export function SwitchProperties({ node, updateData }: NodePropertiesProps) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-2">
        <label className="block text-xs font-medium text-gray-700">State</label>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${(node.data.isOpen !== false) ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
          {(node.data.isOpen !== false) ? 'OPEN' : 'CLOSED'}
        </span>
      </div>
      <button
        onClick={() => updateData('isOpen', node.data.isOpen === false)}
        className={`w-full py-2 rounded font-bold text-sm shadow-sm transition-all ${
          (node.data.isOpen !== false)
            ? 'bg-green-500 hover:bg-green-600 text-white'
            : 'bg-red-500 hover:bg-red-600 text-white'
        }`}
      >
        {(node.data.isOpen !== false) ? 'Close Switch' : 'Open Switch'}
      </button>
    </div>
  );
}

export function SwitchNode({ data, selected }: any) {
  const isOpen = data.isOpen !== false; // Default to open
  const orientation = data.orientation || 'horizontal';
  const isVertical = orientation === 'vertical' || orientation === 'up';
  const isLeft = orientation === 'left';
  const isUp = orientation === 'up';

  return (
    <div className={`schematic-node flex items-center justify-center relative select-none ${isVertical ? 'w-[40px] h-[48px]' : 'w-[48px] h-[40px]'}`}>
      <Handle 
        type="target" 
        position={isVertical ? (isUp ? Position.Bottom : Position.Top) : (isLeft ? Position.Right : Position.Left)} 
        id="in" 
        className="w-2 h-2 bg-emerald-500 !border-0" 
        style={isVertical ? { left: '50%' } : { top: '50%' }}
      />
      <Handle 
        type="source" 
        position={isVertical ? (isUp ? Position.Bottom : Position.Top) : (isLeft ? Position.Right : Position.Left)} 
        id="in" 
        className="w-2 h-2 bg-emerald-500 !border-0" 
        style={isVertical ? { left: '50%' } : { top: '50%' }}
      />
      
      <svg 
        width={isVertical ? 36 : 48} 
        height={isVertical ? 48 : 36} 
        viewBox={isVertical ? "0 0 48 64" : "0 0 64 48"} 
        fill="none" 
        stroke={selected ? '#3b82f6' : 'currentColor'} 
        strokeWidth="1.87" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        style={{ overflow: 'visible', transform: isLeft ? 'scaleX(-1)' : isUp ? 'scaleY(-1)' : undefined }}
        className={`text-slate-700 dark:text-slate-200 transition-colors ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.65)]' : ''}`}
      >
        {isVertical ? (
          <>
            {/* Top & Bottom Leads */}
            <path d="M 24 -2 V 20" />
            <path d="M 24 44 V 66" />
            {/* Contacts */}
            <circle cx="24" cy="20" r="2.5" fill="currentColor" stroke="none" />
            <circle cx="24" cy="44" r="2.5" fill="currentColor" stroke="none" />
            {/* Switch Lever */}
            <line 
              x1="24" 
              y1="20" 
              x2={isOpen ? 12 : 24} 
              y2={isOpen ? 40 : 44} 
              strokeWidth="1.87"
              style={{ transition: 'all 0.1s ease-in-out' }}
            />
          </>
        ) : (
          <>
            {/* Left and Right Leads */}
            <path d="M -2 24 H 20" />
            <path d="M 44 24 H 66" />
            {/* Contacts */}
            <circle cx="20" cy="24" r="2.5" fill="currentColor" stroke="none" />
            <circle cx="44" cy="24" r="2.5" fill="currentColor" stroke="none" />
            {/* Switch Lever */}
            <line 
              x1="20" 
              y1="24" 
              x2={isOpen ? 40 : 44} 
              y2={isOpen ? 12 : 24} 
              strokeWidth="1.87"
              style={{ transition: 'all 0.1s ease-in-out' }}
            />
          </>
        )}
      </svg>

      <SchematicLabel placement="above">
        {data.label || 'Switch'}
      </SchematicLabel>
      
      <div className={`absolute -bottom-4 text-[8px] font-extrabold tracking-wider ${isOpen ? 'text-rose-500' : 'text-emerald-500'} pointer-events-none`}>
        {isOpen ? 'OPEN' : 'CLOSED'}
      </div>
      
      <Handle 
        type="source" 
        position={isVertical ? (isUp ? Position.Top : Position.Bottom) : (isLeft ? Position.Left : Position.Right)} 
        id="out" 
        className="w-2 h-2 bg-emerald-500 !border-0" 
        style={isVertical ? { left: '50%' } : { top: '50%' }}
      />
      <Handle 
        type="target" 
        position={isVertical ? (isUp ? Position.Top : Position.Bottom) : (isLeft ? Position.Left : Position.Right)} 
        id="out" 
        className="w-2 h-2 bg-emerald-500 !border-0" 
        style={isVertical ? { left: '50%' } : { top: '50%' }}
      />
    </div>
  );
}
