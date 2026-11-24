import { Handle, Position, NodeResizer, useReactFlow } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import { memo, useCallback, useMemo } from 'react';
import { computeFFT } from '../../utils/fft';
import { detectPeriod } from '../../utils/periodDetect';
import type { NodePropertiesProps } from './registry';
import { DEVICE_CARD_DARK, pinRow } from './schematicStyle';
import { NumberInput } from '@physbox-io/ui';
import type { PwlPoint, ScopeNodeData } from '../../types/nodes';

export function ScopeProperties({ node, updateData }: NodePropertiesProps) {
  return (
    <>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">V/div</label>
        <NumberInput
          allowEmpty
          step={0.1}
          min={0.01}
          value={Number.isFinite(node.data.vDiv as number) ? (node.data.vDiv as number) : null}
          onChange={v => updateData('vDiv', v ?? undefined)}
          placeholder="Auto"
          className="w-full text-sm border border-gray-300 rounded px-2 py-1"
        />
        <div className="text-[10px] text-gray-400 mt-0.5">Leave empty for auto-detect</div>
      </div>
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">Time/div (ms)</label>
        <NumberInput
          allowEmpty
          step={0.1}
          min={0.001}
          value={Number.isFinite(node.data.tDiv as number) ? (node.data.tDiv as number) : null}
          onChange={v => updateData('tDiv', v ?? undefined)}
          placeholder="Auto"
          className="w-full text-sm border border-gray-300 rounded px-2 py-1"
        />
        <div className="text-[10px] text-gray-400 mt-0.5">Leave empty for auto-detect</div>
      </div>
      <div className="mb-3 flex items-center gap-2">
        <input type="checkbox" id="scope-fft" checked={!!node.data.showFFT} onChange={e => updateData('showFFT', e.target.checked)} />
        <label htmlFor="scope-fft" className="text-xs font-medium text-gray-700">FFT Mode (Frequency Spectrum)</label>
      </div>
      <div className="mb-3 flex items-center gap-2">
        <input type="checkbox" id="scope-period" checked={node.data.showPeriod !== false} onChange={e => updateData('showPeriod', e.target.checked)} />
        <label htmlFor="scope-period" className="text-xs font-medium text-gray-700">Auto-detect period/frequency</label>
      </div>
    </>
  );
}

// Standard V/div values
const VDIV_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
const TDIV_STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500]; // ms

function formatPeriod(ms: number): string {
  return ms >= 1 ? `${ms.toFixed(ms >= 100 ? 0 : 2)}ms` : `${(ms * 1000).toFixed(1)}µs`;
}

function formatFreq(hz: number): string {
  if (hz >= 1000) return `${(hz / 1000).toFixed(2)}kHz`;
  return `${hz.toFixed(hz >= 10 ? 1 : 3)}Hz`;
}

function pickStep(range: number, divs: number, steps: number[]): number {
  const idealDiv = range / divs;
  for (const s of steps) {
    if (s >= idealDiv) return s;
  }
  return steps[steps.length - 1];
}

const MAX_SCOPE_SVG_POINTS = 400;

function buildScopePolylinePoints(
  points: PwlPoint[],
  vCenter: number,
  vDiv: number,
  tDiv: number
): string | null {
  if (points.length === 0) return null;
  const totalV = vDiv * 4;
  const minV = vCenter - totalV / 2;
  const maxT = tDiv * 10;

  let visibleCount = 0;
  for (let i = 0; i < points.length; i++) {
    if (points[i].t <= maxT) visibleCount++;
  }
  if (visibleCount === 0) return null;

  const stride = Math.max(1, Math.floor(visibleCount / MAX_SCOPE_SVG_POINTS));
  const out: string[] = [];
  let seen = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.t > maxT) continue;
    if (seen % stride === 0 || seen === visibleCount - 1) {
      const x = (p.t / maxT) * 100;
      let y = 60 - ((p.v - minV) / totalV) * 60;
      if (y < 0) y = 0;
      else if (y > 60) y = 60;
      out.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    seen++;
  }
  return out.join(' ');
}

