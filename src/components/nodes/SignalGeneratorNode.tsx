import { Handle, Position, useReactFlow } from '@xyflow/react';
import { AlertCircle } from 'lucide-react';
import type { NodePropertiesProps } from './registry';
import { useCallback } from 'react';
import { DEVICE_CARD, DEVICE_SCREEN, DEVICE_TITLE, DeviceField, STROKE, resolveOrientation } from './schematic';

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

/** One cycle of the selected waveform, drawn to fill the node's screen area. */
function WaveformPath({ type }: { type: string }) {
  const d = type === 'square'
    ? 'M 2 18 H 12 V 6 H 26 V 18 H 40 V 6 H 50 V 18 H 62'
    : 'M 2 12 C 8 2, 14 2, 20 12 S 32 22, 38 12 S 50 2, 56 12 L 62 12';
  return (
    <path
      d={d}
      fill="none"
      strokeWidth={STROKE.line}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="stroke-slate-700 dark:stroke-slate-200"
    />
  );
}

export function SignalGeneratorNode({ id, data }: any) {
  const { isVertical } = resolveOrientation(data.orientation);
  const { setNodes } = useReactFlow();
  const type = data.waveform || 'sine';
  // `??`, not `||`: 0V and 0Hz are values someone can scrub to, and `||` sent
  // the field springing back to the default the moment it reached zero.
  const freq = data.frequency ?? 1;
  const amp = data.amplitude ?? 5;

  const update = useCallback((patch: Record<string, any>) => {
    setNodes((nds: any[]) => nds.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
  }, [id, setNodes]);

  return (
    <div className={`${DEVICE_CARD} px-1.5 py-1 w-[88px] flex flex-col items-center gap-1 relative`}>
      <div className={DEVICE_TITLE}>Sig Gen</div>

      {/* The waveform is the component's identity, and doubles as its toggle. */}
      <button
        type="button"
        title={`Waveform: ${type} (click to switch)`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => update({ waveform: type === 'square' ? 'sine' : 'square' })}
        className={`nodrag nopan ${DEVICE_SCREEN} w-full h-[22px] flex items-center justify-center
                    hover:border-emerald-400 dark:hover:border-emerald-600 transition-colors`}
      >
        <svg width="64" height="24" viewBox="0 0 64 24" style={{ overflow: 'visible' }}>
          <WaveformPath type={type} />
        </svg>
      </button>

      <div className="flex items-baseline justify-between w-full px-[1px]">
        <DeviceField
          value={amp}
          unit="V"
          step={0.1}
          title="Amplitude"
          onCommit={(v) => update({ amplitude: v })}
        />
        <DeviceField
          value={freq}
          unit="Hz"
          min={0}
          title="Frequency"
          onCommit={(v) => update({ frequency: v })}
        />
      </div>

      {/* The signal lead leaves sideways and ground drops down, which is how
          these read on a horizontal rail. Vertical puts the signal on top and
          ground at the bottom, for a part drawn on end. */}
      <Handle type="target" position={isVertical ? Position.Top : Position.Right} id="out" className="w-3 h-3 bg-emerald-500" />
      <Handle type="source" position={isVertical ? Position.Top : Position.Right} id="out" className="w-3 h-3 bg-emerald-500" />
      <Handle type="source" position={Position.Bottom} id="gnd" className="w-3 h-3 bg-black" style={isVertical ? { left: '50%' } : undefined} />
      <Handle type="target" position={Position.Bottom} id="gnd" className="w-3 h-3 bg-black" style={isVertical ? { left: '50%' } : undefined} />
    </div>
  );
}
