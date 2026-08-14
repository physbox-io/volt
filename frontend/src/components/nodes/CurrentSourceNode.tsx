import { Handle, Position } from '@xyflow/react';
import type { NodePropertiesProps } from './registry';
import { SchematicLabel } from './schematic';

export function CurrentSourceProperties({ node, updateData }: NodePropertiesProps) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-gray-700 mb-1">Current</label>
      <input type="text" value={(node.data.label as string) || '10m'} onChange={e => updateData('label', e.target.value)} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
      <div className="text-[10px] text-gray-400 mt-1">e.g. 10m = 10mA, 1 = 1A</div>
    </div>
  );
}

export function CurrentSourceNode({ data, selected }: any) {
  const label = data.label || '10mA';
  const isHorizontal = data.orientation === 'horizontal';

  return (
    <div className="schematic-node w-[40px] h-[40px] flex items-center justify-center relative select-none">
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
        width="36" 
        height="36" 
        viewBox="0 0 48 48" 
        fill="none" 
        stroke={selected ? '#3b82f6' : 'currentColor'} 
        strokeWidth="1.87" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        style={{ overflow: 'visible' }}
        className={`text-slate-700 dark:text-slate-200 transition-colors ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.65)]' : ''}`}
      >
        {isHorizontal ? (
          <>
            {/* Left & Right Leads */}
            <path d="M -2 24 H 8" />
            <path d="M 40 24 H 50" />
            {/* Circle */}
            <circle cx="24" cy="24" r="16" />
            {/* Arrow (current direction pointing right) */}
            <line x1="16" y1="24" x2="32" y2="24" />
            <path d="M 27 20 L 32 24 L 27 28" />
          </>
        ) : (
          <>
            {/* Top & Bottom Leads */}
            <path d="M 24 -2 V 8" />
            <path d="M 24 40 V 50" />
            {/* Circle */}
            <circle cx="24" cy="24" r="16" />
            {/* Arrow (current direction pointing up) */}
            <line x1="24" y1="32" x2="24" y2="16" />
            <path d="M 20 21 L 24 16 L 28 21" />
          </>
        )}
      </svg>

      <SchematicLabel placement={isHorizontal ? 'below' : 'right'}>
        {label}
      </SchematicLabel>
      
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


