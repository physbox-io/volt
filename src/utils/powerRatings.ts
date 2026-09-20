/**
 * What the parts would actually do on a bench.
 *
 * SPICE solves for branch currents and node voltages and has no opinion about
 * whether a part survives them, so a 0805 asked to pass two amps animates as
 * happily as one passing two milliamps. This turns a finished run into the
 * question someone building the thing would ask: is anything here going to get
 * hot, and is anything seeing more volts than it is rated for.
 *
 * Averaged over the run, not peaked, because that is what heats a resistor. A
 * quarter-watt part spending a microsecond at five watts is a part dissipating
 * almost nothing; reporting the peak would fire on every switching edge in
 * every circuit, which is the fastest way to teach someone to ignore a warning.
 */
import type { Node } from '@xyflow/react';
import type { Advisory } from '../types/advisories';
import type { SpiceResult } from '../types/simulation';
import { buildNetlistResultIndex, findNetGraph } from './netlistResult';
import { parseEngValue } from './engValue';
import { defaultPackageForType } from './pcbFootprints';

/**
 * Continuous dissipation a package is sold at, in watts.
 *
 * The everyday numbers off a distributor's parametric search, not a
 * manufacturer's absolute maximum: this is the figure someone reaching into a
 * drawer of parts has in mind, and overriding it per part is one field away.
 */
const PACKAGE_POWER_W: Record<string, number> = {
  '0402': 0.063,
  '0603': 0.1,
  '0805': 0.125,
  '1206': 0.25,
  '1210': 0.5,
  '2512': 1,
  'AXIAL-0.3': 0.25,
  'POT-3PIN': 0.25,
  'RADIAL-5MM': 0.25,
  'TO-92': 0.5,
  'TO-220': 2,
  'TO-247': 2,
  'SOT-23': 0.25,
};

/** What a part with no package chosen and no override is assumed to be. */
const FALLBACK_POWER_W = 0.25;

export type PowerRating = {
  watts: number;
  /** Where the number came from, so the panel can say so rather than assert. */
  source: 'set' | 'package' | 'default';
  packageId?: string;
};

/**
 * The rating a dissipating part is held to: what was typed in, else what the
 * chosen package is sold at, else a quarter watt.
 */
export function powerRatingFor(node: Node): PowerRating {
  const data = node.data as Record<string, unknown>;
  const set = typeof data.powerRatingW === 'number'
    ? data.powerRatingW
    : parseEngValue(String(data.powerRatingW ?? ''));
  if (set !== null && Number.isFinite(set) && set > 0) return { watts: set, source: 'set' };

  const packageId = (data.packageId as string | undefined) || defaultPackageForType(node.type);
  if (packageId && PACKAGE_POWER_W[packageId] !== undefined) {
    return { watts: PACKAGE_POWER_W[packageId], source: 'package', packageId };
  }
  return { watts: FALLBACK_POWER_W, source: 'default', packageId };
}

/** Ohms as the netlist reads them: the numeric field first, then the label. */
export function resistanceOf(node: Node, fallback: number): number {
  const data = node.data as Record<string, unknown>;
  if (typeof data.resistance === 'number' && data.resistance > 0) return data.resistance;
  const parsed = parseEngValue(String(data.label ?? ''));
  return parsed !== null && parsed > 0 ? parsed : fallback;
}

/**
 * Time-weighted mean of a sampled series.
 *
 * Trapezoidal against the timestamps rather than a plain average of the
 * samples: ngspice picks its own timestep and crowds points around fast edges,
 * so a plain mean weights a nanosecond of switching as heavily as a
 * millisecond of steady state and reads high on exactly the circuits this is
 * meant to be quiet about.
 */
export function timeWeightedMean(values: number[], timestampsMs: number[]): number {
  const n = Math.min(values.length, timestampsMs.length);
  if (n === 0) return 0;
  if (n === 1) return values[0];
  let area = 0;
  let span = 0;
  for (let i = 1; i < n; i++) {
    const dt = timestampsMs[i] - timestampsMs[i - 1];
    if (!(dt > 0)) continue;
    area += ((values[i] + values[i - 1]) / 2) * dt;
    span += dt;
  }
  return span > 0 ? area / span : values[0];
}

function formatWatts(w: number): string {
  if (w >= 1) return `${w.toFixed(2)}W`;
  if (w >= 0.001) return `${(w * 1000).toFixed(0)}mW`;
  return `${(w * 1e6).toFixed(0)}µW`;
}

export type RatingsInput = {
  nodes: Node[];
  portToNet: Record<string, string>;
  result: SpiceResult | null;
  nameOf: (nodeId: string) => string;
};

