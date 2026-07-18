import { Handle, Position, NodeResizer } from '@xyflow/react';
import { useMemo } from 'react';
import { computeFFT } from '../../utils/fft';
import type { NodePropertiesProps } from './registry';

export function ScopeProperties({ node, updateData }: NodePropertiesProps) {
  return (
    <>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">V/div</label>
        <input type="number" step="0.1" min="0.01" value={(node.data.vDiv as number) ?? ''} onChange={e => updateData('vDiv', e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="Auto" className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
        <div className="text-[10px] text-gray-400 mt-0.5">Leave empty for auto-detect</div>
      </div>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">Time/div (ms)</label>
        <input type="number" step="0.1" min="0.001" value={(node.data.tDiv as number) ?? ''} onChange={e => updateData('tDiv', e.target.value ? parseFloat(e.target.value) : undefined)} placeholder="Auto" className="w-full text-sm border border-gray-300 rounded px-2 py-1" />
        <div className="text-[10px] text-gray-400 mt-0.5">Leave empty for auto-detect</div>
      </div>
      <div className="mb-3 flex items-center gap-2">
        <input type="checkbox" id="scope-fft" checked={!!node.data.showFFT} onChange={e => updateData('showFFT', e.target.checked)} />
        <label htmlFor="scope-fft" className="text-xs font-medium text-gray-700">FFT Mode (Frequency Spectrum)</label>
      </div>
    </>
  );
}

// Standard V/div values
const VDIV_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
const TDIV_STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500]; // ms

function pickStep(range: number, divs: number, steps: number[]): number {
  const idealDiv = range / divs;
  for (const s of steps) {
    if (s >= idealDiv) return s;
  }
  return steps[steps.length - 1];
}

export function ScopeNode({ data, selected }: any) {
  const points1: { t: number; v: number }[] = data.voltageData1 || data.voltageData || [];
  const points2: { t: number; v: number }[] = data.voltageData2 || [];
  const showFFT = data.showFFT || false;

  const width = data.width ?? 240;
  const height = data.height ?? 160;

  // Compute auto V/div and time/div from data
  const { autoVDiv, autoTDiv } = useMemo(() => {
    const allV = [...points1.map(p => p.v), ...points2.map(p => p.v)];
    const allT = [...points1.map(p => p.t), ...points2.map(p => p.t)];
    const vRange = allV.length > 0 ? Math.max(...allV) - Math.min(...allV) : 10;
    const tRange = allT.length > 0 ? Math.max(...allT) : 1000;
    return {
      autoVDiv: pickStep(Math.max(vRange, 0.1), 4, VDIV_STEPS),
      autoTDiv: pickStep(Math.max(tRange, 0.1), 10, TDIV_STEPS),
    };
  }, [points1, points2]);

  const vDiv = data.vDiv ?? autoVDiv;
  const tDiv = data.tDiv ?? autoTDiv;

  // FFT computation
  const fftBins = useMemo(() => {
    if (!showFFT || points1.length < 4) return [];
    const dt = points1.length > 1 ? (points1[points1.length - 1].t - points1[0].t) / (points1.length - 1) : 1;
    const sampleRate = 1000 / dt; // dt is in ms
    return computeFFT(points1.map(p => p.v), sampleRate);
  }, [showFFT, points1]);

  // Time-domain polyline generator
  const getPolyline = (points: { t: number; v: number }[], color: string) => {
    if (points.length === 0) return null;
    const totalV = vDiv * 4; // 4 vertical divisions
    const vCenter = (() => {
      const allV = [...points1.map(p => p.v), ...points2.map(p => p.v)];
      return allV.length > 0 ? (Math.max(...allV) + Math.min(...allV)) / 2 : 0;
    })();
    const minV = vCenter - totalV / 2;
    const maxT = tDiv * 10; // 10 horizontal divisions

    const pts = points
      .filter(p => p.t <= maxT)
      .map(p => {
        const x = (p.t / maxT) * 100;
        let y = 60 - ((p.v - minV) / totalV) * 60;
        if (y < 0) y = 0;
        if (y > 60) y = 60;
        return `${x},${y}`;
      }).join(' ');
    return <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />;
  };

  // FFT polyline
  const fftPolyline = useMemo(() => {
    if (fftBins.length === 0) return null;
    const maxFreq = fftBins[fftBins.length - 1].freq;
    const maxMag = Math.max(...fftBins.map(b => b.mag));
    const minMag = maxMag - 80; // 80dB dynamic range
    return (
      <polyline
        points={fftBins.map(b => {
          const x = (b.freq / maxFreq) * 100;
          let y = 60 - ((b.mag - minMag) / (maxMag - minMag)) * 60;
          if (y < 0) y = 0;
          if (y > 60) y = 60;
          return `${x},${y}`;
        }).join(' ')}
        fill="none" stroke="#a78bfa" strokeWidth="1.5"
      />
    );
  }, [fftBins]);

  const hasData = points1.length > 0 || points2.length > 0;

  return (
    <div
      className="bg-gray-800 border-2 border-gray-900 rounded-md p-1 flex flex-col items-center relative shadow-lg"
      style={{ width, height }}
    >
      <NodeResizer
        minWidth={160}
        minHeight={120}
        isVisible={selected}
        lineClassName="!border-indigo-400"
        handleClassName="!w-2 !h-2 !bg-indigo-400 !border-indigo-600"
        onResize={(_e: any, params: any) => {
          if (data.onResize) data.onResize(params.width, params.height);
        }}
      />

      {/* Header */}
      <div className="text-[10px] text-gray-300 w-full text-center font-mono border-b border-gray-700 pb-0.5 px-1 flex justify-between items-center" style={{ minHeight: 18 }}>
        <span className="text-yellow-400">CH1</span>
        <span className="flex items-center gap-1">
          {showFFT ? 'FFT' : 'Scope'}
          <span className="text-[8px] text-gray-500">
            {showFFT ? '' : `${vDiv >= 1 ? vDiv + 'V' : (vDiv * 1000).toFixed(0) + 'mV'}/div ${tDiv >= 1 ? tDiv + 'ms' : (tDiv * 1000).toFixed(0) + 'µs'}/div`}
          </span>
        </span>
        <span className="text-cyan-400">CH2</span>
      </div>

      {/* Plot area */}
      <div className="bg-black w-full flex-1 rounded border border-gray-600 overflow-hidden relative flex items-center justify-center">
        {/* Grid */}
        <svg width="100%" height="100%" viewBox="0 0 100 60" preserveAspectRatio="none" className="absolute inset-0 opacity-20">
          <line x1="0" y1="30" x2="100" y2="30" stroke="white" strokeWidth="0.5" />
          <line x1="50" y1="0" x2="50" y2="60" stroke="white" strokeWidth="0.5" />
          <line x1="0" y1="15" x2="100" y2="15" stroke="white" strokeWidth="0.2" />
          <line x1="0" y1="45" x2="100" y2="45" stroke="white" strokeWidth="0.2" />
          <line x1="25" y1="0" x2="25" y2="60" stroke="white" strokeWidth="0.2" />
          <line x1="75" y1="0" x2="75" y2="60" stroke="white" strokeWidth="0.2" />
        </svg>

        {hasData ? (
          <svg width="100%" height="100%" viewBox="0 0 100 60" preserveAspectRatio="none" className="relative z-10">
            {showFFT ? fftPolyline : (
              <>
                {getPolyline(points1, "#facc15")}
                {getPolyline(points2, "#22d3ee")}
              </>
            )}
          </svg>
        ) : (
          <span className="text-gray-500 text-[8px] uppercase tracking-wider">No Data</span>
        )}
      </div>

      {/* Handles */}
      <Handle type="target" position={Position.Left} id="ch1" className="w-3 h-3 bg-yellow-400" style={{ top: '30%' }} />
      <Handle type="source" position={Position.Left} id="ch1" className="w-3 h-3 bg-yellow-400" style={{ top: '30%' }} />
      <Handle type="target" position={Position.Left} id="ch2" className="w-3 h-3 bg-cyan-400" style={{ top: '60%' }} />
      <Handle type="source" position={Position.Left} id="ch2" className="w-3 h-3 bg-cyan-400" style={{ top: '60%' }} />
      <Handle type="target" position={Position.Left} id="gnd" className="w-3 h-3 bg-gray-500" style={{ top: '90%' }} />
      <Handle type="source" position={Position.Left} id="gnd" className="w-3 h-3 bg-gray-500" style={{ top: '90%' }} />
    </div>
  );
}
