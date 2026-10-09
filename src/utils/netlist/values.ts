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
