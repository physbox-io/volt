import { Handle, Position } from '@xyflow/react';
import type { NodePropertiesProps } from './registry';
import { SchematicLabel } from './schematic';
import { NumberInput } from '../NumberInput';

import { useState } from 'react';
import { BJT_NPN_MODELS, BJT_PNP_MODELS, getBjtModel } from '../../utils/deviceModels';

/** Shared by NpnNode and PnpNode — both BJT types expose model presets and physical SPICE parameters. */
export function BJTProperties({ node, updateData }: NodePropertiesProps) {
  const isPnp = node.type === 'pnp';
  const models = isPnp ? BJT_PNP_MODELS : BJT_NPN_MODELS;
  const currentModelId = (node.data?.model as string) || 'generic';
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleModelChange = (id: string) => {
    updateData('model', id);
    if (id === 'custom') return;
    const m = getBjtModel(isPnp ? 'pnp' : 'npn', id);
    if (m) {
      updateData('label', m.id === 'generic' ? (isPnp ? 'PNP' : 'NPN') : m.name);
      updateData('bf', m.bf);
      updateData('is', m.is);
      updateData('vaf', m.vaf);
      updateData('rb', m.rb);
      updateData('cjc', m.cjc);
      updateData('cje', m.cje);
      updateData('ikf', m.ikf);
    }
  };

  const currentBf = Number.isFinite(node.data?.bf as number) ? (node.data.bf as number) : 300;
  const currentVaf = Number.isFinite(node.data?.vaf as number) ? (node.data.vaf as number) : 100;
  const currentIs = Number.isFinite(node.data?.is as number) ? (node.data.is as number) : 1e-14;
  const currentRb = Number.isFinite(node.data?.rb as number) ? (node.data.rb as number) : 10;
  const currentIkf = Number.isFinite(node.data?.ikf as number) ? (node.data.ikf as number) : 0.4;
  const currentCjc = node.data?.cjc !== undefined ? String(node.data.cjc) : '2p';
  const currentCje = node.data?.cje !== undefined ? String(node.data.cje) : '4p';

  return (
    <>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Transistor Model</label>
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
        <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Current Gain (BF / β)</label>
        <NumberInput
          value={currentBf}
          onChange={v => {
            updateData('bf', v);
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
              <label className="block text-[11px] font-medium text-gray-600 dark:text-slate-300 mb-0.5">Early Voltage (VAF, V)</label>
              <NumberInput
                value={currentVaf}
                onChange={v => {
                  updateData('vaf', v);
                  updateData('model', 'custom');
                }}
                className="w-full text-xs border border-gray-300 rounded px-1.5 py-0.5"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 dark:text-slate-300 mb-0.5">Saturation Current (IS, A)</label>
              <input
                type="text"
                value={currentIs.toExponential()}
                onChange={e => {
                  const val = parseFloat(e.target.value);
                  if (Number.isFinite(val) && val > 0) {
                    updateData('is', val);
                    updateData('model', 'custom');
                  }
                }}
                className="w-full text-xs border border-gray-300 dark:border-slate-700 rounded px-1.5 py-0.5 bg-white dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 dark:text-slate-300 mb-0.5">Base Resistance (RB, Ω)</label>
              <NumberInput
                value={currentRb}
                onChange={v => {
                  updateData('rb', v);
                  updateData('model', 'custom');
                }}
                className="w-full text-xs border border-gray-300 rounded px-1.5 py-0.5"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 dark:text-slate-300 mb-0.5">Collector Cap (CJC)</label>
              <input
                type="text"
                value={currentCjc}
                onChange={e => {
                  updateData('cjc', e.target.value);
                  updateData('model', 'custom');
                }}
                className="w-full text-xs border border-gray-300 dark:border-slate-700 rounded px-1.5 py-0.5 bg-white dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 dark:text-slate-300 mb-0.5">Emitter Cap (CJE)</label>
              <input
                type="text"
                value={currentCje}
                onChange={e => {
                  updateData('cje', e.target.value);
                  updateData('model', 'custom');
                }}
                className="w-full text-xs border border-gray-300 dark:border-slate-700 rounded px-1.5 py-0.5 bg-white dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 dark:text-slate-300 mb-0.5">High-Current Knee (IKF, A)</label>
              <NumberInput
                step={0.1}
                value={currentIkf}
                onChange={v => {
                  updateData('ikf', v);
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

export function NpnNode({ data, selected }: any) {
  return (
    <div className="schematic-node w-[32px] h-[32px] flex items-center justify-center relative select-none">
      <Handle type="target" position={Position.Top} id="c" className="w-2 h-2 bg-emerald-500 !border-0" style={{ left: '75%' }} />
      <Handle type="source" position={Position.Top} id="c" className="w-2 h-2 bg-emerald-500 !border-0" style={{ left: '75%' }} />
      <Handle type="target" position={Position.Left} id="b" className="w-2 h-2 bg-emerald-500 !border-0" style={{ top: '50%' }} />
      <Handle type="source" position={Position.Left} id="b" className="w-2 h-2 bg-emerald-500 !border-0" style={{ top: '50%' }} />
      <Handle type="source" position={Position.Bottom} id="e" className="w-2 h-2 bg-emerald-500 !border-0" style={{ left: '75%' }} />
      <Handle type="target" position={Position.Bottom} id="e" className="w-2 h-2 bg-emerald-500 !border-0" style={{ left: '75%' }} />
      
      <svg 
        width="32" 
        height="32" 
        viewBox="0 0 32 32" 
        fill="none" 
        stroke={selected ? '#3b82f6' : 'currentColor'} 
        strokeWidth="1.4" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        style={{ overflow: 'visible' }}
        className={`text-slate-700 dark:text-slate-200 transition-colors ${selected ? 'drop-shadow-[0_0_3px_rgba(59,130,246,0.65)]' : ''}`}
      >
        {/* Base Lead */}
        <path d="M 0 16 H 12" />
        {/* Base Plate */}
        <path d="M 12 8 V 24" strokeWidth="2.4" />
        {/* Collector Lead: diagonal then vertical */}
        <path d="M 12 12 L 24 4 V 0" />
        {/* Emitter Lead: diagonal then vertical */}
        <path d="M 12 20 L 24 28 V 32" />
        {/* Emitter Arrow in the middle of the leg, pointing outward */}
        <path d="M 21 26 L 16 26 M 21 26 L 19 22" strokeWidth="1.4" />
      </svg>

      <SchematicLabel placement="below">
        {data.label || 'NPN'}
      </SchematicLabel>
    </div>
  );
}


