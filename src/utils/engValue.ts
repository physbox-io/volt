/**
 * Engineering-notation component values: "4.7k", "100n", "1meg".
 *
 * Reads and writes the spellings people write, which are SPICE's with one
 * exception: "M" is mega, not milli. sanitizeSpiceValue carries that across,
 * so an edited label is otherwise just a string like any other.
 */

/**
 * Suffix → multiplier, matched without regard to case — except `M` and `m`,
 * which parseEngValue settles first.
 */
const SUFFIXES: [string, number][] = [
  ['meg', 1e6],
  ['g', 1e9],
  ['k', 1e3],
  ['m', 1e-3],
  ['u', 1e-6],
  ['µ', 1e-6],
  ['n', 1e-9],
  ['p', 1e-12],
];

/**
 * Reads a component value. Returns null for anything unparseable, so a caller
 * can leave a hand-written label alone rather than mangling it.
 */
export function parseEngValue(raw: string): number | null {
  // Greek mu (U+03BC) is what most keyboards and phones produce for "μF"; the
  // micro sign (U+00B5) is what the part libraries write. They look identical,
  // and reading one as a bare number turned "10μ" into ten farads.
  const s = String(raw).trim().replace(/μ/g, 'µ').replace(/[ωΩfhva]$/i, '');
  const m = /^(-?\d*\.?\d+)\s*([a-zA-Zµ]*)$/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const suffix = m[2];
  if (!suffix) return n;
  /*
   * Case matters for M alone: "1M" is a megohm and "1m" a milliohm, as
   * everyone but SPICE writes them. SPICE ignores case and would read both as
   * milli, so sanitizeSpiceValue spells the capital one "meg" on the way in.
   */
  if (suffix === 'M') return n * 1e6;
  const lower = suffix.toLowerCase();
  for (const [tag, mult] of SUFFIXES) {
    if (lower === tag) return n * mult;
  }
  return null;
}

/**
 * Writes a value back in the shortest spelling that round-trips.
 *
 * Three significant figures: component values are E-series to begin with, and
 * a scrubbed "4.7002k" reads as noise rather than as a part someone can buy.
 */
export function formatEngValue(v: number): string {
  if (!Number.isFinite(v)) return '0';
  if (v === 0) return '0';
  const neg = v < 0;
  const a = Math.abs(v);

  const scale: [number, string][] = [
    [1e9, 'g'],
    [1e6, 'M'],
    [1e3, 'k'],
    [1, ''],
    [1e-3, 'm'],
    [1e-6, 'u'],
    [1e-9, 'n'],
    [1e-12, 'p'],
  ];

  for (const [mult, tag] of scale) {
    if (a >= mult) {
      const scaled = a / mult;
      // 3 significant figures, with trailing zeros dropped.
      const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
      // Trailing zeros only ever come off a decimal: "100" must not become "1".
      const fixed = scaled.toFixed(digits);
      const text = fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
      return `${neg ? '-' : ''}${text}${tag}`;
    }
  }
  return `${neg ? '-' : ''}${a.toExponential(2)}`;
}
