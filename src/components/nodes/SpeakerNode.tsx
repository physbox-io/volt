import { Handle, Position } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import type { NodePropertiesProps } from './registry';
import { DEVICE_CARD, resolveOrientation } from './schematic';


export function SpeakerProperties({ node, updateData }: NodePropertiesProps) {
  return (
    <>
      <div className="mb-3">
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Output Target</label>
        <select 
          value={(node.data.outputTarget as string) ?? 'computer'} 
          onChange={e => updateData('outputTarget', e.target.value)} 
          className="w-full text-xs border border-gray-300 dark:border-slate-800 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:border-emerald-500 focus:outline-none"
        >
          <option value="computer">💻 Computer Speaker</option>
          <option value="cyd">📟 CYD Speaker (HIL)</option>
        </select>
      </div>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 dark:text-slate-400 mb-1">Voltage Scale (V)</label>
        <input type="number" step="1" min="0.1" value={(node.data.voltageScale as number) ?? 5} onChange={e => updateData('voltageScale', parseFloat(e.target.value) || 5)} className="w-full text-sm border border-gray-300 dark:border-slate-800 rounded px-2 py-1 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:border-emerald-500 focus:outline-none" />
        <div className="text-[10px] text-gray-400 mt-1">Full-scale voltage (±V maps to ±1.0 audio)</div>
      </div>
      <div className="mb-2 flex items-center gap-2">
        <input type="checkbox" id="spk-ac" checked={!!node.data.acCouple} onChange={e => updateData('acCouple', e.target.checked)} />
        <label htmlFor="spk-ac" className="text-xs text-gray-700 dark:text-slate-300">AC Couple (remove DC offset)</label>
      </div>
      <div className="mb-2 flex items-center gap-2">
        <input type="checkbox" id="spk-norm" checked={!!node.data.normalize} onChange={e => updateData('normalize', e.target.checked)} />
        <label htmlFor="spk-norm" className="text-xs text-gray-700 dark:text-slate-300">Auto-normalize volume</label>
      </div>
    </>
  );
}

export function SpeakerNode({ data }: any) {
  const { isVertical } = resolveOrientation(data.orientation);
  const audioCtx = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (data.voltageData && data.voltageData.length > 0 && data.outputTarget !== 'cyd') {
      if (!audioCtx.current) {
        audioCtx.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtx.current;
      if (ctx.state === 'suspended') ctx.resume();

      const sampleRate = ctx.sampleRate;
      const durationSec = data.voltageData[data.voltageData.length - 1].t / 1000;
      const frameCount = Math.max(1, Math.floor(sampleRate * durationSec));
      const buffer = ctx.createBuffer(1, frameCount, sampleRate);
      const channelData = buffer.getChannelData(0);

      // Interpolate SPICE data to audio sample rate using Cubic Hermite
      const rawSamples = new Float32Array(frameCount);
      let dataIdx = 0;
      for (let i = 0; i < frameCount; i++) {
        const t_ms = (i / sampleRate) * 1000;
        
        while (dataIdx < data.voltageData.length - 2 && data.voltageData[dataIdx + 1].t < t_ms) {
          dataIdx++;
        }
        
        const p0 = data.voltageData[Math.max(0, dataIdx - 1)];
        const p1 = data.voltageData[dataIdx];
        const p2 = data.voltageData[Math.min(data.voltageData.length - 1, dataIdx + 1)];
        const p3 = data.voltageData[Math.min(data.voltageData.length - 1, dataIdx + 2)];
        
        let v = p1.v;
        if (p2.t > p1.t) {
          const t = Math.max(0, Math.min(1, (t_ms - p1.t) / (p2.t - p1.t)));
          const t2 = t * t;
          const t3 = t2 * t;
          const m1 = (p2.v - p0.v) / (p2.t - p0.t || 1);
          const m2 = (p3.v - p1.v) / (p3.t - p1.t || 1);
          const dt = p2.t - p1.t;
          const h00 = 2 * t3 - 3 * t2 + 1;
          const h10 = t3 - 2 * t2 + t;
          const h01 = -2 * t3 + 3 * t2;
          const h11 = t3 - t2;
          v = h00 * p1.v + h10 * dt * m1 + h01 * p2.v + h11 * dt * m2;
        }
        rawSamples[i] = v;
      }

      // Optional AC coupling: remove DC offset
      let dcOffset = 0;
      if (data.acCouple) {
        let sum = 0;
        for (let i = 0; i < frameCount; i++) sum += rawSamples[i];
        dcOffset = sum / frameCount;
      }

      // Optional auto-normalize: scale peak to 0.8
      let scale = 1.0 / (data.voltageScale ?? 5.0); // default: divide by 5V
      if (data.normalize) {
        let peak = 0;
        for (let i = 0; i < frameCount; i++) {
          const ac = Math.abs(rawSamples[i] - dcOffset);
          if (ac > peak) peak = ac;
        }
        scale = peak > 0.001 ? 0.8 / peak : scale;
      }

      // Write to audio buffer — faithful to the simulation output
      for (let i = 0; i < frameCount; i++) {
        const v = (rawSamples[i] - dcOffset) * scale;
        channelData[i] = Math.max(-1, Math.min(1, v));
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(ctx.destination);
      source.start();
      
      return () => {
        try { source.stop(); } catch (e) {}
      };
    }
  }, [data.voltageData, data.acCouple, data.normalize, data.voltageScale, data.outputTarget]);

  const isCyd = data.outputTarget === 'cyd';

  return (
    <div className={`${DEVICE_CARD} ${isCyd ? '!border-emerald-500' : ''} p-1 w-12 h-12 flex flex-col items-center justify-center relative`}>
      {/* The signal lead leaves sideways and ground drops down, which is how
          these read on a horizontal rail. Vertical puts the signal on top and
          ground at the bottom, for a part drawn on end. */}
      <Handle type="target" position={isVertical ? Position.Top : Position.Left} id="in" className="w-3 h-3 bg-emerald-500" />
      <Handle type="source" position={isVertical ? Position.Top : Position.Left} id="in" className="w-3 h-3 bg-emerald-500" />
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={isCyd ? '#3b82f6' : 'currentColor'} strokeWidth="1.4" className="text-slate-700 dark:text-slate-200">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      </svg>
      {isCyd && (
        <span className="text-[8px] font-bold text-emerald-600 mt-0.5 uppercase tracking-wider select-none">CYD</span>
      )}
      <Handle type="source" position={Position.Bottom} id="gnd" className="w-3 h-3 bg-black" style={isVertical ? { left: '50%' } : undefined} />
      <Handle type="target" position={Position.Bottom} id="gnd" className="w-3 h-3 bg-black" style={isVertical ? { left: '50%' } : undefined} />
    </div>
  );
}
