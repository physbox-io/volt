import { Handle, Position } from '@xyflow/react';
import type { NodePropertiesProps } from './registry';
import { SchematicLabel } from './schematic';
import { NumberInput } from '../NumberInput';

import { useState } from 'react';
import { MOSFET_NMOS_MODELS, MOSFET_PMOS_MODELS, getMosfetModel, resolveMosfetParams } from '../../utils/deviceModels';

/** Shared by NmosNode and PmosNode — both MOSFET types expose model presets and physical SPICE parameters. */
export function MosfetProperties({ node, updateData }: NodePropertiesProps) {
  const isPmos = node.type === 'pmos';
  const models = isPmos ? MOSFET_PMOS_MODELS : MOSFET_NMOS_MODELS;
  const currentModelId = (node.data?.model as string) || 'generic';
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleModelChange = (id: string) => {
    // Model and caption only — see the note in NpnNode.
    updateData('model', id);
    if (id === 'custom') return;
    const m = getMosfetModel(isPmos ? 'pmos' : 'nmos', id);
    if (m) updateData('label', m.id === 'generic' ? (isPmos ? 'PMOS' : 'NMOS') : m.name);
  };

  // Shown as the netlist will read them.
  const resolved = resolveMosfetParams(isPmos ? 'pmos' : 'nmos', node.data);
  const currentVto = resolved.vto;
  const currentKp = resolved.kp;
  const currentLambda = resolved.lambda;
  const currentRd = resolved.rd;
  const currentRs = resolved.rs;
  const currentCgs = resolved.cgs;
  const currentCgd = resolved.cgd;

  return (
    <>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">MOSFET Model</label>
        <select
          value={currentModelId}
          onChange={e => handleModelChange(e.target.value)}
          className="w-full text-sm border border-gray-300 dark:border-slate-700 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
        >
          {models.map(m => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.description})
            </option>
          ))}
          <option value="custom">Custom Parameters</option>
        </select>
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Threshold Voltage (VTO / Vth, V)</label>
        <NumberInput
          step={0.1}
          value={currentVto}
          onChange={v => {
            updateData('vto', v);
            updateData('model', 'custom');
          }}
          className="w-full text-sm border border-gray-300 rounded px-2 py-1"
        />
      </div>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Transconductance (KP, A/V²)</label>
        <NumberInput
          step={0.01}
          value={currentKp}
          onChange={v => {
            updateData('kp', v);
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
              <label className="block text-[11px] font-medium text-gray-600 dark:text-slate-300 mb-0.5">Channel Modulation (LAMBDA, 1/V)</label>
              <NumberInput
                step={0.005}
                value={currentLambda}
                onChange={v => {
                  updateData('lambda', v);
                  updateData('model', 'custom');
                }}
                className="w-full text-xs border border-gray-300 rounded px-1.5 py-0.5"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 dark:text-slate-300 mb-0.5">Drain Resistance (RD, Ω)</label>
              <NumberInput
                step={0.1}
                value={currentRd}
                onChange={v => {
                  updateData('rd', v);
                  updateData('model', 'custom');
                }}
                className="w-full text-xs border border-gray-300 rounded px-1.5 py-0.5"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 dark:text-slate-300 mb-0.5">Source Resistance (RS, Ω)</label>
              <NumberInput
                step={0.1}
                value={currentRs}
                onChange={v => {
                  updateData('rs', v);
                  updateData('model', 'custom');
                }}
                className="w-full text-xs border border-gray-300 rounded px-1.5 py-0.5"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 dark:text-slate-300 mb-0.5">Gate-Source Cap (CGS)</label>
              <input
                type="text"
                value={currentCgs}
                onChange={e => {
                  updateData('cgs', e.target.value);
                  updateData('model', 'custom');
                }}
                className="w-full text-xs border border-gray-300 dark:border-slate-700 rounded px-1.5 py-0.5 bg-white dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 dark:text-slate-300 mb-0.5">Gate-Drain Cap (CGD)</label>
              <input
                type="text"
                value={currentCgd}
                onChange={e => {
                  updateData('cgd', e.target.value);
                  updateData('model', 'custom');
                }}
                className="w-full text-xs border border-gray-300 dark:border-slate-700 rounded px-1.5 py-0.5 bg-white dark:bg-slate-900"
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export function NmosNode({ data, selected }: any) {
  return (
    <div className="schematic-node w-[48px] h-[48px] flex items-center justify-center relative select-none">
      <Handle type="target" position={Position.Top} id="d" className="w-2 h-2 bg-emerald-500 !border-0" style={{ left: '75%' }} />
      <Handle type="target" position={Position.Left} id="g" className="w-2 h-2 bg-emerald-500 !border-0" style={{ top: '50%' }} />
      <Handle type="source" position={Position.Bottom} id="s" className="w-2 h-2 bg-emerald-500 !border-0" style={{ left: '75%' }} />
      
      <svg 
        width="48" 
        height="48" 
        viewBox="0 0 40 40" 
        fill="none" 
        stroke={selected ? '#3b82f6' : 'currentColor'} 
        strokeWidth="1.17" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        className={`text-slate-700 dark:text-slate-200 transition-colors ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.65)]' : ''}`}
      >
        {/* Gate Lead */}
        <path d="M 0 20 H 16" />
        {/* Gate Plate */}
        <path d="M 16 10 V 30" strokeWidth="2" />
        {/* Channel Plate (3 segments) */}
        <path d="M 20 10 V 15" strokeWidth="2" />
        <path d="M 20 18 V 22" strokeWidth="2" />
        <path d="M 20 25 V 30" strokeWidth="2" />
        {/* Drain Lead */}
        <path d="M 20 12 H 30 V 0" />
        {/* Source Lead */}
        <path d="M 20 28 H 30 V 40" />
        {/* Substrate line */}
        <path d="M 20 20 H 30" />
        {/* Body arrow pointing inwards */}
        <path d="M 20 20 L 26 17 M 20 20 L 26 23" strokeWidth="1.17" />
      </svg>

      <SchematicLabel placement="right">
        {data.label || 'NMOS'}
      </SchematicLabel>
    </div>
  );
}


