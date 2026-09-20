/**
 * Reading an operating point and a frequency sweep.
 *
 * Both come back through the same engine as a transient run and neither is
 * shaped like one: `.op` is a single point with no time axis, and `.ac` is a
 * list of phasors against frequency. `findNetGraph` would happily hand either
 * of them back with `data[0]` read as a time column, so they are read here
 * instead, where the shape is known.
 */
import type { SpiceComplexResult, SpiceResult } from '../types/simulation';

/**
 * Every node voltage at the bias point, keyed by net name in lower case.
 *
 * Branch currents come back in the same plot as `i(v1)` and are kept out: this
 * feeds voltage chips on the wires, and a current under the same key would be
 * drawn as volts.
 */
export function readOperatingPoint(result: SpiceResult | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!result?.variableNames || !result.data) return out;
  result.variableNames.forEach((name, i) => {
    const n = name.toLowerCase();
    if (!n.startsWith('v(') || !n.endsWith(')')) return;
    const value = result.data[i]?.values?.[0];
    if (typeof value === 'number' && Number.isFinite(value)) out[n.slice(2, -1)] = value;
  });
  return out;
}

/** The nets an AC sweep has a trace for, in the order ngspice listed them. */
export function acOutputNets(result: SpiceComplexResult | null | undefined): string[] {
  if (!result?.variableNames) return [];
  return result.variableNames
    .map(n => n.toLowerCase())
    .filter(n => n.startsWith('v(') && n.endsWith(')'))
    .map(n => n.slice(2, -1));
}

export type BodeTrace = {
  freqHz: number[];
  magDb: number[];
  phaseDeg: number[];
};

/**
 * Magnitude in dB and phase in degrees against frequency, for one net.
 *
 * Phase is unwrapped as it goes. `atan2` is only ever defined on ±180, so a
 * second-order filter passing through −180° comes back out of the solver as a
 * jump to +180 — which draws as a vertical line through the middle of the plot
 * exactly where the interesting part of the response is.
 */
export function buildBodeTrace(result: SpiceComplexResult | null | undefined, netName: string): BodeTrace | null {
  if (!result?.variableNames || !result.data) return null;
  const search = netName.toLowerCase();
  const freqIdx = result.variableNames.findIndex(n => n.toLowerCase() === 'frequency');
  const valIdx = result.variableNames.findIndex(
    n => n.toLowerCase() === `v(${search})` || n.toLowerCase() === search,
  );
  if (freqIdx === -1 || valIdx === -1) return null;

  const freqs = result.data[freqIdx]?.values;
  const vals = result.data[valIdx]?.values;
  if (!freqs || !vals) return null;

  const freqHz: number[] = [];
  const magDb: number[] = [];
  const phaseDeg: number[] = [];
  let turns = 0;
  let prevRaw: number | null = null;

  for (let i = 0; i < Math.min(freqs.length, vals.length); i++) {
    const f = freqs[i].real;
    const { real, img } = vals[i];
    const mag = Math.hypot(real, img);
    // A null in the response is a true minus infinity; the floor keeps the plot
    // drawable without pretending the notch is shallower than it is.
    freqHz.push(f);
    magDb.push(mag > 0 ? Math.max(-200, 20 * Math.log10(mag)) : -200);

    const raw = (Math.atan2(img, real) * 180) / Math.PI;
    if (prevRaw !== null) {
      const step = raw - prevRaw;
      if (step > 180) turns -= 1;
      else if (step < -180) turns += 1;
    }
    prevRaw = raw;
    phaseDeg.push(raw + turns * 360);
  }

  return { freqHz, magDb, phaseDeg };
}

/**
 * The −3dB point, measured from the flattest part of the response rather than
 * from 0dB: a sweep through an amplifier is flat at +20dB, and its corner is
 * 3dB down from that, not 3dB down from unity.
 *
 * Returns the first crossing in either direction, so a low-pass and a high-pass
 * both report the corner someone would read off the plot. Null when the
 * response never gets 3dB away from its peak — a flat network has no corner,
 * and inventing one would be worse than saying nothing.
 */
export function cornerFrequencyHz(trace: BodeTrace | null): number | null {
  if (!trace || trace.magDb.length < 2) return null;
  let peak = -Infinity;
  for (const m of trace.magDb) if (m > peak) peak = m;
  if (!Number.isFinite(peak)) return null;
  const target = peak - 3;

  const peakIdx = trace.magDb.indexOf(peak);
  const scan = (from: number, to: number, step: number): number | null => {
    for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
      const prev = i - step;
      if (prev < 0 || prev >= trace.magDb.length) continue;
      const a = trace.magDb[prev];
      const b = trace.magDb[i];
      if (a > target && b <= target) {
        // Interpolated in log frequency, which is the axis it is read on.
        const fa = Math.log10(Math.max(trace.freqHz[prev], 1e-12));
        const fb = Math.log10(Math.max(trace.freqHz[i], 1e-12));
        const k = (a - target) / (a - b);
        return 10 ** (fa + (fb - fa) * k);
      }
    }
    return null;
  };

  return scan(peakIdx + 1, trace.magDb.length - 1, 1) ?? scan(peakIdx - 1, 0, -1);
}

/** 1.2345e4 Hz as "12.3 kHz" — the way a corner frequency is spoken. */
export function formatHz(f: number): string {
  if (!Number.isFinite(f)) return '—';
  if (f >= 1e6) return `${(f / 1e6).toPrecision(3)} MHz`;
  if (f >= 1e3) return `${(f / 1e3).toPrecision(3)} kHz`;
  return `${f.toPrecision(3)} Hz`;
}

/** Volts as a bench meter would show them, with a sensible unit. */
export function formatVolts(v: number): string {
  const a = Math.abs(v);
  if (a >= 1) return `${v.toFixed(2)} V`;
  if (a >= 1e-3) return `${(v * 1e3).toFixed(1)} mV`;
  if (a >= 1e-6) return `${(v * 1e6).toFixed(0)} µV`;
  return '0 V';
}
