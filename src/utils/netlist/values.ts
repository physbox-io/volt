/** Strip Unicode symbols from component labels to produce valid SPICE values.
 *  e.g. '47kΩ' → '47k', '10µF' / '10μF' → '10uF' */
export function sanitizeSpiceValue(val: string): string {
  // 1. Replace symbols
  const cleaned = val.replace(/Ω/g, '').replace(/[µμ]/g, 'u').trim();
  // 2. Extract leading numeric part with potential SI suffix (e.g. 10k, 4.7, 100u, 5V)
  const match = cleaned.match(/^([-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?[a-zA-Z]*)/);
  // A capital M is mega as people write it, and milli to SPICE, which ignores
  // case: "1M" on a resistor simulated as a milliohm. "Meg" is already right.
  if (match) return match[1].replace(/^([-+]?[0-9.]+(?:[eE][-+]?[0-9]+)?)M(?![eE][gG])/, '$1meg');
  
  return cleaned.replace(/[^\x20-\x7E]/g, '');
}

/**
 * A PWL voltage source, `<head> PWL(` then the points, split over
 * continuation lines so no line exceeds ngspice's ~1024-character buffer.
 * Times are in seconds.
 */
export function pwlSource(head: string, points: { t: number; v: number }[]): string {
  const POINTS_PER_LINE = 8;
  let card = `${head} PWL(\n`;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i % POINTS_PER_LINE === 0) card += '+ ';
    card += `${p.t.toExponential(6)} ${p.v.toExponential(6)} `;
    if ((i + 1) % POINTS_PER_LINE === 0 || i === points.length - 1) card += '\n';
  }
  return card + '+ )\n';
}

/**
 * A recording as it continues from `t0` seconds in: the value at `t0` at time
 * zero, then every later point moved back by `t0`. Past its end a PWL holds
 * its last value, and so does this.
 */
export function pwlFrom(points: { t: number; v: number }[], t0: number): { t: number; v: number }[] {
  if (!(t0 > 0) || points.length === 0) return points;
  const k = points.findIndex(p => p.t > t0);
  if (k < 0) return [{ t: 0, v: points[points.length - 1].v }];
  if (k === 0) return points.map(p => ({ t: p.t - t0, v: p.v }));
  const a = points[k - 1];
  const b = points[k];
  const v = a.v + ((t0 - a.t) / (b.t - a.t)) * (b.v - a.v);
  return [{ t: 0, v }, ...points.slice(k).map(p => ({ t: p.t - t0, v: p.v }))];
}

/**
 * The SINE arguments after amplitude and frequency for a sine `t0` seconds
 * in: none at zero, else a phase in degrees. Reduced to one period first, so
 * an hour-long run does not lose its phase to rounding.
 */
export function sinePhase(freq: number, t0: number): string {
  if (!(t0 > 0) || !(freq > 0)) return '';
  const deg = (((t0 * freq) % 1) * 360);
  return deg === 0 ? '' : ` 0 0 ${deg}`;
}

/**
 * A PULSE's delay for a train `t0` seconds in: negative, so it is already
 * that far into its period at time zero (ngspice wraps a negative delay into
 * the period). 0 at the start of a run.
 */
export function pulseDelay(period: number, t0: number): string {
  if (!(t0 > 0) || !(period > 0)) return '0';
  const into = t0 % period;
  return into === 0 ? '0' : String(-into);
}
