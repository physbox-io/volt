/**
 * Symbols, pins and the snap grid.
 *
 * The canvas snaps parts to a 4px grid and puts a side pin at the symbol's
 * vertical centre, so a symbol whose height is not a multiple of 8 has its pin
 * half a grid step off. Two such parts can then never be aligned by dragging:
 * their pins stay 1-4px apart however carefully they are placed, and the wire
 * between them is drawn with a small step in it. The router copes with that
 * now, but the tidier answer is for the geometry not to produce it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { presets } from '../src/utils/presets';

const NODE_DIR = 'src/components/nodes';
const SNAP = 4;

/**
 * Heights that are deliberately not on the rule.
 *
 * A junction is a 1px dot — a point, not a body, and its pin is the dot itself.
 */
const EXEMPT = new Set(['JunctionNode.tsx']);

describe('a symbol centres its pin on the grid', () => {
  const files = fs.readdirSync(NODE_DIR).filter(f => f.endsWith('Node.tsx') && !EXEMPT.has(f));

  it.each(files)('%s', file => {
    const src = fs.readFileSync(path.join(NODE_DIR, file), 'utf8');
    /*
     * A node declares its own box as adjacent width and height utilities, and
     * may declare two — one per orientation. An inner element sized in one axis
     * only (the signal generator's waveform screen is `w-full h-[22px]`) is not
     * the node's box and is correctly skipped by requiring both.
     */
    const boxes = [...src.matchAll(/\bw-\[(\d+)px\]\s+h-\[(\d+)px\]/g)];
    if (boxes.length === 0) return; // content-sized card: nothing declared here
    for (const box of boxes) {
      const h = Number(box[2]);
      expect(
        h % (SNAP * 2),
        `${file} declares a ${box[1]}x${h} box, so its centre pin sits ${h / 2}px in — ` +
          `half a grid step off. Use a height that is a multiple of ${SNAP * 2}.`,
      ).toBe(0);
    }
  });
});

describe('preset pins line up', () => {
  /** Heights of the fixed-size symbols, as [horizontal, vertical]. */
  const H: Record<string, [number, number]> = {
    resistor: [24, 40], capacitor: [24, 40], inductor: [24, 40], diode: [24, 40], zener: [24, 40],
    led: [32, 32], npn: [32, 32], pnp: [32, 32], nmos: [48, 48], pmos: [48, 48],
    voltage: [24, 24], ground: [24, 24], acvoltage: [40, 40], currentsource: [40, 40],
    transformer: [48, 48], potentiometer: [40, 64], switch: [40, 48], via: [16, 16],
    dff: [80, 80], opamp: [80, 80], and: [80, 80], or: [80, 80], nand: [80, 80],
    nor: [80, 80], not: [80, 80], xor: [80, 80],
    // Fixed at 64 so its centre pin lands on the grid; see SignalGeneratorNode.
    signalgen: [64, 64],
  };

  /** A part drawn on end takes its leads top and bottom rather than side to side. */
  const onEnd = (n: any) => ['vertical', 'up', 'down'].includes(n.data?.orientation);

  const centreY = (n: any): number | null => {
    const e = H[n.type as string];
    if (!e) return null; // content-sized card: its height is not knowable here
    const vertical = ['vertical', 'up', 'down'].includes(n.data?.orientation);
    return n.position.y + (vertical ? e[1] : e[0]) / 2;
  };

  it.each(Object.keys(presets).filter(k => (presets[k].nodes ?? []).length > 0))(
    '%s has no pin pair a hair out of line',
    key => {
      const p: any = presets[key];
      const byId = new Map((p.nodes ?? []).map((n: any) => [n.id, n]));
      const offenders: string[] = [];
      for (const e of p.edges ?? []) {
        const a: any = byId.get(e.source);
        const b: any = byId.get(e.target);
        if (!a || !b) continue;
        const ya = centreY(a);
        const yb = centreY(b);
        if (ya == null || yb == null) continue;
        const d = Math.abs(ya - yb);
        // Either share a line, or be clearly apart. A gap of a pixel or two is
        // the case that reads as a mistake rather than as a deliberate step.
        if (d > 0.01 && d <= SNAP) {
          offenders.push(`${a.id} (pin y ${ya}) and ${b.id} (pin y ${yb}) are ${d}px apart`);
        }
      }

      /*
       * A part drawn on end presents its leads top and bottom, so a wire from a
       * neighbour's side pin turns down into it. That corner is right — but only
       * if the corner is square. When the two are a few pixels apart the wire has
       * to double back on itself first, which reads as a kink against the symbol.
       */
      for (const e of p.edges ?? []) {
        const a: any = byId.get(e.source);
        const b: any = byId.get(e.target);
        if (!a || !b || e.sourceHandle === 'gnd' || e.targetHandle === 'gnd') continue;
        for (const [side, end] of [[a, b], [b, a]] as [any, any][]) {
          if (onEnd(side) || !onEnd(end)) continue;
          const sideH = H[side.type as string];
          if (sideH === undefined || H[end.type as string] === undefined) continue;
          const sidePin = side.position.y + sideH[0] / 2;
          const d = Math.abs(sidePin - end.position.y);
          if (d > 0.01 && d <= 12) {
            offenders.push(
              `${side.id} (pin y ${sidePin}) enters ${end.id} (lead at y ${end.position.y}) ${d}px out of square`,
            );
          }
        }
      }
      expect(offenders).toEqual([]);
    },
  );
});