export function checkComponentRatings({ nodes, portToNet, result, nameOf }: RatingsInput): Advisory[] {
  const out: Advisory[] = [];
  if (!result || !result.data || result.data.length === 0) return out;
  const index = buildNetlistResultIndex(result);
  const t = index.timestamps_ms;
  if (t.length === 0) return out;

  /** Volts across two of a part's terminals, sample by sample. */
  const across = (nodeId: string, handleA: string, handleB: string): number[] | null => {
    const a = findNetGraph(result, portToNet[`${nodeId}-${handleA}`], index);
    const b = findNetGraph(result, portToNet[`${nodeId}-${handleB}`], index);
    if (!a && !b) return null;
    const av = a?.voltage_levels;
    const bv = b?.voltage_levels;
    const n = av?.length ?? bv?.length ?? 0;
    const series = new Array<number>(n);
    for (let i = 0; i < n; i++) series[i] = (av?.[i] ?? 0) - (bv?.[i] ?? 0);
    return series;
  };

  /** One dissipating element: mean and peak watts from V across and R. */
  const dissipation = (v: number[], ohms: number) => {
    const p = v.map(x => (x * x) / ohms);
    let peak = 0;
    for (const x of p) if (x > peak) peak = x;
    return { mean: timeWeightedMean(p, t), peak };
  };

  const report = (node: Node, mean: number, peak: number, rating: PowerRating, what: string) => {
    if (!(mean > rating.watts)) return;
    const where =
      rating.source === 'set'
        ? 'the rating set on this part'
        : rating.source === 'package'
          ? `a ${rating.packageId}`
          : 'a quarter-watt part';
    out.push({
      id: `rating:power:${node.id}`,
      severity: 'warning',
      nodeId: node.id,
      title: `${nameOf(node.id)} is dissipating ${formatWatts(mean)} — over ${formatWatts(rating.watts)}`,
      detail:
        `Averaged across the run${peak > mean * 1.05 ? `, peaking at ${formatWatts(peak)}` : ''}. ` +
        `${formatWatts(rating.watts)} is ${where}. ${what}`,
    });
  };

  for (const node of nodes) {
    const data = node.data as Record<string, unknown>;

    if (node.type === 'resistor') {
      const v = across(node.id, 'in', 'out');
      if (!v) continue;
      const { mean, peak } = dissipation(v, resistanceOf(node, 1000));
      report(node, mean, peak, powerRatingFor(node), 'Raise the resistance, share it across two parts, or fit a bigger package.');
    }

    else if (node.type === 'potentiometer') {
      // Both halves, because the wiper near one end puts nearly all of it in
      // the other — a pot rated as a whole can still cook one half of its track.
      const total = resistanceOf(node, 10000);
      const rawPos = Number(data.position);
      const pos = Math.max(0.001, Math.min(0.999, (Number.isFinite(rawPos) ? rawPos : 50) / 100));
      const top = across(node.id, 'in', 'wiper');
      const bot = across(node.id, 'wiper', 'out');
      if (!top && !bot) continue;
      const a = top ? dissipation(top, Math.max(1e-6, total * (1 - pos))) : { mean: 0, peak: 0 };
      const b = bot ? dissipation(bot, Math.max(1e-6, total * pos)) : { mean: 0, peak: 0 };
      report(node, a.mean + b.mean, a.peak + b.peak, powerRatingFor(node), 'Most of it is in the shorter half of the track; a series resistor takes the heat out of the pot.');
    }

    // A capacitor's limit is volts, not watts, and the number is printed on the
    // part — so this only ever fires for someone who has told Volt what they
    // are holding. Guessing a default here would invent a failure.
    else if (node.type === 'capacitor') {
      const rating = typeof data.voltageRatingV === 'number'
        ? data.voltageRatingV
        : parseEngValue(String(data.voltageRatingV ?? ''));
      if (rating === null || !Number.isFinite(rating) || rating <= 0) continue;
      const v = across(node.id, 'in', 'out');
      if (!v) continue;
      let peak = 0;
      for (const x of v) if (Math.abs(x) > peak) peak = Math.abs(x);
      if (peak <= rating) continue;
      out.push({
        id: `rating:cap-voltage:${node.id}`,
        severity: 'warning',
        nodeId: node.id,
        title: `${nameOf(node.id)} sees ${peak.toFixed(1)}V — over its ${rating}V rating`,
        detail: 'Electrolytics fail short and loudly when they are over-volted. Derate to about half the working voltage for a part that has to last.',
      });
    }

    else if (node.type === 'led' && !data.photodiodeMode) {
      const rating = typeof data.reverseRatingV === 'number' ? data.reverseRatingV : 5;
      if (!(rating > 0)) continue;
      const v = across(node.id, 'cathode', 'anode');
      if (!v) continue;
      let peakReverse = 0;
      for (const x of v) if (x > peakReverse) peakReverse = x;
      if (peakReverse <= rating) continue;
      out.push({
        id: `rating:led-reverse:${node.id}`,
        severity: 'advisory',
        nodeId: node.id,
        title: `${nameOf(node.id)} is reverse-biased to ${peakReverse.toFixed(1)}V`,
        detail: `Most LEDs are only specified to ${rating}V the wrong way round. A diode across it, or in series with it, takes the reverse voltage instead.`,
      });
    }
  }

  return out;
}
