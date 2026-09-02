/**
 * Engineering-notation component values: "4.7k", "100n", "1meg".
 *
 * Deliberately reads and writes the same spellings the netlist builder already
 * understands, so a value edited on the canvas needs no special handling
 * downstream — it is just a label string like any other, and SPICE sees what it
 * has always seen.
 */

/** Suffix → multiplier. `meg` is checked before `m`, as SPICE spells it. */
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
  const s = String(raw).trim().toLowerCase().replace(/[ωΩfhv]$/i, '');
  const m = /^(-?\d*\.?\d+)\s*([a-zµ]*)$/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const suffix = m[2];
  if (!suffix) return n;
  for (const [tag, mult] of SUFFIXES) {
    if (suffix === tag) return n * mult;
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
    [1e6, 'meg'],
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
