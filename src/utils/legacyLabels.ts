import type { Node } from '@xyflow/react';

/**
 * Brings value labels written under old parsing rules up to the current ones.
 *
 * The potentiometer used to read its own label, and read "m" as mega: "1M" and
 * "1m" were both a megohm. Everything else — the netlist, the canvas field,
 * power ratings — follows SPICE, where "m" is milli, and the pot now does too.
 * A saved "1M" pot would otherwise open as a one-milliohm short.
 *
 * No saved circuit carries a version to test, so the rewrite keys on the value
 * instead: a sub-ohm potentiometer is not a part anyone draws, so "<n>m" on a
 * pot can only ever have meant megohms. That also makes it safe to run on every
 * circuit that arrives, any number of times.
 */
export function upgradeLegacyLabels(nodes: Node[]): Node[] {
  let changed = false;
  const out = nodes.map(n => {
    if (n.type !== 'potentiometer') return n;
    const label = n.data?.label;
    if (typeof label !== 'string') return n;
    const m = /^(\s*[-+]?\d*\.?\d+\s*)m(\s*(?:Ω|ohms?)?\s*)$/i.exec(label);
    if (!m) return n;
    changed = true;
    return { ...n, data: { ...n.data, label: `${m[1]}meg${m[2]}` } };
  });
  return changed ? out : nodes;
}
