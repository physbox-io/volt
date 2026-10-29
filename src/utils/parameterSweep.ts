/**
 * Stepping a component value across a range or list of values to compare
 * frequency responses, transient waveforms, or DC operating points.
 */
import type { Node } from '@xyflow/react';
import { parseEngValue } from './engValue';
import { findNetGraph } from './netlistResult';
import type { SpiceResult } from '../types/simulation';

export type SweepParamKind =
  | 'resistance'
  | 'capacitance'
  | 'inductance'
  | 'position'
  | 'voltage'
  | 'current'
  | 'frequency'
  | 'amplitude'
  | 'dutyCycle'
  | 'zenerVoltage'
  | 'lightLevel';

export type SweepScale = 'log' | 'linear';

export type SweepableTarget = {
  /** Composite key `${nodeId}:${param}` for UI selectors. */
  key: string;
  nodeId: string;
  nodeType: string;
  /** The component's designator on the schematic, e.g. 'R1', 'C2'. */
  componentLabel: string;
  param: SweepParamKind;
  paramLabel: string;
  unit: string;
  currentValue: number;
  defaultScale: SweepScale;
};

export type TransientTrace = {
  timeMs: number[];
  voltage: number[];
};

const SI_DISPLAY: { factor: number; prefix: string }[] = [
  { factor: 1e9, prefix: 'G' },
  { factor: 1e6, prefix: 'M' },
  { factor: 1e3, prefix: 'k' },
  { factor: 1, prefix: '' },
  { factor: 1e-3, prefix: 'm' },
  { factor: 1e-6, prefix: 'µ' },
  { factor: 1e-9, prefix: 'n' },
  { factor: 1e-12, prefix: 'p' },
];

const SI_SPICE: { factor: number; suffix: string }[] = [
  { factor: 1e9, suffix: 'g' },
  { factor: 1e6, suffix: 'meg' },
  { factor: 1e3, suffix: 'k' },
  { factor: 1, suffix: '' },
  { factor: 1e-3, suffix: 'm' },
  { factor: 1e-6, suffix: 'u' },
  { factor: 1e-9, suffix: 'n' },
  { factor: 1e-12, suffix: 'p' },
];

function trimNum(n: number): string {
  return Number(n.toPrecision(3)).toString();
}

/**
 * Formats a parameter value for legends and readouts, e.g. `4.7 kΩ`, `100 nF`, `50%`.
 */
export function formatSweepValue(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—';
  if (unit === '%' || unit === '') {
    return `${trimNum(value)}${unit}`;
  }
  const abs = Math.abs(value);
  if (abs === 0) return `0 ${unit}`.trim();
  for (const { factor, prefix } of SI_DISPLAY) {
    if (abs >= factor * 0.9995) {
      return `${trimNum(value / factor)} ${prefix}${unit}`.trim();
    }
  }
  const last = SI_DISPLAY[SI_DISPLAY.length - 1];
  return `${trimNum(value / last.factor)} ${last.prefix}${unit}`.trim();
}

/**
 * Formats a numeric value as a compact SPICE engineering token (e.g. `4.7k`, `100n`, `1meg`).
 */
export function formatSpiceToken(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  for (const { factor, suffix } of SI_SPICE) {
    if (abs >= factor * 0.9995) {
      return `${trimNum(value / factor)}${suffix}`;
    }
  }
  const last = SI_SPICE[SI_SPICE.length - 1];
  return `${trimNum(value / last.factor)}${last.suffix}`;
}

function readNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Lists every component parameter on the canvas that can be stepped in a sweep.
 * Passive values (`R`, `C`, `L`) sort first because they are the parameters a
 * filter or amplifier is almost always tuned by.
 */
