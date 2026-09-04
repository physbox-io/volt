import { Handle, Position } from '@xyflow/react';
import { useState } from 'react';
import type { NodePropertiesProps } from './registry';
import { NumberInput } from '../NumberInput';
import { OPAMP_MODELS, getOpAmpModel, resolveOpAmpParams } from '../../utils/deviceModels';

export function OpAmpProperties({ node, updateData }: NodePropertiesProps) {
  const currentModelId = (node.data?.model as string) || 'ideal';
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleModelChange = (id: string) => {
    // Model and caption only — see the note in NpnNode.
    updateData('model', id);
    if (id === 'custom') return;
    const m = getOpAmpModel(id);
    if (m) updateData('label', m.id === 'ideal' ? 'OP-AMP' : m.name.split(' ')[0]);
  };

  // Shown as the netlist will read them.
  const resolved = resolveOpAmpParams(node.data);
  const currentGain = resolved.gain;
  const currentGbw = resolved.gbw;
  const currentRin = resolved.rin;
  const currentRout = resolved.rout;
  const currentDropHi = resolved.vRailDropHi;
  const currentDropLo = resolved.vRailDropLo;

  return (
    <>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Op-Amp Model</label>
        <select
          value={currentModelId}
          onChange={e => handleModelChange(e.target.value)}
          className="w-full text-sm border border-gray-300 dark:border-slate-700 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
        >
          {OPAMP_MODELS.map(m => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.description})
            </option>
          ))}
          <option value="custom">Custom Parameters</option>
        </select>
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Open-Loop Gain (Avol)</label>
        <NumberInput
          value={currentGain}
          onChange={v => {
            updateData('gain', v);
            updateData('model', 'custom');
          }}
          className="w-full text-sm border border-gray-300 rounded px-2 py-1"
        />
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Gain-Bandwidth Product (Hz, 0=Ideal)</label>
        <NumberInput
          value={currentGbw}
          onChange={v => {
            updateData('gbw', Math.max(0, v));
            updateData('model', 'custom');
          }}
          className="w-full text-sm border border-gray-300 rounded px-2 py-1"
        />
      </div>

      <div className="mt-2 mb-3">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 font-medium select-none"
        >
          {showAdvanced ? '▾ Hide Advanced Parameters' : '▸ Show Advanced Parameters'}
        </button>

        {showAdvanced && (
          <div className="mt-2.5 space-y-2.5 p-2.5 bg-slate-50 dark:bg-slate-800/50 rounded border border-slate-200 dark:border-slate-700/60">
            <div>
              <label className="block text-[11px] font-medium text-gray-600 dark:text-slate-300 mb-0.5">Input Resistance (Rin)</label>
              <input
                type="text"
                value={currentRin}
                onChange={e => {
                  updateData('rin', e.target.value);
                  updateData('model', 'custom');
                }}
                className="w-full text-xs border border-gray-300 dark:border-slate-700 rounded px-1.5 py-0.5 bg-white dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 dark:text-slate-300 mb-0.5">Output Resistance (Rout, Ω)</label>
              <NumberInput
                step={0.1}
                value={currentRout}
                onChange={v => {
                  updateData('rout', Math.max(0, v));
                  updateData('model', 'custom');
                }}
                className="w-full text-xs border border-gray-300 rounded px-1.5 py-0.5"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 dark:text-slate-300 mb-0.5">Headroom below Vcc (V)</label>
              <NumberInput
                step={0.1}
                value={currentDropHi}
                onChange={v => {
                  updateData('vRailDropHi', Math.max(0, v));
                  updateData('model', 'custom');
                }}
                className="w-full text-xs border border-gray-300 rounded px-1.5 py-0.5"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 dark:text-slate-300 mb-0.5">Headroom above Vee (V)</label>
              <NumberInput
                step={0.1}
                value={currentDropLo}
                onChange={v => {
                  updateData('vRailDropLo', Math.max(0, v));
                  updateData('model', 'custom');
                }}
                className="w-full text-xs border border-gray-300 rounded px-1.5 py-0.5"
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export function OpAmpNode({ data, selected }: any) {
  const displayLabel = data?.label || (data?.model && data.model !== 'ideal' ? (getOpAmpModel(data.model)?.name.split(' ')[0] || data.model.toUpperCase()) : 'LM358');

  return (
    <div className="schematic-node bg-transparent w-[80px] h-[80px] relative flex items-center justify-center select-none">
      {/* Triangle representation */}
      <svg 
        width="100%" 
        height="100%" 
        viewBox="0 0 100 100" 
        style={{ overflow: 'visible' }}
        className={`absolute top-0 left-0 transition-all ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.65)]' : ''}`}
      >
        {/* Connection Leads */}
        <g 
          className="stroke-slate-700 dark:stroke-slate-200 transition-colors"
          style={{ stroke: selected ? '#3b82f6' : undefined }}
          strokeWidth="1.75"
          strokeLinecap="round"
        >
          {/* Inverting input lead */}
          <path d="M -4 30 H 10" />
          {/* Non-inverting input lead */}
          <path d="M -4 70 H 10" />
          {/* Output lead */}
          <path d="M 90 50 H 104" />
          {/* VCC lead */}
          <path d="M 50 -4 V 30" />
          {/* VEE lead */}
          <path d="M 50 70 V 104" />
        </g>

        <polygon 
          points="10,10 10,90 90,50" 
          className="fill-white dark:fill-slate-900 stroke-slate-700 dark:stroke-slate-200 transition-colors"
          style={{ stroke: selected ? '#3b82f6' : undefined }}
          strokeWidth="1.75" 
          strokeLinejoin="round" 
        />
        <text x="26" y="36" textAnchor="middle" fontSize="11" fontWeight="bold" className="fill-slate-700 dark:fill-slate-200 transition-colors font-sans">-</text>
        <text x="26" y="76" textAnchor="middle" fontSize="11" fontWeight="bold" className="fill-slate-700 dark:fill-slate-200 transition-colors font-sans">+</text>
        <text x="42" y="55" textAnchor="middle" fontSize="9" fontWeight="bold" className="fill-slate-700 dark:fill-slate-200 transition-colors font-sans">{displayLabel}</text>
      </svg>
      
      {/* Handles */}
      {/* Inverting input */}
      <Handle type="target" position={Position.Left} id="in_inv" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[30%]" />
      <Handle type="source" position={Position.Left} id="in_inv" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[30%]" />
      {/* Non-inverting input */}
      <Handle type="target" position={Position.Left} id="in_non" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[70%]" />
      <Handle type="source" position={Position.Left} id="in_non" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[70%]" />
      
      {/* Output */}
      <Handle type="source" position={Position.Right} id="out" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[50%]" />
      <Handle type="target" position={Position.Right} id="out" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !top-[50%]" />
      
      {/* Power pins (top/bottom) */}
      <Handle type="target" position={Position.Top} id="vcc" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !left-[50%]" />
      <Handle type="source" position={Position.Top} id="vcc" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !left-[50%]" />
      <Handle type="target" position={Position.Bottom} id="vee" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !left-[50%]" />
      <Handle type="source" position={Position.Bottom} id="vee" className="w-2.5 h-2.5 bg-emerald-500 !border-0 !left-[50%]" />
    </div>
  );
}
