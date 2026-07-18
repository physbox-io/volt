import { Handle, Position } from '@xyflow/react';
import { AlertCircle } from 'lucide-react';
import type { NodePropertiesProps } from './registry';

export function SignalGeneratorProperties({ node, updateData, simLength }: NodePropertiesProps) {
  return (
    <>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">Waveform</label>
        <select value={(node.data.waveform as string) || 'sine'} onChange={e => updateData('waveform', e.target.value)} className="w-full text-sm border border-gray-300 rounded px-2 py-1">
          <option value="sine">Sine</option>
          <option value="square">Square</option>
        </select>
      </div>
      {node.data.waveform === 'square' && (
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">Duty Cycle (%)</label>
          <input type="number" min="1" max="99" value={(node.data.dutyCycle as number) || 50} onChange={e => updateData('dutyCycle', parseInt(e.target.value))} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
        </div>
      )}
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">Frequency (Hz)</label>
        <input type="number" value={(node.data.frequency as number) || 1} onChange={e => updateData('frequency', parseInt(e.target.value))} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
      </div>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">Amplitude (V)</label>
        <input type="number" value={(node.data.amplitude as number) || 5} onChange={e => updateData('amplitude', parseInt(e.target.value))} className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
      </div>
      {((node.data.frequency as number) > 10000 && simLength > 0.5) && (
        <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded text-[10px] text-amber-800 flex items-start gap-2 shadow-sm animate-pulse">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>Warning: High frequency with long duration may slow down simulation or lock UI. Consider reducing duration below 0.5s.</span>
        </div>
      )}
    </>
  );
}

export function SignalGeneratorNode({ data }: any) {
  const type = data.waveform || 'sine';
  const freq = data.frequency || 1;
  const amp = data.amplitude || 5;

  return (
    <div className="bg-blue-100 border-2 border-blue-600 rounded-md p-3 w-32 h-[96px] flex flex-col items-center justify-center relative shadow-sm">
      <div className="text-xs font-bold text-blue-900 mb-1">Signal Gen</div>
      <div className="text-[10px] font-mono text-gray-700 bg-white px-2 py-1 rounded w-full mb-1 border border-gray-300">
        Type: {type}
      </div>
      <div className="text-[10px] font-mono text-gray-700 bg-white px-2 py-1 rounded w-full border border-gray-300">
        {amp}V, {freq}Hz
      </div>
      <Handle type="source" position={Position.Right} id="out" className="w-3 h-3 bg-blue-500" />
      <Handle type="target" position={Position.Right} id="out" className="w-3 h-3 bg-blue-500" />
      <Handle type="source" position={Position.Bottom} id="gnd" className="w-3 h-3 bg-black" />
      <Handle type="target" position={Position.Bottom} id="gnd" className="w-3 h-3 bg-black" />
    </div>
  );
}
