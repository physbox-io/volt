import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Waves } from 'lucide-react';
import { NumberInput } from '@physbox-io/ui';
import type { SpiceComplexResult } from '../types/simulation';
import {
  buildBodeTrace,
  cornerFrequencyHz,
  formatHz,
  type BodeTrace,
} from '../utils/analysisResults';

/**
 * A small-signal frequency sweep, drawn the way a filter is read.
 *
 * Nothing in the transient side of the app changes for this. Run still runs a
 * `.tran` of whatever length the status bar says, the canvas still animates,
 * and this is a second solve of the same circuit taken somewhere else — opened
 * on purpose, closed when it has answered, and holding no state the rest of the
 * app can see.
 *
 * Magnitude and phase are two panes and not two y-axes on one. A reader of a
 * dual-axis plot has to work out which curve belongs to which scale before they
 * can read either, and the gridlines of one are meaningless against the other.
 */

export type SweepSource = { id: string; label: string };
export type ProbePoint = { net: string; label: string };

export type SweepParams = {
  sourceNodeId: string;
  fStart: number;
  fStop: number;
  pointsPerDecade: number;
};

const MAG_COLOR = '#059669';   // emerald 600 — the app's signal colour
const MAG_COLOR_DARK = '#34d399';
const PHASE_COLOR = '#7c3aed'; // violet 600
const PHASE_COLOR_DARK = '#a78bfa';

const PAD = { left: 44, right: 12, top: 10, bottom: 20 };

type PaneProps = {
  title: string;
  unit: string;
  xs: number[];
  ys: number[];
  color: string;
  height: number;
  width: number;
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
  format: (v: number) => string;
};

/** One pane: log-frequency across, a linear measure up, one series. */
function BodePane({ title, unit, xs, ys, color, height, width, hoverIndex, onHover, format }: PaneProps) {
  const plotW = Math.max(10, width - PAD.left - PAD.right);
  const plotH = Math.max(10, height - PAD.top - PAD.bottom);

  const logs = useMemo(() => xs.map(f => Math.log10(Math.max(f, 1e-12))), [xs]);
  const lo = logs.length ? logs[0] : 0;
  const hi = logs.length ? logs[logs.length - 1] : 1;
  const span = hi - lo || 1;

  const { yMin, yMax } = useMemo(() => {
    if (ys.length === 0) return { yMin: -1, yMax: 1 };
    let min = Infinity, max = -Infinity;
    for (const y of ys) { if (y < min) min = y; if (y > max) max = y; }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { yMin: -1, yMax: 1 };
    const pad = Math.max((max - min) * 0.08, 1);
    return { yMin: min - pad, yMax: max + pad };
  }, [ys]);

  const x = useCallback((i: number) => PAD.left + ((logs[i] - lo) / span) * plotW, [logs, lo, span, plotW]);
  const y = useCallback(
    (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH,
    [plotH, yMin, yMax],
  );

  const path = useMemo(() => {
    if (xs.length === 0) return '';
    let d = '';
    for (let i = 0; i < ys.length; i++) d += `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)} ${y(ys[i]).toFixed(2)}`;
    return d;
  }, [xs.length, ys, x, y]);

  // A gridline per decade, which is the unit the axis is actually read in.
  const decades: number[] = [];
  for (let d = Math.ceil(lo); d <= Math.floor(hi); d++) decades.push(d);

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / ticks);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (logs.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const frac = (px - PAD.left) / plotW;
    const target = lo + frac * span;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < logs.length; i++) {
      const d = Math.abs(logs[i] - target);
      if (d < bestD) { bestD = d; best = i; }
    }
    onHover(best);
  };

  return (
    <div className="relative">
      <p className="px-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400">{title}</p>
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        className="block touch-none"
        onMouseMove={onMove}
        onMouseLeave={() => onHover(null)}
      >
        {/* Grid stays recessive — it is a ruler, not data. */}
        {decades.map(d => {
          const px = PAD.left + ((d - lo) / span) * plotW;
          return (
            <g key={`d${d}`}>
              <line x1={px} x2={px} y1={PAD.top} y2={PAD.top + plotH} className="stroke-slate-200 dark:stroke-slate-800" strokeWidth={1} />
              <text x={px} y={height - 6} textAnchor="middle" className="fill-slate-400 dark:fill-slate-500" fontSize={9}>
                {formatHz(10 ** d)}
              </text>
            </g>
          );
        })}
        {yTicks.map((t, i) => (
          <g key={`y${i}`}>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} className="stroke-slate-200 dark:stroke-slate-800" strokeWidth={1} />
            <text x={PAD.left - 5} y={y(t) + 3} textAnchor="end" className="fill-slate-400 dark:fill-slate-500" fontSize={9}>
              {format(t)}
            </text>
          </g>
        ))}

        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {hoverIndex !== null && hoverIndex < ys.length && (
          <g>
            <line
              x1={x(hoverIndex)} x2={x(hoverIndex)} y1={PAD.top} y2={PAD.top + plotH}
              className="stroke-slate-400 dark:stroke-slate-500" strokeWidth={1} strokeDasharray="3 3"
            />
            <circle cx={x(hoverIndex)} cy={y(ys[hoverIndex])} r={4} fill={color} className="stroke-white dark:stroke-slate-900" strokeWidth={2} />
          </g>
        )}
        <text x={PAD.left - 5} y={PAD.top - 1} textAnchor="end" className="fill-slate-400 dark:fill-slate-500" fontSize={8}>{unit}</text>
      </svg>
    </div>
  );
}

