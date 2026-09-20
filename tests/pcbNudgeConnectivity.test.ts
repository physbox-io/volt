/**
 * The invariant a hand move must never break: every net's pads stay joined by
 * copper.
 *
 * This is here because the first version of the move did break it, on the 555
 * preset, and the break was invisible. The pads were still the right colour
 * and in the right place, the preview looked like a board, and the connection
 * between the LED's anode and the resistor simply was not there. A board like
 * that is not a rendering bug — it is a board somebody mills, assembles, and
 * then spends an evening debugging with a multimeter.
 *
 * So the check is on the copper rather than on the router's own report. The
 * router says what it failed to route; this says what the board actually
 * joins, which is the thing that matters and the thing a wrong merge of routed
 * and kept tracks can get wrong without anybody's completion figure moving.
 *
 * Deliberately over several presets and several moves each. The failure was
 * found on one board and the fix has to hold on all of them.
 */
import { describe, it, expect } from 'vitest';
import { presets } from '../src/utils/presets';
import {
  DEFAULT_PCB_OPTIONS,
  effectivePadMarginMm,
  padOffset,
  type PcbLayoutResult,
  type PcbOptions,
  type Rotation,
} from '../src/utils/pcbExporter';
import { layoutWithOverrides, nudgeLayout } from '../src/utils/pcbNudge';

/**
 * A short budget, because this suite makes hundreds of boards. A refused move
 * costs two router passes — the incremental one and the whole-board one it
 * escalates to — so the budget is what decides whether this file takes one
 * minute or ten.
 */
const OPTS: PcbOptions = { ...DEFAULT_PCB_OPTIONS, routingBudgetMs: 1000 };

/** Distance between two segments, in mm. */
function segmentDistanceMm(
  a0: { x: number; y: number }, a1: { x: number; y: number },
  b0: { x: number; y: number }, b1: { x: number; y: number }
): number {
  const pointSeg = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };
  return Math.min(
    pointSeg(a0.x, a0.y, b0.x, b0.y, b1.x, b1.y),
    pointSeg(a1.x, a1.y, b0.x, b0.y, b1.x, b1.y),
    pointSeg(b0.x, b0.y, a0.x, a0.y, a1.x, a1.y),
    pointSeg(b1.x, b1.y, a0.x, a0.y, a1.x, a1.y)
  );
}

/** A piece of copper: a polyline (a track) or a single point (a pad, a via). */
interface Blob {
  pts: { x: number; y: number }[];
  r: number;
}

function blobDistanceMm(a: Blob, b: Blob): number {
  const segs = (p: Blob) =>
    p.pts.length === 1
      ? [[p.pts[0], p.pts[0]] as const]
      : p.pts.slice(0, -1).map((pt, i) => [pt, p.pts[i + 1]] as const);
  let best = Infinity;
  for (const [a0, a1] of segs(a)) {
    for (const [b0, b1] of segs(b)) {
      best = Math.min(best, segmentDistanceMm(a0, a1, b0, b1));
    }
  }
  return best;
}

/**
 * Nets whose pads are not all joined, by nominal copper alone.
 *
 * Nominal, before the flood, on purpose: flooding grows every net outward by
 * up to `copperFloodMm`, which can bridge a gap the router left and hide a
 * missing track behind a setting. A board has to be connected at the width it
 * was routed at.
 */
function brokenNets(result: PcbLayoutResult, options: PcbOptions): string[] {
  const padMargin = Math.max(0, options.padMarginMm ?? 0);
  const compById = new Map(result.components.map(c => [c.id, c]));
  const broken: string[] = [];

  for (const netId of new Set(result.pads.filter(p => p.netId).map(p => p.netId!))) {
    const pads = result.pads.filter(p => p.netId === netId);
    if (pads.length < 2) continue;
    const blobs: Blob[] = [
      ...pads.map(pad => {
        const comp = compById.get(pad.componentId)!;
        const { w, h } = padOffset(pad.spec, comp.rotationDeg);
        return {
          pts: [{ x: pad.x, y: pad.y }],
          r: Math.max(w, h) / 2 + effectivePadMarginMm(comp.footprint, padMargin),
        };
      }),
      ...result.traces.filter(t => t.netId === netId).map(t => ({ pts: t.points, r: t.width / 2 })),
      ...(result.vias ?? [])
        .filter(v => v.netId === netId)
        .map(v => ({ pts: [{ x: v.x, y: v.y }], r: v.padMm / 2 })),
    ];

    const parent = blobs.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < blobs.length; i++) {
      for (let j = i + 1; j < blobs.length; j++) {
        if (blobDistanceMm(blobs[i], blobs[j]) <= blobs[i].r + blobs[j].r + 1e-6) {
          parent[find(i)] = find(j);
        }
      }
    }
    // Pads are the first `pads.length` blobs, and they all have to end up in
    // the same component.
    if (new Set(pads.map((_, i) => find(i))).size > 1) broken.push(netId);
  }
  return broken;
}

/** A spread of boards rather than one: the bug was only visible on some. */
const BOARDS = [
  'timer555Blink',
  'astableMultivibrator',
  'basicBlink',
  'bjtAmp',
  'currentMirror',
  'mcuBlink',
] as const;

const NUDGES: [number, number][] = [[1.5, 0], [0, -1.5], [3, 1]];

describe('a moved part never leaves a net half-wired', () => {
  for (const key of BOARDS) {
    it(`holds on ${key}`, () => {
      const circuit = presets[key];
      const base = layoutWithOverrides(circuit.nodes, circuit.edges, OPTS);
      /*
       * What the board arrives with. Normally nothing — the router's own
       * boards are whole — but routing is a search against a wall-clock
       * budget, so on a loaded machine a board can come out of the automatic
       * path with a net it could not finish. That is not this file's subject:
       * the rule being tested is that a *move* never adds one.
       */
      const alreadyBroken = new Set(brokenNets(base, OPTS));
      expect(base.completion).toBeGreaterThan(0.5);

      let accepted = 0;
      for (const part of base.components) {
        for (const [dx, dy] of NUDGES) {
          for (const turn of [0, 1]) {
            const rots: Rotation[] = [0, 90, 180, 270];
            const rotationDeg = rots[(rots.indexOf(part.rotationDeg) + turn) % 4];
            const moved = nudgeLayout(base, circuit.nodes, circuit.edges, OPTS, {
              componentId: part.id,
              xMm: part.x - base.boardOriginMm + dx,
              yMm: part.y - base.boardOriginMm + dy,
              rotationDeg,
            });
            // A refusal is always allowed: it leaves the board that worked.
            if (!moved.result) {
              expect(moved.reason).toBeTruthy();
              continue;
            }
            accepted++;
            const where = `${part.name} by ${dx},${dy} at ${rotationDeg}°`;
            // Whole, and no worse than the board it came from.
            const newlyBroken = brokenNets(moved.result, OPTS).filter(n => !alreadyBroken.has(n));
            expect(`${where}: ${newlyBroken.join(',')}`).toBe(`${where}: `);
            expect(`${where}: ${moved.result.unrouted.length}`).toBe(
              `${where}: ${Math.min(moved.result.unrouted.length, base.unrouted.length)}`
            );
          }
        }
      }
      // A rule that refuses everything would also pass the two above.
      expect(accepted).toBeGreaterThan(0);
    }, 120_000);
  }
});
