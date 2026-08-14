import { Handle, Position } from '@xyflow/react';
import { sanitizeSpiceValue } from '../../utils/spice';
import type { NodePropertiesProps } from './registry';
import { SchematicLabel } from './schematic';

export function transformerDefaultData() {
  return { label: 'Transformer', l_pri: '10m', l_sec: '10m', k: 0.99, l_pri_label: '10mH', l_sec_label: '10mH' };
}

export function TransformerProperties({ node, updateData }: NodePropertiesProps) {
  return (
    <>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">Primary Inductance</label>
        <input
          type="text"
          value={(node.data.l_pri_label as string) || '10mH'}
          onChange={e => {
            updateData('l_pri_label', e.target.value);
            updateData('l_pri', sanitizeSpiceValue(e.target.value));
          }}
          className="w-full text-sm border border-gray-300 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:border-blue-500 focus:outline-none"
        />
      </div>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">Secondary Inductance</label>
        <input
          type="text"
          value={(node.data.l_sec_label as string) || '10mH'}
          onChange={e => {
            updateData('l_sec_label', e.target.value);
            updateData('l_sec', sanitizeSpiceValue(e.target.value));
          }}
          className="w-full text-sm border border-gray-300 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:border-blue-500 focus:outline-none"
        />
      </div>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">Coupling Coefficient (K)</label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          max="1.0"
          value={(node.data.k as number) ?? 0.99}
          onChange={e => updateData('k', parseFloat(e.target.value) || 0.99)}
          className="w-full text-sm border border-gray-300 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:border-blue-500 focus:outline-none"
        />
      </div>
    </>
  );
}

export function TransformerNode({ data, selected }: any) {
  const lPri = data.l_pri_label || '10mH';
  const lSec = data.l_sec_label || '10mH';

  return (
    <div className="schematic-node flex items-center justify-center relative select-none w-[48px] h-[48px]">
      {/* Primary Terminals (Left) */}
      <Handle 
        type="target" 
        position={Position.Left} 
        id="p1" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={{ top: '25%', left: '0%' }}
      />
      <Handle 
        type="source" 
        position={Position.Left} 
        id="p1" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={{ top: '25%', left: '0%' }}
      />
      
      <Handle 
        type="target" 
        position={Position.Left} 
        id="p2" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={{ top: '75%', left: '0%' }}
      />
      <Handle 
        type="source" 
        position={Position.Left} 
        id="p2" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={{ top: '75%', left: '0%' }}
      />

      {/* Secondary Terminals (Right) */}
      <Handle 
        type="target" 
        position={Position.Right} 
        id="s1" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={{ top: '25%', left: '100%' }}
      />
      <Handle 
        type="source" 
        position={Position.Right} 
        id="s1" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={{ top: '25%', left: '100%' }}
      />

      <Handle 
        type="target" 
        position={Position.Right} 
        id="s2" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={{ top: '75%', left: '100%' }}
      />
      <Handle 
        type="source" 
        position={Position.Right} 
        id="s2" 
        className="w-2 h-2 bg-blue-500 !border-0" 
        style={{ top: '75%', left: '100%' }}
      />

      {/* Transformer Symbol SVG */}
      <svg 
        width="48" 
        height="48" 
        viewBox="0 0 48 48" 
        fill="none" 
        stroke={selected ? '#3b82f6' : 'currentColor'} 
        strokeWidth="1.4" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        style={{ overflow: 'visible' }}
        className={`text-slate-700 dark:text-slate-200 transition-colors ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.65)]' : ''}`}
      >
        {/* Left coil leads */}
        <path d="M 0 12 H 14" />
        <path d="M 0 36 H 14" />

        {/* Left coil loops */}
        <path d="M 14 12 C 18 12, 18 20, 14 20 C 18 20, 18 28, 14 28 C 18 28, 18 36, 14 36" strokeLinecap="round" />

        {/* Iron core lines */}
        <line x1="22" y1="8" x2="22" y2="40" strokeWidth="1.4" />
        <line x1="26" y1="8" x2="26" y2="40" strokeWidth="1.4" />

        {/* Right coil loops */}
        <path d="M 34 12 C 30 12, 30 20, 34 20 C 30 20, 30 28, 34 28 C 30 28, 30 36, 34 36" strokeLinecap="round" />

        {/* Right coil leads */}
        <path d="M 34 12 H 48" />
        <path d="M 34 36 H 48" />
      </svg>

      {/* Label and parameters */}
      <SchematicLabel placement="below">
        {data.label || `${lPri}:${lSec}`}
      </SchematicLabel>
    </div>
  );
}
