import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Waves, SlidersHorizontal } from 'lucide-react';
import { NumberInput } from '@physbox-io/ui';
import type { SpiceComplexResult, SpiceResult } from '../types/simulation';
import {
  buildBodeTrace,
  cornerFrequencyHz,
  formatHz,
  formatVolts,
  type BodeTrace,
} from '../utils/analysisResults';
import {
  buildTransientTrace,
  defaultSweepConfig,
  formatSweepValue,
  generateSweepValues,
  parseSweepValuesList,
  type SweepParamKind,
  type SweepScale,
  type SweepableTarget,
  type TransientTrace,
} from '../utils/parameterSweep';

/**
 * Frequency response (Bode) and multi-step parameter sweep panel.
 *
 * Nothing in the main transient canvas changes for this. Run still runs a
 * `.tran` of whatever length the status bar says, the canvas still animates,
 * and this is a separate measurement taken without mutating the schematic —
 * either a single AC sweep as drawn, or a family of AC / transient runs with
 * a chosen component stepped across a range or list of values.
 */

export type SweepSource = { id: string; label: string };
export type ProbePoint = { net: string; label: string };

export type StepOverride = {
  nodeId: string;
  param: SweepParamKind;
  value: number;
};

export type SweepParams = {
  sourceNodeId: string;
  fStart: number;
  fStop: number;
  pointsPerDecade: number;
  overrideStep?: StepOverride;
};

const MAG_COLOR = '#059669';   // emerald 600 — the app's signal colour
const MAG_COLOR_DARK = '#34d399';
const PHASE_COLOR = '#7c3aed'; // violet 600
const PHASE_COLOR_DARK = '#a78bfa';

const STEP_PALETTE_LIGHT = [
  '#059669', // emerald
  '#7c3aed', // violet
  '#0284c7', // sky
  '#d97706', // amber
  '#e11d48', // rose
  '#4f46e5', // indigo
  '#0d9488', // teal
  '#ea580c', // orange
];

const STEP_PALETTE_DARK = [
  '#34d399', // emerald
  '#a78bfa', // violet
  '#38bdf8', // sky
  '#fbbf24', // amber
  '#fb7185', // rose
  '#818cf8', // indigo
  '#2dd4bf', // teal
  '#fb923c', // orange
];

const PAD = { left: 46, right: 12, top: 10, bottom: 20 };

type SeriesItem = {
  label: string;
  color: string;
  xs: number[];
  ys: number[];
};

type PaneProps = {
  title: string;
  unit: string;
  series: SeriesItem[];
  logX?: boolean;
  height: number;
  width: number;
  hoverIndex: number | null;
  activeSeriesIndex: number | null;
  onHover: (index: number | null) => void;
  formatY: (v: number) => string;
  formatX: (v: number) => string;
};