export const ScopeNode = memo(function ScopeNode({ id, data, selected }: NodeProps<Node<ScopeNodeData>>) {
  const { setNodes } = useReactFlow();
  const onResizeEnd = useCallback((w: number, h: number) => {
    setNodes(nds => nds.map(n => (n.id === id ? { ...n, data: { ...n.data, width: w, height: h } } : n)));
  }, [id, setNodes]);

  const points1 = useMemo<PwlPoint[]>(
    () => data.voltageData1 || data.voltageData || [],
    [data.voltageData1, data.voltageData],
  );
  const points2 = useMemo<PwlPoint[]>(() => data.voltageData2 || [], [data.voltageData2]);
  const showFFT = data.showFFT || false;

  const width = data.width ?? 240;
  const height = data.height ?? 160;

  // Compute auto V/div, time/div, and vCenter in a single pass without
  // variadic Math.max(...arr) spread (which overflows the stack on large traces).
  const { autoVDiv, autoTDiv, vCenter } = useMemo(() => {
    let minV = Infinity;
    let maxV = -Infinity;
    let maxT = -Infinity;
    for (let i = 0; i < points1.length; i++) {
      const p = points1[i];
      if (p.v < minV) minV = p.v;
      if (p.v > maxV) maxV = p.v;
      if (p.t > maxT) maxT = p.t;
    }
    for (let i = 0; i < points2.length; i++) {
      const p = points2[i];
      if (p.v < minV) minV = p.v;
      if (p.v > maxV) maxV = p.v;
      if (p.t > maxT) maxT = p.t;
    }
    const hasV = Number.isFinite(minV);
    const vRange = hasV ? maxV - minV : 10;
    const tRange = Number.isFinite(maxT) ? maxT : 1000;
    return {
      autoVDiv: pickStep(Math.max(vRange, 0.1), 4, VDIV_STEPS),
      autoTDiv: pickStep(Math.max(tRange, 0.1), 10, TDIV_STEPS),
      vCenter: hasV ? (maxV + minV) / 2 : 0,
    };
  }, [points1, points2]);

  const vDiv = data.vDiv ?? autoVDiv;
  const tDiv = data.tDiv ?? autoTDiv;

  const showPeriod = data.showPeriod !== false;
  const periodEstimate = useMemo(() => {
    if (!showPeriod || showFFT) return null;
    return detectPeriod(points1.length >= 8 ? points1 : points2);
  }, [showPeriod, showFFT, points1, points2]);

  // FFT computation — resample non-uniform SPICE timesteps onto a uniform power-of-2 grid first.
  const fftBins = useMemo(() => {
    if (!showFFT || points1.length < 4) return [];
    const t0 = points1[0].t;
    const t1 = points1[points1.length - 1].t;
    const span = t1 - t0;
    if (!(span > 0)) return [];

    let numSamples = 1;
    while (numSamples < points1.length && numSamples < 4096) numSamples <<= 1;
    const dt = span / (numSamples - 1);
    const uniform = new Array<number>(numSamples);
    let j = 0;
    for (let i = 0; i < numSamples; i++) {
      const t = t0 + i * dt;
      while (j < points1.length - 2 && points1[j + 1].t < t) j++;
      const a = points1[j];
      const b = points1[j + 1] ?? a;
      const frac = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
      uniform[i] = a.v + (b.v - a.v) * frac;
    }

    const sampleRate = 1000 / dt; // dt is in ms
    return computeFFT(uniform, sampleRate);
  }, [showFFT, points1]);

  const polyline1Pts = useMemo(
    () => (showFFT ? null : buildScopePolylinePoints(points1, vCenter, vDiv, tDiv)),
    [showFFT, points1, vCenter, vDiv, tDiv]
  );
  const polyline2Pts = useMemo(
    () => (showFFT ? null : buildScopePolylinePoints(points2, vCenter, vDiv, tDiv)),
    [showFFT, points2, vCenter, vDiv, tDiv]
  );

  // FFT polyline
  const fftPolyline = useMemo(() => {
    if (fftBins.length === 0) return null;
    const maxFreq = fftBins[fftBins.length - 1].freq;
    let maxMag = -Infinity;
    for (let i = 0; i < fftBins.length; i++) {
      if (fftBins[i].mag > maxMag) maxMag = fftBins[i].mag;
    }
    const minMag = maxMag - 80; // 80dB dynamic range
    return (
      <polyline
        points={fftBins.map(b => {
          const x = (b.freq / maxFreq) * 100;
          let y = 60 - ((b.mag - minMag) / (maxMag - minMag)) * 60;
          if (y < 0) y = 0;
          if (y > 60) y = 60;
          return `${x.toFixed(2)},${y.toFixed(2)}`;
        }).join(' ')}
        fill="none" stroke="#a78bfa" strokeWidth="1.5"
      />
    );
  }, [fftBins]);

  const hasData = points1.length > 0 || points2.length > 0;

  return (
    <div
      className={`${DEVICE_CARD_DARK} p-1 flex flex-col items-center relative`}
      style={{ width, height }}
    >
      <NodeResizer
        minWidth={160}
        minHeight={120}
        isVisible={selected}
        lineClassName="!border-indigo-400"
        handleClassName="!w-2 !h-2 !bg-indigo-400 !border-indigo-600"
        onResizeEnd={(_e, params) => onResizeEnd(params.width, params.height)}
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
                {polyline1Pts && <polyline points={polyline1Pts} fill="none" stroke="#facc15" strokeWidth="1.5" />}
                {polyline2Pts && <polyline points={polyline2Pts} fill="none" stroke="#22d3ee" strokeWidth="1.5" />}
              </>
            )}
          </svg>
        ) : (
          <span className="text-gray-500 text-[8px] uppercase tracking-wider">No Data</span>
        )}

        {periodEstimate && (
          <div className="absolute bottom-0.5 left-1 z-20 text-[8px] font-mono text-lime-400 bg-black/40 px-1 rounded leading-tight pointer-events-none">
            T: {formatPeriod(periodEstimate.periodMs)} &nbsp;f: {formatFreq(periodEstimate.freqHz)}
          </div>
        )}
      </div>

      {/* Handles */}
      {/*
        Pin rows are placed in pixels, not percentages. The card's height is
        content-driven and not a round number, so `30%` resolved to 48.39px —
        off the 4px snap grid, and impossible for a neighbour's pin to meet.
      */}
      <Handle type="target" position={Position.Left} id="ch1" className="w-3 h-3 bg-yellow-400" style={{ top: pinRow(48) }} />
      <Handle type="source" position={Position.Left} id="ch1" className="w-3 h-3 bg-yellow-400" style={{ top: pinRow(48) }} />
      <Handle type="target" position={Position.Left} id="ch2" className="w-3 h-3 bg-cyan-400" style={{ top: pinRow(96) }} />
      <Handle type="source" position={Position.Left} id="ch2" className="w-3 h-3 bg-cyan-400" style={{ top: pinRow(96) }} />
      <Handle type="target" position={Position.Left} id="gnd" className="w-3 h-3 bg-gray-500" style={{ top: pinRow(144) }} />
      <Handle type="source" position={Position.Left} id="gnd" className="w-3 h-3 bg-gray-500" style={{ top: pinRow(144) }} />
    </div>
  );
});