export function BodePanel({
  sources,
  probePoints,
  runSweep,
  onClose,
  darkMode,
}: {
  sources: SweepSource[];
  probePoints: ProbePoint[];
  runSweep: (params: SweepParams) => Promise<SpiceComplexResult>;
  onClose: () => void;
  darkMode: boolean;
}) {
  const [sourceNodeId, setSourceNodeId] = useState(sources[0]?.id ?? '');
  const [fStart, setFStart] = useState(10);
  const [fStop, setFStop] = useState(1e6);
  const [pointsPerDecade, setPointsPerDecade] = useState(25);
  const [outputNet, setOutputNet] = useState(probePoints[0]?.net ?? '');
  const [result, setResult] = useState<SpiceComplexResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const runSeq = useRef(0);

  /*
   * The selections follow the circuit when it changes underneath them —
   * during render rather than from an effect, so the panel never draws a source
   * or a probe point that is no longer on the canvas.
   */
  if (sources.length > 0 && !sources.some(s => s.id === sourceNodeId)) {
    setSourceNodeId(sources[0].id);
  }
  if (probePoints.length > 0 && !probePoints.some(p => p.net === outputNet)) {
    setOutputNet(probePoints[0].net);
  }

  const sweep = useCallback(async () => {
    if (!sourceNodeId) return;
    const seq = ++runSeq.current;
    setBusy(true);
    setError(null);
    try {
      const res = await runSweep({ sourceNodeId, fStart, fStop, pointsPerDecade });
      if (seq !== runSeq.current) return;
      setResult(res);
    } catch (err) {
      if (seq !== runSeq.current) return;
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === runSeq.current) setBusy(false);
    }
  }, [runSweep, sourceNodeId, fStart, fStop, pointsPerDecade]);

  // The sweep on opening, so the panel answers rather than asking. Deliberately
  // not re-run as the circuit is edited: a frequency sweep is a measurement
  // someone set up, and re-taking it under them while they read it is worse
  // than a Sweep button they press when they mean it.
  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current || !sourceNodeId) return;
    openedRef.current = true;
    void sweep();
  }, [sweep, sourceNodeId]);

  const trace: BodeTrace | null = useMemo(
    () => (outputNet ? buildBodeTrace(result, outputNet) : null),
    [result, outputNet],
  );
  const corner = useMemo(() => cornerFrequencyHz(trace), [trace]);

  const magColor = darkMode ? MAG_COLOR_DARK : MAG_COLOR;
  const phaseColor = darkMode ? PHASE_COLOR_DARK : PHASE_COLOR;

  const readout =
    trace && hoverIndex !== null && hoverIndex < trace.freqHz.length
      ? `${formatHz(trace.freqHz[hoverIndex])} · ${trace.magDb[hoverIndex].toFixed(1)} dB · ${trace.phaseDeg[hoverIndex].toFixed(0)}°`
      : null;

  const selectClass =
    'text-[11px] border border-slate-300 dark:border-slate-700 rounded px-1.5 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:border-emerald-500 focus:outline-none cursor-pointer';

  return createPortal(
    <div className="fixed bottom-12 right-4 max-lg:left-1/2 max-lg:right-auto max-lg:-translate-x-1/2 z-[105] w-[34rem] max-w-[94vw] rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <Waves className="w-4 h-4 text-violet-600 dark:text-violet-400" />
          <p className="text-xs font-bold text-slate-800 dark:text-slate-100">Frequency response</p>
          {corner !== null && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800">
              −3dB at {formatHz(corner)}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer px-1" title="Close">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-slate-100 dark:border-slate-800">
        <label className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
          Drive
          <select value={sourceNodeId} onChange={e => setSourceNodeId(e.target.value)} className={selectClass}>
            {sources.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
          Measure
          <select value={outputNet} onChange={e => setOutputNet(e.target.value)} className={selectClass}>
            {probePoints.map(p => <option key={p.net} value={p.net}>{p.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
          From
          <NumberInput value={fStart} min={0.001} step={1} onChange={v => setFStart(Math.max(0.001, v))} className="w-16 text-[11px] border border-slate-300 dark:border-slate-700 rounded px-1 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200" />
          Hz
        </label>
        <label className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
          to
          <NumberInput value={fStop} min={1} step={1} onChange={v => setFStop(Math.max(1, v))} className="w-20 text-[11px] border border-slate-300 dark:border-slate-700 rounded px-1 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200" />
          Hz
        </label>
        <label className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
          pts/dec
          <NumberInput value={pointsPerDecade} min={2} max={500} step={1} onChange={v => setPointsPerDecade(Math.max(2, Math.min(500, v)))} className="w-14 text-[11px] border border-slate-300 dark:border-slate-700 rounded px-1 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200" />
        </label>
        <button
          onClick={() => void sweep()}
          disabled={busy || !sourceNodeId}
          className="ml-auto px-2.5 py-1 rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-[11px] font-semibold cursor-pointer transition-colors"
        >
          {busy ? 'Sweeping…' : 'Sweep'}
        </button>
      </div>

      <div className="px-2 py-2">
        {sources.length === 0 ? (
          <p className="px-2 py-6 text-[11px] text-slate-500 dark:text-slate-400 text-center">
            A sweep needs something to drive. Add a signal generator, an AC source or a DC supply
            and it will be offered here — the source is replaced by a 1V small-signal stimulus for
            the sweep and put back afterwards.
          </p>
        ) : error ? (
          <p className="px-2 py-6 text-[11px] text-amber-700 dark:text-amber-400 text-center whitespace-pre-line">{error}</p>
        ) : !trace ? (
          <p className="px-2 py-6 text-[11px] text-slate-500 dark:text-slate-400 text-center">
            {busy ? 'Solving…' : 'Press Sweep to measure the response.'}
          </p>
        ) : (
          <>
            <BodePane
              title="Magnitude" unit="dB" xs={trace.freqHz} ys={trace.magDb} color={magColor}
              width={520} height={130} hoverIndex={hoverIndex} onHover={setHoverIndex}
              format={v => v.toFixed(0)}
            />
            <BodePane
              title="Phase" unit="deg" xs={trace.freqHz} ys={trace.phaseDeg} color={phaseColor}
              width={520} height={110} hoverIndex={hoverIndex} onHover={setHoverIndex}
              format={v => v.toFixed(0)}
            />
            <p className="px-1 pt-1 text-[10px] font-mono text-slate-500 dark:text-slate-400 h-4">
              {readout ?? ''}
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
