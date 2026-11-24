/** Strip Unicode symbols from component labels to produce valid SPICE values.
 *  e.g. '47kΩ' → '47k', '10µF' / '10μF' → '10uF', '10 kΩ' → '10k', '1F' → '1' */
export function sanitizeSpiceValue(val: string): string {
  // 1. Replace symbols and strip trailing unit words
  const cleaned = val
    .replace(/[Ωω]/g, '')
    .replace(/[µμ]/g, 'u')
    .replace(/(?:ohms?|hz)$/i, '')
    .trim();
  // 2. Extract leading numeric part with optional whitespace and SI suffix (e.g. 10k, 10 k, 4.7, 100u, 5V)
  const match = cleaned.match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*([a-zA-Z]*)/);
  if (match) {
    const numPart = match[1];
    let suffix = match[2];
    // Bare capital 'F' means Farads, NOT SPICE femto (1e-15).
    if (suffix === 'F') suffix = '';
    // A capital M is mega as people write it, and milli to SPICE, which ignores
    // case: "1M" on a resistor simulated as a milliohm. "Meg" is already right.
    suffix = suffix.replace(/^M(?![eE][gG])/, 'meg');
    return `${numPart}${suffix}`;
  }

  return cleaned.replace(/[^\x20-\x7E]/g, '');
}

const VALID_SPICE_NUM = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?[a-zA-Z]*$/;

/**
 * Normalizes a component parameter (numeric field or label string) into a
 * valid SPICE value token, falling back to `fallback` when missing/empty/NaN.
 */
export function spiceValue(primary: unknown, label: unknown, fallback: string): string {
  if (typeof primary === 'number') {
    return Number.isFinite(primary) ? String(primary) : fallback;
  }
  if (typeof primary === 'string' && primary.trim() !== '') {
    const s = sanitizeSpiceValue(primary);
    if (VALID_SPICE_NUM.test(s)) return s;
  }
  const fromLabel = sanitizeSpiceValue(String(label ?? ''));
  return VALID_SPICE_NUM.test(fromLabel) ? fromLabel : fallback;
}

/**
 * A PWL voltage source, `<head> PWL(` then the points, split over
 * continuation lines so no line exceeds ngspice's ~1024-character buffer.
 * Times are in seconds; `digits` is the precision of each number, which a
 * value carried from slice to slice wants more of, so rounding cannot build up.
 */
export function pwlSource(head: string, points: { t: number; v: number }[], digits = 6): string {
  const POINTS_PER_LINE = 8;
  let card = `${head} PWL(\n`;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i % POINTS_PER_LINE === 0) card += '+ ';
    card += `${p.t.toExponential(digits)} ${p.v.toExponential(digits)} `;
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
  const dt = b.t - a.t;
  const v = dt > 0 ? a.v + ((t0 - a.t) / dt) * (b.v - a.v) : b.v;
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
