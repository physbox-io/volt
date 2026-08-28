import { Handle, Position } from '@xyflow/react';
import type { NodePropertiesProps } from './registry';
import { SchematicLabel } from './schematic';

export function VoltageProperties({ node, updateData }: NodePropertiesProps) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-medium text-gray-700 mb-1">Voltage (V)</label>
      <input type="text" value={(node.data.label as string) || '5V'} onChange={e => updateData('label', e.target.value)} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
    </div>
  );
}

export function VoltageNode({ data, selected }: any) {
  const isHorizontal = data.orientation === 'horizontal';

  return (
    <div className="schematic-node w-[24px] h-[24px] flex items-center justify-center relative select-none">
      <Handle 
        type="target" 
        position={isHorizontal ? Position.Left : Position.Top} 
        id="pos" 
        className="w-2 h-2 bg-emerald-500 !border-0" 
        style={isHorizontal ? { top: '50%', left: '0%' } : { left: '50%', top: '0%' }}
      />
      <Handle 
        type="source" 
        position={isHorizontal ? Position.Left : Position.Top} 
        id="pos" 
        className="w-2 h-2 bg-emerald-500 !border-0" 
        style={isHorizontal ? { top: '50%', left: '0%' } : { left: '50%', top: '0%' }}
      />
      
      <svg 
        width="24" 
        height="24" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke={selected ? '#3b82f6' : 'currentColor'} 
        strokeWidth="1.4" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        style={{ overflow: 'visible' }}
        className={`text-slate-700 dark:text-slate-200 transition-colors ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.65)]' : ''}`}
      >
        {isHorizontal ? (
          <>
            {/* Left & Right Leads */}
            <path d="M 0 12 H 4" />
            <path d="M 20 12 H 24" />
            {/* Circle */}
            <circle cx="12" cy="12" r="8" />
            {/* Plus Sign (Left) */}
            <path d="M 8 10 V 14" strokeWidth="1" />
            <path d="M 6 12 H 10" strokeWidth="1" />
            {/* Minus Sign (Right) */}
            <path d="M 14 12 H 18" strokeWidth="1" />
          </>
        ) : (
          <>
            {/* Top & Bottom Leads */}
            <path d="M 12 0 V 4" />
            <path d="M 12 20 V 24" />
            {/* Circle */}
            <circle cx="12" cy="12" r="8" />
            {/* Plus Sign (Top) */}
            <path d="M 12 6 V 10" strokeWidth="1" />
            <path d="M 10 8 H 14" strokeWidth="1" />
            {/* Minus Sign (Bottom) */}
            <path d="M 10 16 H 14" strokeWidth="1" />
          </>
        )}
      </svg>

      <SchematicLabel placement={isHorizontal ? 'below' : 'right'}>
        {data.label || '5V'}
      </SchematicLabel>
      
      <Handle 
        type="source" 
        position={isHorizontal ? Position.Right : Position.Bottom} 
        id="neg" 
        className="w-2 h-2 bg-emerald-500 !border-0" 
        style={isHorizontal ? { top: '50%', left: '100%' } : { left: '50%', top: '100%' }}
      />
      <Handle 
        type="target" 
        position={isHorizontal ? Position.Right : Position.Bottom} 
        id="neg" 
        className="w-2 h-2 bg-emerald-500 !border-0" 
        style={isHorizontal ? { top: '50%', left: '100%' } : { left: '50%', top: '100%' }}
      />
    </div>
  );
}