export function buildSweepableTargets(
  nodes: Node[],
  nameOf: (nodeId: string) => string,
): SweepableTarget[] {
  const out: (SweepableTarget & { rank: number })[] = [];

  for (const n of nodes) {
    const type = n.type ?? '';
    const d = (n.data ?? {}) as Record<string, unknown>;
    const componentLabel = nameOf(n.id);

    const add = (
      param: SweepParamKind,
      paramLabel: string,
      unit: string,
      currentValue: number,
      defaultScale: SweepScale,
      rank: number,
    ) => {
      out.push({
        key: `${n.id}:${param}`,
        nodeId: n.id,
        nodeType: type,
        componentLabel,
        param,
        paramLabel,
        unit,
        currentValue,
        defaultScale,
        rank,
      });
    };

    if (type === 'resistor') {
      const val = readNum(d.resistance) ?? parseEngValue(String(d.label || '1k')) ?? 1000;
      add('resistance', 'Resistance', 'Ω', val > 0 ? val : 1000, 'log', 0);
    } else if (type === 'capacitor') {
      const val = readNum(d.capacitance) ?? parseEngValue(String(d.label || '10u')) ?? 1e-5;
      add('capacitance', 'Capacitance', 'F', val > 0 ? val : 1e-5, 'log', 0);
    } else if (type === 'inductor') {
      const val = readNum(d.inductance) ?? parseEngValue(String(d.label || '100u')) ?? 1e-4;
      add('inductance', 'Inductance', 'H', val > 0 ? val : 1e-4, 'log', 0);
    } else if (type === 'potentiometer') {
      const rawPos = Number(d.position);
      const pos = Number.isFinite(rawPos) ? rawPos : 50;
      add('position', 'Wiper', '%', pos, 'linear', 1);
      const totalR = parseEngValue(String(d.label || '10k')) ?? 10000;
      add('resistance', 'End-to-end R', 'Ω', totalR > 0 ? totalR : 10000, 'log', 2);
    } else if (type === 'voltage') {
      const val = readNum(d.voltage) ?? parseEngValue(String(d.label || '5')) ?? 5;
      add('voltage', 'DC voltage', 'V', val, 'linear', 3);
    } else if (type === 'currentsource') {
      const val = parseEngValue(String(d.label || '10m')) ?? 0.01;
      add('current', 'Current', 'A', val, 'linear', 3);
    } else if (type === 'signalgen') {
      const freq = Number(d.frequency);
      add('frequency', 'Frequency', 'Hz', Number.isFinite(freq) && freq > 0 ? freq : 1000, 'log', 4);
      const amp = Number(d.amplitude);
      add('amplitude', 'Amplitude', 'V', Number.isFinite(amp) ? amp : 5, 'linear', 5);
      if (d.waveform === 'square') {
        const duty = Number(d.dutyCycle);
        add('dutyCycle', 'Duty cycle', '%', Number.isFinite(duty) ? duty : 50, 'linear', 5);
      }
    } else if (type === 'acvoltage') {
      const amp = Number(d.amplitude);
      add('amplitude', 'Amplitude', 'V', Number.isFinite(amp) ? amp : 10, 'linear', 4);
      const freq = Number(d.frequency);
      add('frequency', 'Frequency', 'Hz', Number.isFinite(freq) && freq > 0 ? freq : 60, 'log', 5);
    } else if (type === 'zener') {
      const bv = parseEngValue(String(d.label || '5.1V')) ?? 5.1;
      add('zenerVoltage', 'Breakdown V', 'V', bv > 0 ? bv : 5.1, 'linear', 3);
    } else if (type === 'ldr') {
      const ll = Number(d.lightLevel);
      add('lightLevel', 'Light level', '', Number.isFinite(ll) ? ll : 0.5, 'linear', 3);
    }
  }

  return out
    .sort((a, b) => a.rank - b.rank || a.componentLabel.localeCompare(b.componentLabel))
    .map(({ rank: _rank, ...rest }) => rest);
}

/**
 * Sensible default sweep range around the target's current value, so selecting
 * a part immediately offers 5 useful steps with the drawn value in the middle.
 */
export function defaultSweepConfig(target: SweepableTarget): {
  start: number;
  stop: number;
  steps: number;
  scale: SweepScale;
  listText: string;
} {
  const c = target.currentValue;
  if (target.param === 'position' || target.param === 'dutyCycle') {
    const vals = [10, 30, 50, 70, 90];
    return {
      start: 10,
      stop: 90,
      steps: 5,
      scale: 'linear',
      listText: vals.map(v => formatSpiceToken(v)).join(', '),
    };
  }
  if (target.param === 'lightLevel') {
    const vals = [0.1, 0.3, 0.5, 0.7, 0.9];
    return {
      start: 0.1,
      stop: 0.9,
      steps: 5,
      scale: 'linear',
      listText: vals.join(', '),
    };
  }
  if (target.defaultScale === 'log' && c > 0) {
    const start = Number((c / 4).toPrecision(3));
    const stop = Number((c * 4).toPrecision(3));
    const vals = [0.25, 0.5, 1, 2, 4].map(m => Number((c * m).toPrecision(3)));
    return {
      start,
      stop,
      steps: 5,
      scale: 'log',
      listText: vals.map(v => formatSpiceToken(v)).join(', '),
    };
  }
  const base = c !== 0 ? c : 5;
  const start = Number((base * 0.5).toPrecision(3));
  const stop = Number((base * 1.5).toPrecision(3));
  const vals = generateSweepValues({ start, stop, steps: 5, scale: 'linear' });
  return {
    start,
    stop,
    steps: 5,
    scale: 'linear',
    listText: vals.map(v => formatSpiceToken(v)).join(', '),
  };
}