/** One pane: log-frequency or linear-time across, a linear measure up, one or many series. */
function SweepPane({
  title,
  unit,
  series,
  logX = true,
  height,
  width,
  hoverIndex,
  activeSeriesIndex,
  onHover,
  formatY,
  formatX,
}: PaneProps) {
  const plotW = Math.max(10, width - PAD.left - PAD.right);
  const plotH = Math.max(10, height - PAD.top - PAD.bottom);

  const primaryXs = useMemo(() => series[0]?.xs ?? [], [series]);
  const transformedXs = useMemo(
    () => (logX ? primaryXs.map(f => Math.log10(Math.max(f, 1e-12))) : primaryXs),
    [primaryXs, logX],
  );
  const lo = transformedXs.length ? transformedXs[0] : 0;
  const hi = transformedXs.length ? transformedXs[transformedXs.length - 1] : 1;
  const span = hi - lo || 1;

  const { yMin, yMax } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const s of series) {
      for (const y of s.ys) {
        if (y < min) min = y;
        if (y > max) max = y;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { yMin: -1, yMax: 1 };
    const pad = Math.max((max - min) * 0.08, logX ? 1 : 0.05);
    return { yMin: min - pad, yMax: max + pad };
  }, [series, logX]);

  const xAtVal = useCallback(
    (rawX: number) => {
      const tx = logX ? Math.log10(Math.max(rawX, 1e-12)) : rawX;
      return PAD.left + ((tx - lo) / span) * plotW;
    },
    [logX, lo, span, plotW],
  );

  const y = useCallback(
    (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH,
    [plotH, yMin, yMax],
  );

  const paths = useMemo(
    () =>
      series.map(s => {
        if (s.xs.length === 0 || s.ys.length === 0) return '';
        let d = '';
        const n = Math.min(s.xs.length, s.ys.length);
        for (let i = 0; i < n; i++) {
          d += `${i === 0 ? 'M' : 'L'}${xAtVal(s.xs[i]).toFixed(2)} ${y(s.ys[i]).toFixed(2)}`;
        }
        return d;
      }),
    [series, xAtVal, y],
  );

  const xGrid = useMemo(() => {
    if (logX) {
      const decades: { px: number; label: string }[] = [];
      for (let d = Math.ceil(lo); d <= Math.floor(hi); d++) {
        decades.push({
          px: PAD.left + ((d - lo) / span) * plotW,
          label: formatX(10 ** d),
        });
      }
      return decades;
    }
    const ticks = 4;
    return Array.from({ length: ticks + 1 }, (_, i) => {
      const val = lo + (span * i) / ticks;
      return {
        px: PAD.left + (i / ticks) * plotW,
        label: formatX(val),
      };
    });
  }, [logX, lo, hi, span, plotW, formatX]);

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / ticks);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (transformedXs.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const frac = (px - PAD.left) / plotW;
    const target = lo + frac * span;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < transformedXs.length; i++) {
      const d = Math.abs(transformedXs[i] - target);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    onHover(best);
  };

  const hoverX =
    hoverIndex !== null && hoverIndex < primaryXs.length ? xAtVal(primaryXs[hoverIndex]) : null;

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
        {xGrid.map((g, idx) => (
          <g key={`x${idx}`}>
            <line
              x1={g.px}
              x2={g.px}
              y1={PAD.top}
              y2={PAD.top + plotH}
              className="stroke-slate-200 dark:stroke-slate-800"
              strokeWidth={1}
            />
            <text
              x={g.px}
              y={height - 6}
              textAnchor="middle"
              className="fill-slate-400 dark:fill-slate-500"
              fontSize={9}
            >
              {g.label}
            </text>
          </g>
        ))}
        {yTicks.map((t, i) => (
          <g key={`y${i}`}>
            <line
              x1={PAD.left}
              x2={PAD.left + plotW}
              y1={y(t)}
              y2={y(t)}
              className="stroke-slate-200 dark:stroke-slate-800"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 5}
              y={y(t) + 3}
              textAnchor="end"
              className="fill-slate-400 dark:fill-slate-500"
              fontSize={9}
            >
              {formatY(t)}
            </text>
          </g>
        ))}

        {paths.map((d, idx) => {
          const isHighlighted = activeSeriesIndex === null || activeSeriesIndex === idx;
          return (
            <path
              key={series[idx].label + idx}
              d={d}
              fill="none"
              stroke={series[idx].color}
              strokeWidth={activeSeriesIndex === idx ? 2.6 : 1.9}
              strokeOpacity={isHighlighted ? 1 : 0.25}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}

        {hoverIndex !== null && hoverX !== null && (
          <g>
            <line
              x1={hoverX}
              x2={hoverX}
              y1={PAD.top}
              y2={PAD.top + plotH}
              className="stroke-slate-400 dark:stroke-slate-500"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            {series.map((s, idx) => {
              if (hoverIndex >= s.ys.length) return null;
              const isHighlighted = activeSeriesIndex === null || activeSeriesIndex === idx;
              return (
                <circle
                  key={`pt-${idx}`}
                  cx={hoverX}
                  cy={y(s.ys[hoverIndex])}
                  r={activeSeriesIndex === idx ? 4.5 : 3.5}
                  fill={s.color}
                  fillOpacity={isHighlighted ? 1 : 0.35}
                  className="stroke-white dark:stroke-slate-900"
                  strokeWidth={1.5}
                />
              );
            })}
          </g>
        )}
        <text
          x={PAD.left - 5}
          y={PAD.top - 1}
          textAnchor="end"
          className="fill-slate-400 dark:fill-slate-500"
          fontSize={8}
        >
          {unit}
        </text>
      </svg>
    </div>
  );
}

type AcRunEntry = {
  label: string;
  value?: number;
  result: SpiceComplexResult;
};

type TranRunEntry = {
  label: string;
  value?: number;
  result: SpiceResult;
};

export function BodePanel({
  sources,
  probePoints,
  sweepableTargets = [],
  runSweep,
  runTransientStep,
  initialStepMode = false,
  onClose,
  darkMode,
}: {
  sources: SweepSource[];
  probePoints: ProbePoint[];
  sweepableTargets?: SweepableTarget[];
  runSweep: (params: SweepParams) => Promise<SpiceComplexResult>;
  runTransientStep?: (overrideStep?: StepOverride) => Promise<SpiceResult>;
  initialStepMode?: boolean;
  onClose: () => void;
  darkMode: boolean;
}) {
  const [domain, setDomain] = useState<'ac' | 'tran'>('ac');
  const [sourceNodeId, setSourceNodeId] = useState(sources[0]?.id ?? '');
  const [fStart, setFStart] = useState(10);
  const [fStop, setFStop] = useState(1e6);
  const [pointsPerDecade, setPointsPerDecade] = useState(25);
  const [outputNet, setOutputNet] = useState(probePoints[0]?.net ?? '');

  // Parameter stepping configuration
  const [stepTargetKey, setStepTargetKey] = useState<string>(() =>
    initialStepMode && sweepableTargets[0] ? sweepableTargets[0].key : '',
  );
  const [stepInputMode, setStepInputMode] = useState<'range' | 'list'>('range');
  const activeTarget = useMemo(
    () => sweepableTargets.find(t => t.key === stepTargetKey) ?? null,
    [sweepableTargets, stepTargetKey],
  );

  const initialDefaults = useMemo(
    () =>
      activeTarget
        ? defaultSweepConfig(activeTarget)
        : { start: 1000, stop: 10000, steps: 5, scale: 'log' as SweepScale, listText: '1k, 2.2k, 4.7k, 10k' },
    [activeTarget],
  );

  const [stepStart, setStepStart] = useState<number>(initialDefaults.start);
  const [stepStop, setStepStop] = useState<number>(initialDefaults.stop);
  const [stepCount, setStepCount] = useState<number>(initialDefaults.steps);
  const [stepScale, setStepScale] = useState<SweepScale>(initialDefaults.scale);
  const [stepListText, setStepListText] = useState<string>(initialDefaults.listText);

  // Sync default range when a different component/parameter is picked
  const [syncedTargetKey, setSyncedTargetKey] = useState(stepTargetKey);
  if (syncedTargetKey !== stepTargetKey) {
    setSyncedTargetKey(stepTargetKey);
    if (activeTarget) {
      const cfg = defaultSweepConfig(activeTarget);
      setStepStart(cfg.start);
      setStepStop(cfg.stop);
      setStepCount(cfg.steps);
      setStepScale(cfg.scale);
      setStepListText(cfg.listText);
    }
  }

  const [acRuns, setAcRuns] = useState<AcRunEntry[]>([]);
  const [tranRuns, setTranRuns] = useState<TranRunEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [activeSeriesIndex, setActiveSeriesIndex] = useState<number | null>(null);
  const runSeq = useRef(0);

  if (sources.length > 0 && !sources.some(s => s.id === sourceNodeId)) {
    setSourceNodeId(sources[0].id);
  }
  if (probePoints.length > 0 && !probePoints.some(p => p.net === outputNet)) {
    setOutputNet(probePoints[0].net);
  }
  if (stepTargetKey && !sweepableTargets.some(t => t.key === stepTargetKey)) {
    setStepTargetKey('');
  }

  const resolvedStepValues = useMemo(() => {
    if (!activeTarget) return [];
    if (stepInputMode === 'list') {
      return parseSweepValuesList(stepListText).slice(0, 12);
    }
    return generateSweepValues({
      start: stepStart,
      stop: stepStop,
      steps: stepCount,
      scale: stepScale,
    });
  }, [activeTarget, stepInputMode, stepListText, stepStart, stepStop, stepCount, stepScale]);

  const sweep = useCallback(async () => {
    if (domain === 'ac' && !sourceNodeId) return;
    if (domain === 'tran' && !runTransientStep) return;

    const seq = ++runSeq.current;
    setBusy(true);
    setError(null);
    setActiveSeriesIndex(null);

    try {
      if (domain === 'ac') {
        if (!activeTarget) {
          const res = await runSweep({ sourceNodeId, fStart, fStop, pointsPerDecade });
          if (seq !== runSeq.current) return;
          setAcRuns([{ label: 'As drawn', result: res }]);
        } else {
          if (resolvedStepValues.length === 0) {
            throw new Error('Enter at least one valid parameter value to step.');
          }
          const runs: AcRunEntry[] = [];
          for (const val of resolvedStepValues) {
            const res = await runSweep({
              sourceNodeId,
              fStart,
              fStop,
              pointsPerDecade,
              overrideStep: {
                nodeId: activeTarget.nodeId,
                param: activeTarget.param,
                value: val,
              },
            });
            if (seq !== runSeq.current) return;
            runs.push({
              label: `${activeTarget.componentLabel} = ${formatSweepValue(val, activeTarget.unit)}`,
              value: val,
              result: res,
            });
          }
          setAcRuns(runs);
        }
      } else if (runTransientStep) {
        if (!activeTarget) {
          const res = await runTransientStep(undefined);
          if (seq !== runSeq.current) return;
          setTranRuns([{ label: 'As drawn', result: res }]);
        } else {
          if (resolvedStepValues.length === 0) {
            throw new Error('Enter at least one valid parameter value to step.');
          }
          const runs: TranRunEntry[] = [];
          for (const val of resolvedStepValues) {
            const res = await runTransientStep({
              nodeId: activeTarget.nodeId,
              param: activeTarget.param,
              value: val,
            });
            if (seq !== runSeq.current) return;
            runs.push({
              label: `${activeTarget.componentLabel} = ${formatSweepValue(val, activeTarget.unit)}`,
              value: val,
              result: res,
            });
          }
          setTranRuns(runs);
        }
      }
    } catch (err) {
      if (seq !== runSeq.current) return;
      setAcRuns([]);
      setTranRuns([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === runSeq.current) setBusy(false);
    }
  }, [
    domain,
    sourceNodeId,
    runTransientStep,
    activeTarget,
    runSweep,
    fStart,
    fStop,
    pointsPerDecade,
    resolvedStepValues,
  ]);

  // Run automatically on open so the panel answers immediately.
  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current) return;
    if (domain === 'ac' && !sourceNodeId) return;
    openedRef.current = true;
    const t = setTimeout(() => {
      void sweep();
    }, 0);
    return () => clearTimeout(t);
  }, [sweep, domain, sourceNodeId]);

  const palette = darkMode ? STEP_PALETTE_DARK : STEP_PALETTE_LIGHT;
  const magColor = darkMode ? MAG_COLOR_DARK : MAG_COLOR;
  const phaseColor = darkMode ? PHASE_COLOR_DARK : PHASE_COLOR;

  const acTraces = useMemo(() => {
    if (!outputNet) return [];
    return acRuns
      .map((r, idx) => {
        const trace: BodeTrace | null = buildBodeTrace(r.result, outputNet);
        if (!trace) return null;
        const color = acRuns.length === 1 ? magColor : palette[idx % palette.length];
        const phaseCol = acRuns.length === 1 ? phaseColor : palette[idx % palette.length];
        return {
          label: r.label,
          value: r.value,
          trace,
          corner: cornerFrequencyHz(trace),
          magColor: color,
          phaseColor: phaseCol,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [acRuns, outputNet, magColor, phaseColor, palette]);

  const tranTraces = useMemo(() => {
    if (!outputNet) return [];
    return tranRuns
      .map((r, idx) => {
        const trace: TransientTrace | null = buildTransientTrace(r.result, outputNet);
        if (!trace) return null;
        const color = tranRuns.length === 1 ? magColor : palette[idx % palette.length];
        let minV = Infinity;
        let maxV = -Infinity;
        for (const v of trace.voltage) {
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
        }
        return {
          label: r.label,
          value: r.value,
          trace,
          vpp: Number.isFinite(maxV - minV) ? maxV - minV : 0,
          color,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [tranRuns, outputNet, magColor, palette]);

  const singleCorner = acTraces.length === 1 ? acTraces[0].corner : null;

  const readout = useMemo(() => {
    if (hoverIndex === null) return null;
    if (domain === 'ac') {
      const first = acTraces[0]?.trace;
      if (!first || hoverIndex >= first.freqHz.length) return null;
      const fStr = formatHz(first.freqHz[hoverIndex]);
      if (acTraces.length === 1) {
        return `${fStr} · ${first.magDb[hoverIndex].toFixed(1)} dB · ${first.phaseDeg[hoverIndex].toFixed(0)}°`;
      }
      const parts = acTraces
        .filter((_, idx) => activeSeriesIndex === null || activeSeriesIndex === idx)
        .map(
          t =>
            `${t.label.replace(/^.*=\s*/, '')}: ${t.trace.magDb[hoverIndex]?.toFixed(1) ?? '—'} dB`,
        );
      return `${fStr} · ${parts.join(' | ')}`;
    } else {
      const first = tranTraces[0]?.trace;
      if (!first || hoverIndex >= first.timeMs.length) return null;
      const tMs = first.timeMs[hoverIndex];
      const tStr = tMs >= 1000 ? `${(tMs / 1000).toFixed(3)} s` : `${tMs.toFixed(2)} ms`;
      if (tranTraces.length === 1) {
        return `${tStr} · ${formatVolts(first.voltage[hoverIndex])}`;
      }
      const parts = tranTraces
        .filter((_, idx) => activeSeriesIndex === null || activeSeriesIndex === idx)
        .map(
          t =>
            `${t.label.replace(/^.*=\s*/, '')}: ${formatVolts(t.trace.voltage[hoverIndex] ?? 0)}`,
        );
      return `${tStr} · ${parts.join(' | ')}`;
    }
  }, [hoverIndex, domain, acTraces, tranTraces, activeSeriesIndex]);

  const selectClass =
    'text-[11px] border border-slate-300 dark:border-slate-700 rounded px-1.5 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:border-emerald-500 focus:outline-none cursor-pointer';

  const magSeries: SeriesItem[] = useMemo(
    () =>
      acTraces.map(t => ({
        label: t.label,
        color: t.magColor,
        xs: t.trace.freqHz,
        ys: t.trace.magDb,
      })),
    [acTraces],
  );

  const phaseSeries: SeriesItem[] = useMemo(
    () =>
      acTraces.map(t => ({
        label: t.label,
        color: t.phaseColor,
        xs: t.trace.freqHz,
        ys: t.trace.phaseDeg,
      })),
    [acTraces],
  );

  const transientSeries: SeriesItem[] = useMemo(
    () =>
      tranTraces.map(t => ({
        label: t.label,
        color: t.color,
        xs: t.trace.timeMs,
        ys: t.trace.voltage,
      })),
    [tranTraces],
  );

  return createPortal(
    <div className="fixed bottom-12 right-4 max-lg:left-1/2 max-lg:right-auto max-lg:-translate-x-1/2 z-[105] w-[38rem] max-w-[95vw] rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          {activeTarget ? (
            <SlidersHorizontal className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0" />
          ) : (
            <Waves className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0" />
          )}
          <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
            {activeTarget ? 'Parameter sweep' : 'Frequency response'}
          </p>
          {domain === 'ac' && singleCorner !== null && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 shrink-0">
              −3dB at {formatHz(singleCorner)}
            </span>
          )}
          {runTransientStep && (
            <div className="ml-1 flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-md border border-slate-200 dark:border-slate-700 text-[10px]">
              <button
                type="button"
                onClick={() => setDomain('ac')}
                className={`px-2 py-0.5 rounded cursor-pointer font-semibold transition-colors ${
                  domain === 'ac'
                    ? 'bg-white dark:bg-slate-900 text-violet-600 dark:text-violet-400 shadow-2xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                AC Bode
              </button>
              <button
                type="button"
                onClick={() => setDomain('tran')}
                className={`px-2 py-0.5 rounded cursor-pointer font-semibold transition-colors ${
                  domain === 'tran'
                    ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-2xs'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                Transient
              </button>
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer px-1"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Row 1: Drive / Measure / Frequency range */}
      <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-slate-100 dark:border-slate-800">
        {domain === 'ac' && (
          <label className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
            Drive
            <select
              value={sourceNodeId}
              onChange={e => setSourceNodeId(e.target.value)}
              className={selectClass}
            >
              {sources.map(s => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
          Measure
          <select
            value={outputNet}
            onChange={e => setOutputNet(e.target.value)}
            className={selectClass}
          >
            {probePoints.map(p => (
              <option key={p.net} value={p.net}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {domain === 'ac' && (
          <>
            <label className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
              From
              <NumberInput
                value={fStart}
                min={0.001}
                step={1}
                onChange={v => setFStart(Math.max(0.001, v))}
                className="w-16 text-[11px] border border-slate-300 dark:border-slate-700 rounded px-1 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
              />
              Hz
            </label>
            <label className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
              to
              <NumberInput
                value={fStop}
                min={1}
                step={1}
                onChange={v => setFStop(Math.max(1, v))}
                className="w-20 text-[11px] border border-slate-300 dark:border-slate-700 rounded px-1 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
              />
              Hz
            </label>
            <label className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
              pts/dec
              <NumberInput
                value={pointsPerDecade}
                min={2}
                max={500}
                step={1}
                onChange={v => setPointsPerDecade(Math.max(2, Math.min(500, v)))}
                className="w-14 text-[11px] border border-slate-300 dark:border-slate-700 rounded px-1 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
              />
            </label>
          </>
        )}
        <button
          onClick={() => void sweep()}
          disabled={busy || (domain === 'ac' && !sourceNodeId)}
          className="ml-auto px-2.5 py-1 rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-[11px] font-semibold cursor-pointer transition-colors"
        >
          {busy ? 'Sweeping…' : 'Sweep'}
        </button>
      </div>

      {/* Row 2: Parameter Stepping controls */}
      {sweepableTargets.length > 0 && (
        <div className="px-3 py-1.5 flex flex-wrap items-center gap-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40">
          <label className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
            Step
            <select
              aria-label="Step parameter"
              value={stepTargetKey}
              onChange={e => setStepTargetKey(e.target.value)}
              className={selectClass}
            >
              <option value="">None (single run)</option>
              {sweepableTargets.map(t => (
                <option key={t.key} value={t.key}>
                  {t.componentLabel} {t.paramLabel} ({formatSweepValue(t.currentValue, t.unit)})
                </option>
              ))}
            </select>
          </label>

          {activeTarget && (
            <>
              <select
                aria-label="Step mode"
                value={stepInputMode}
                onChange={e => setStepInputMode(e.target.value as 'range' | 'list')}
                className={selectClass}
              >
                <option value="range">Range</option>
                <option value="list">Values list</option>
              </select>

              {stepInputMode === 'range' ? (
                <>
                  <label className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                    Start
                    <NumberInput
                      value={stepStart}
                      step={activeTarget.currentValue * 0.1 || 1}
                      onChange={v => setStepStart(v)}
                      className="w-16 text-[11px] border border-slate-300 dark:border-slate-700 rounded px-1 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                    />
                  </label>
                  <label className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                    Stop
                    <NumberInput
                      value={stepStop}
                      step={activeTarget.currentValue * 0.1 || 1}
                      onChange={v => setStepStop(v)}
                      className="w-16 text-[11px] border border-slate-300 dark:border-slate-700 rounded px-1 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                    />
                    {activeTarget.unit}
                  </label>
                  <label className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                    Steps
                    <NumberInput
                      value={stepCount}
                      min={2}
                      max={10}
                      step={1}
                      onChange={v => setStepCount(Math.max(2, Math.min(10, Math.round(v))))}
                      className="w-12 text-[11px] border border-slate-300 dark:border-slate-700 rounded px-1 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200"
                    />
                  </label>
                  <select
                    aria-label="Step scale"
                    value={stepScale}
                    onChange={e => setStepScale(e.target.value as SweepScale)}
                    className={selectClass}
                  >
                    <option value="log">Log</option>
                    <option value="linear">Linear</option>
                  </select>
                </>
              ) : (
                <label className="flex items-center gap-1 flex-1 min-w-[12rem] text-[10px] text-slate-500 dark:text-slate-400">
                  Values ({activeTarget.unit || 'SI'})
                  <input
                    type="text"
                    value={stepListText}
                    onChange={e => setStepListText(e.target.value)}
                    placeholder="e.g. 1k, 2.2k, 4.7k, 10k"
                    className="flex-1 min-w-0 text-[11px] font-mono border border-slate-300 dark:border-slate-700 rounded px-1.5 py-1 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:border-emerald-500 focus:outline-none"
                  />
                </label>
              )}
            </>
          )}
        </div>
      )}

      {/* Multi-run Legend Bar */}
      {((domain === 'ac' && acTraces.length > 1) || (domain === 'tran' && tranTraces.length > 1)) && (
        <div className="px-3 py-1.5 flex flex-wrap items-center gap-1.5 border-b border-slate-100 dark:border-slate-800">
          {(domain === 'ac' ? acTraces : tranTraces).map((item, idx) => {
            const color = 'magColor' in item ? item.magColor : item.color;
            const badge =
              'corner' in item && item.corner !== null
                ? `−3dB @ ${formatHz(item.corner)}`
                : 'vpp' in item
                  ? `Δ${formatVolts(item.vpp)}`
                  : null;
            const isSelected = activeSeriesIndex === idx;
            return (
              <button
                key={item.label + idx}
                type="button"
                onMouseEnter={() => setActiveSeriesIndex(idx)}
                onMouseLeave={() => setActiveSeriesIndex(null)}
                onClick={() => setActiveSeriesIndex(prev => (prev === idx ? null : idx))}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-mono cursor-pointer transition-all ${
                  isSelected
                    ? 'border-slate-400 dark:border-slate-500 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-semibold'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:border-slate-300'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span>{item.label}</span>
                {badge && (
                  <span className="text-[9px] text-slate-400 dark:text-slate-500">· {badge}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="px-2 py-2">
        {domain === 'ac' && sources.length === 0 ? (
          <p className="px-2 py-6 text-[11px] text-slate-500 dark:text-slate-400 text-center">
            A sweep needs something to drive. Add a signal generator, an AC source or a DC supply
            and it will be offered here — the source is replaced by a 1V small-signal stimulus for
            the sweep and put back afterwards.
          </p>
        ) : error ? (
          <p className="px-2 py-6 text-[11px] text-amber-700 dark:text-amber-400 text-center whitespace-pre-line">
            {error}
          </p>
        ) : domain === 'ac' ? (
          acTraces.length === 0 ? (
            <p className="px-2 py-6 text-[11px] text-slate-500 dark:text-slate-400 text-center">
              {busy ? 'Solving…' : 'Press Sweep to measure the response.'}
            </p>
          ) : (
            <>
              <SweepPane
                title="Magnitude"
                unit="dB"
                series={magSeries}
                logX={true}
                width={560}
                height={130}
                hoverIndex={hoverIndex}
                activeSeriesIndex={activeSeriesIndex}
                onHover={setHoverIndex}
                formatY={v => v.toFixed(0)}
                formatX={formatHz}
              />
              <SweepPane
                title="Phase"
                unit="deg"
                series={phaseSeries}
                logX={true}
                width={560}
                height={110}
                hoverIndex={hoverIndex}
                activeSeriesIndex={activeSeriesIndex}
                onHover={setHoverIndex}
                formatY={v => v.toFixed(0)}
                formatX={formatHz}
              />
              <p className="px-1 pt-1 text-[10px] font-mono text-slate-500 dark:text-slate-400 min-h-4 truncate">
                {readout ?? ''}
              </p>
            </>
          )
        ) : tranTraces.length === 0 ? (
          <p className="px-2 py-6 text-[11px] text-slate-500 dark:text-slate-400 text-center">
            {busy ? 'Solving…' : 'Press Sweep to compare transient waveforms.'}
          </p>
        ) : (
          <>
            <SweepPane
              title="Transient voltage"
              unit="V"
              series={transientSeries}
              logX={false}
              width={560}
              height={210}
              hoverIndex={hoverIndex}
              activeSeriesIndex={activeSeriesIndex}
              onHover={setHoverIndex}
              formatY={v => v.toFixed(2)}
              formatX={ms => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`)}
            />
            <p className="px-1 pt-1 text-[10px] font-mono text-slate-500 dark:text-slate-400 min-h-4 truncate">
              {readout ?? ''}
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
