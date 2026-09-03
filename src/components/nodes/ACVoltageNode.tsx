import { Handle, Position } from '@xyflow/react';
import type { NodePropertiesProps } from './registry';
import { SchematicLabel } from './schematic';
import { NumberInput } from '../NumberInput';

export function ACVoltageProperties({ node, updateData }: NodePropertiesProps) {
  return (
    <>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">Amplitude (V)</label>
        <NumberInput
          step={1}
          value={Number.isFinite(node.data.amplitude as number) ? (node.data.amplitude as number) : 10}
          onChange={v => {
            updateData('amplitude', v);
            // The caption is derived, so it has to move with the value rather
            // than with the raw text of the box — which, mid-edit, can be empty.
            updateData('label', `${v}V ${Number.isFinite(node.data.frequency as number) ? node.data.frequency : 60}Hz`);
          }}
          className="w-full text-sm border border-gray-300 rounded px-2 py-1"
        />
      </div>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">Frequency (Hz)</label>
        <NumberInput
          step={1}
          value={Number.isFinite(node.data.frequency as number) ? (node.data.frequency as number) : 60}
          onChange={v => {
            updateData('frequency', v);
            updateData('label', `${Number.isFinite(node.data.amplitude as number) ? node.data.amplitude : 10}V ${v}Hz`);
          }}
          className="w-full text-sm border border-gray-300 rounded px-2 py-1"
        />
      </div>
    </>
  );
}

export function ACVoltageNode({ data, selected }: any) {
  const isHorizontal = data.orientation === 'horizontal';

  return (
    <div className="schematic-node w-[40px] h-[40px] flex items-center justify-center relative select-none">
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
          </>
        ) : (
          <>
            {/* Top & Bottom Leads */}
            <path d="M 24 -2 V 8" />
            <path d="M 24 40 V 50" />
          </>
        )}
        
        {/* Circle */}
        <circle cx="24" cy="24" r="16" />
        
        {/* Sine Wave */}
        <path d="M 16 24 C 18 16, 22 16, 24 24 C 26 32, 30 32, 32 24" />
      </svg>

      <SchematicLabel placement={isHorizontal ? 'below' : 'right'}>
        {data.label || '10V 60Hz'}
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