/**
 * Generates `steps` values between `start` and `stop` on a linear or logarithmic scale.
 */
export function generateSweepValues(opts: {
  start: number;
  stop: number;
  steps: number;
  scale: SweepScale;
}): number[] {
  const count = Math.max(2, Math.min(12, Math.round(opts.steps || 5)));
  const { start, stop, scale } = opts;
  if (!Number.isFinite(start) || !Number.isFinite(stop)) return [];
  if (start === stop) return [start];

  const out: number[] = [];
  if (scale === 'log' && start > 0 && stop > 0) {
    const l0 = Math.log10(start);
    const l1 = Math.log10(stop);
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      out.push(Number((10 ** (l0 + (l1 - l0) * t)).toPrecision(4)));
    }
  } else {
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      out.push(Number((start + (stop - start) * t).toPrecision(4)));
    }
  }
  return out;
}

/**
 * Parses a comma- or whitespace-separated list of engineering values,
 * e.g. `"1k, 2.2k, 4.7k, 10k"` or `"10n 22n 47n 100n"`.
 */
export function parseSweepValuesList(raw: string): number[] {
  const tokens = raw
    .split(/[\s,;]+/)
    .map(s => s.trim())
    .filter(Boolean);
  const out: number[] = [];
  for (const tok of tokens) {
    const v = parseEngValue(tok);
    if (v !== null && Number.isFinite(v)) {
      out.push(v);
    }
  }
  return out;
}

/**
 * Returns a copy of `nodes` with `nodeId`'s `param` replaced by `value`,
 * updating both the numeric field and `label` so every netlist emitter reads
 * the stepped value without mutating the schematic on screen.
 */
export function applyParameterValue(
  nodes: Node[],
  nodeId: string,
  param: SweepParamKind,
  value: number,
): Node[] {
  return nodes.map(n => {
    if (n.id !== nodeId) return n;
    const d = { ...(n.data ?? {}) } as Record<string, unknown>;
    const token = formatSpiceToken(value);

    switch (param) {
      case 'resistance':
        if (n.type === 'potentiometer') {
          d.label = token;
        } else {
          d.resistance = value;
          d.label = token;
        }
        break;
      case 'capacitance':
        d.capacitance = value;
        d.label = token;
        break;
      case 'inductance':
        d.inductance = value;
        d.label = token;
        break;
      case 'position':
        d.position = Math.max(0, Math.min(100, value));
        break;
      case 'voltage':
        d.voltage = value;
        d.label = `${token}V`;
        break;
      case 'current':
        d.value = value;
        d.label = `${token}A`;
        break;
      case 'frequency':
        d.frequency = Math.max(0, value);
        break;
      case 'amplitude':
        d.amplitude = value;
        break;
      case 'dutyCycle':
        d.dutyCycle = Math.max(1, Math.min(99, value));
        break;
      case 'zenerVoltage':
        d.label = `${token}V`;
        break;
      case 'lightLevel':
        d.lightLevel = Math.max(0, Math.min(1, value));
        break;
    }

    return { ...n, data: d };
  });
}

/**
 * Extracts a transient voltage waveform for `netName` from a `.tran` result.
 */
export function buildTransientTrace(
  result: SpiceResult | null | undefined,
  netName: string,
): TransientTrace | null {
  if (!result || !netName) return null;
  const graph = findNetGraph(result, netName);
  if (!graph || !graph.timestamps_ms?.length || !graph.voltage_levels?.length) return null;
  return {
    timeMs: graph.timestamps_ms,
    voltage: graph.voltage_levels,
  };
}

