/**
 * Vias on a two-layer board are where a trace changes face, and nowhere else.
 *
 * They used to be left behind when the board was cropped and shifted to its
 * origin, while every trace moved: each via was drilled and padded a few
 * millimetres from its own net, through whatever track was there instead.
 * Checked over every preset, against the geometry rather than the router's
 * word for it.
 */
import { describe, it, expect } from 'vitest';
import {
  generatePcbLayout,
  misplacedVias,
  restorePcbLayout,
  DEFAULT_PCB_OPTIONS,
  type PcbLayoutResult,
  type PcbOptions,
} from '../src/utils/pcbExporter';
import { presets } from '../src/utils/presets';
import { circlePoly, polysOverlap, unionPolys } from '../src/utils/pcbGeometry';

const OPTS: PcbOptions = { ...DEFAULT_PCB_OPTIONS, autoGrowBoard: true, routingBudgetMs: 1500, layers: 2 };
const BOARDS = Object.entries(presets).filter(([, p]) => p.nodes.length > 0).map(([k]) => k);

const layouts = new Map<string, PcbLayoutResult>();
function layout(key: string): PcbLayoutResult {
  if (!layouts.has(key)) {
    const p = presets[key];
    layouts.set(key, generatePcbLayout(p.nodes as never, p.edges as never, OPTS));
  }
  return layouts.get(key)!;
}

describe.each(BOARDS)('%s, two layers', key => {
  it('puts every via where its own net changes face', () => {
    const r = layout(key);
    expect(misplacedVias({ traces: r.traces, vias: r.vias })).toEqual([]);
  });

  it('never lands a via pad on another net', () => {
    const r = layout(key);
    for (const v of r.vias ?? []) {
      const pad = [circlePoly(v.x, v.y, v.padMm / 2)];
      for (const map of [r.copperByNet, r.bottomCopperByNet!]) {
        for (const [netId, polys] of map) {
          if (netId === v.netId) continue;
          expect(polysOverlap(pad, unionPolys(polys), 1e-5), `${v.netId} via on ${netId}`).toBe(false);
        }
      }
    }
    expect(r.violations.filter(x => x.message.startsWith('Short circuit'))).toEqual([]);
  });
});

it('routes a saved board again rather than restore a via off its layer change', () => {
  const key = BOARDS.find(k => (layout(k).vias?.length ?? 0) > 0)!;
  expect(key).toBeDefined();
  const p = presets[key];
  const r = layout(key);
  const snap = r.snapshot!;
  expect(restorePcbLayout(snap, p.nodes as never, p.edges as never, OPTS)).not.toBeNull();
  const vias = snap.core.vias!.map((v, i) => (i === 0 ? { ...v, x: v.x - 3, y: v.y - 3 } : v));
  const stale = { ...snap, core: { ...snap.core, vias } };
  expect(restorePcbLayout(stale, p.nodes as never, p.edges as never, OPTS)).toBeNull();
});
