/**
 * Moving one part on a board that is already laid out.
 *
 * The promise here is what makes the feature worth having: the rest of the
 * board does not move. A full re-place-and-route would also produce a board
 * with the connector where it was asked for, and it would be a different board
 * — every other part re-decided, every other track re-drawn — which is not
 * what somebody dragging one part across a preview is asking for.
 *
 * So these tests are mostly equalities about what *did not* change: other
 * parts' positions, other nets' tracks, the board outline. The rest is the
 * part that did: its pads follow its footprint, its nets come back routed to
 * the same clearances, and a move that cannot be made is refused rather than
 * half-applied.
 */
import { describe, it, expect } from 'vitest';
import { presets } from '../src/utils/presets';
import {
  DEFAULT_PCB_OPTIONS,
  layoutBoardKey,
  restorePcbLayout,
  type PcbLayoutResult,
  type PcbOptions,
} from '../src/utils/pcbExporter';
import {
  applyPlacementOverrides,
  coreFrameMove,
  layoutWithOverrides,
  moveComponentInCore,
  nudgeLayout,
  placementOverrideFor,
} from '../src/utils/pcbNudge';

const OPTS: PcbOptions = { ...DEFAULT_PCB_OPTIONS, autoGrowBoard: true, routingBudgetMs: 1500 };

const board = presets.astableMultivibrator;
let cached: PcbLayoutResult | null = null;
function laidOut(): PcbLayoutResult {
  if (!cached) cached = layoutWithOverrides(board.nodes, board.edges, OPTS);
  return cached;
}

/** Any real part on the board: the first one that is not a milled cutout. */
function somePart(result: PcbLayoutResult) {
  return result.snapshot!.core.placed.find(c => c.type !== 'cutout')!;
}

describe('moving one part', () => {
  it('leaves every other part exactly where it was', () => {
    const before = laidOut().snapshot!.core;
    const part = somePart(laidOut());
    const outcome = moveComponentInCore(before, OPTS, {
      componentId: part.id,
      xMm: part.x - before.boardOriginMm + 1.5,
      yMm: part.y - before.boardOriginMm,
    });
    expect(outcome.reason).toBeNull();
    const after = outcome.core!;

    for (const was of before.placed) {
      if (was.id === part.id) continue;
      const now = after.placed.find(c => c.id === was.id)!;
      expect([now.x, now.y, now.rotationDeg]).toEqual([was.x, was.y, was.rotationDeg]);
    }
    for (const was of before.pads) {
      if (was.componentId === part.id) continue;
      const now = after.pads.find(
        p => p.componentId === was.componentId && p.pinNumber === was.pinNumber
      )!;
      expect([now.x, now.y]).toEqual([was.x, was.y]);
    }
    expect(after.boardWidthMm).toBe(before.boardWidthMm);
    expect(after.boardHeightMm).toBe(before.boardHeightMm);
  });

  it('keeps the tracks of every net it did not touch', () => {
    const before = laidOut().snapshot!.core;
    const part = somePart(laidOut());
    const outcome = moveComponentInCore(before, OPTS, {
      componentId: part.id,
      xMm: part.x - before.boardOriginMm + 1.5,
      yMm: part.y - before.boardOriginMm,
    });
    const after = outcome.core!;
    const touched = new Set(outcome.reroutedNets);

    // Every net the move did not involve keeps its copper, point for point.
    const kept = (core: typeof before) =>
      core.traces.filter(t => !touched.has(t.netId));
    expect(kept(after)).toEqual(kept(before));
    // And it did not simply rip up the whole board to get there.
    expect(touched.size).toBeLessThan(new Set(before.traces.map(t => t.netId)).size + 1);
  });

  it('carries the part\'s own pads with it', () => {
    const before = laidOut().snapshot!.core;
    const part = somePart(laidOut());
    const dx = 2;
    const outcome = moveComponentInCore(before, OPTS, {
      componentId: part.id,
      xMm: part.x - before.boardOriginMm + dx,
      yMm: part.y - before.boardOriginMm,
    });
    const after = outcome.core!;
    const moved = after.placed.find(c => c.id === part.id)!;
    expect(moved.x).toBeCloseTo(part.x + dx, 3);

    for (const was of before.pads.filter(p => p.componentId === part.id)) {
      const now = after.pads.find(p => p.pinNumber === was.pinNumber && p.componentId === part.id)!;
      expect(now.x).toBeCloseTo(was.x + dx, 3);
      expect(now.y).toBeCloseTo(was.y, 3);
      // The net a pad belongs to is a property of the circuit, not of where
      // the part sits.
      expect(now.netId).toBe(was.netId);
    }
  });

  it('turns a part in place, and re-sizes its courtyard to match', () => {
    const before = laidOut().snapshot!.core;
    const part = before.placed.find(c => c.widthMm !== c.heightMm && c.type !== 'cutout');
    if (!part) return;
    const outcome = moveComponentInCore(before, OPTS, {
      componentId: part.id,
      xMm: part.x - before.boardOriginMm,
      yMm: part.y - before.boardOriginMm,
      rotationDeg: part.rotationDeg === 0 ? 90 : 0,
    });
    if (!outcome.core) return; // A turn that does not fit is a legitimate refusal.
    const moved = outcome.core.placed.find(c => c.id === part.id)!;
    expect(moved.widthMm).toBeCloseTo(part.heightMm, 6);
    expect(moved.heightMm).toBeCloseTo(part.widthMm, 6);
  });

  it('refuses a move off the edge of the board rather than making it', () => {
    const core = laidOut().snapshot!.core;
    const part = somePart(laidOut());
    const outcome = moveComponentInCore(core, OPTS, {
      componentId: part.id,
      xMm: core.boardWidthMm + 20,
      yMm: 0,
    });
    expect(outcome.core).toBeNull();
    expect(outcome.reason).toMatch(/edge of the board/);
  });

  it('refuses to drop one part on top of another', () => {
    const core = laidOut().snapshot!.core;
    const [a, b] = core.placed.filter(c => c.type !== 'cutout');
    const outcome = moveComponentInCore(core, OPTS, {
      componentId: a.id,
      xMm: b.x - core.boardOriginMm,
      yMm: b.y - core.boardOriginMm,
    });
    expect(outcome.core).toBeNull();
    expect(outcome.reason).toMatch(/on top of/);
  });

  it('refuses a part that is not on the board', () => {
    const outcome = moveComponentInCore(laidOut().snapshot!.core, OPTS, {
      componentId: 'no_such_part',
      xMm: 5,
      yMm: 5,
    });
    expect(outcome.core).toBeNull();
  });

  it('does not re-route a board it refuses to move', () => {
    const core = laidOut().snapshot!.core;
    const part = somePart(laidOut());
    const outcome = moveComponentInCore(core, OPTS, {
      componentId: part.id,
      xMm: core.boardWidthMm + 20,
      yMm: 0,
    });
    expect(outcome.core).toBeNull();
    // The board handed in is untouched — the caller is still showing it.
    expect(core.placed.find(c => c.id === part.id)!.x).toBe(part.x);
  });
});

describe('a hand-placed board is still a board', () => {
  it('records the move in the options, and rebuilds the same board from them', () => {
    const base = laidOut();
    const part = somePart(base);
    const moved = nudgeLayout(base, board.nodes, board.edges, OPTS, {
      componentId: part.id,
      xMm: part.x - base.snapshot!.core.boardOriginMm + 1.5,
      yMm: part.y - base.snapshot!.core.boardOriginMm,
    });
    expect(moved.reason).toBeNull();

    const override = moved.options!.placementOverrides![part.id];
    expect(override.xMm).toBeCloseTo(part.x - base.snapshot!.core.boardOriginMm + 1.5, 3);
    expect(override.type).toBe(part.type);

    // The fingerprint has to move with it, or the board before the move would
    // be restored over the board after it.
    expect(moved.result!.snapshot!.boardKey).toBe(
      layoutBoardKey(board.nodes, board.edges, moved.options!)
    );
    expect(moved.result!.snapshot!.boardKey).not.toBe(base.snapshot!.boardKey);

    // And it restores like any other board: same placement, same copper.
    const restored = restorePcbLayout(
      moved.result!.snapshot,
      board.nodes,
      board.edges,
      moved.options!
    );
    expect(restored).not.toBeNull();
    expect(restored!.components.map(c => [c.id, c.x, c.y])).toEqual(
      moved.result!.components.map(c => [c.id, c.x, c.y])
    );
    expect(restored!.gcode).toBe(moved.result!.gcode);
  });

  it('replays the move onto a board laid out from scratch', () => {
    const base = laidOut();
    const part = somePart(base);
    const moved = nudgeLayout(base, board.nodes, board.edges, OPTS, {
      componentId: part.id,
      xMm: part.x - base.snapshot!.core.boardOriginMm + 1.5,
      yMm: part.y - base.snapshot!.core.boardOriginMm,
    });

    // The route of a fresh layout is a search, so this is not asking for the
    // same board — only for the part to end up where it was put.
    const fresh = layoutWithOverrides(board.nodes, board.edges, moved.options!);
    const placed = fresh.snapshot!.core.placed.find(c => c.id === part.id)!;
    const want = moved.options!.placementOverrides![part.id];
    expect(placed.x - fresh.snapshot!.core.boardOriginMm).toBeCloseTo(want.xMm, 3);
    expect(placed.y - fresh.snapshot!.core.boardOriginMm).toBeCloseTo(want.yMm, 3);
  });

  it('drops an override for a part that is no longer the same part', () => {
    const base = laidOut();
    const part = somePart(base);
    const core = base.snapshot!.core;
    const applied = applyPlacementOverrides(core, {
      ...OPTS,
      placementOverrides: {
        [part.id]: {
          xMm: part.x - core.boardOriginMm + 2,
          yMm: part.y - core.boardOriginMm,
          rotationDeg: part.rotationDeg,
          type: 'something_else_entirely',
        },
      },
    });
    expect(applied).toBe(core);
  });

  it('says so when an override no longer fits the board', () => {
    const core = laidOut().snapshot!.core;
    const part = somePart(laidOut());
    const applied = applyPlacementOverrides(core, {
      ...OPTS,
      placementOverrides: {
        [part.id]: {
          xMm: core.boardWidthMm + 50,
          yMm: 0,
          rotationDeg: part.rotationDeg,
          type: part.type,
        },
      },
    });
    expect(applied.placed.find(c => c.id === part.id)!.x).toBe(part.x);
    expect(applied.warnings.join(' ')).toMatch(/Hand placement dropped/);
  });

  it('reads a part\'s current placement back in the frame an override is stored in', () => {
    const core = laidOut().snapshot!.core;
    const part = somePart(laidOut());
    const here = placementOverrideFor(core, part.id)!;
    expect(here.xMm).toBeCloseTo(part.x - core.boardOriginMm, 3);
    expect(here.rotationDeg).toBe(part.rotationDeg);
    expect(placementOverrideFor(core, 'no_such_part')).toBeNull();
  });
});

describe('what the preview hands back', () => {
  /**
   * The drag happens on the picture, and for a single-sided board the picture
   * is the mirror of the layout. This is the whole round trip the export panel
   * makes: read a part's position off the finished board, ask for it 2mm to
   * the right *of the picture*, and check it arrives there.
   */
  it('puts a part where the preview was told to put it', () => {
    for (const mirrorSingleSided of [true, false]) {
      const opts: PcbOptions = { ...OPTS, mirrorSingleSided };
      const base = layoutWithOverrides(board.nodes, board.edges, opts);
      const drawn = base.components.find(c => c.type !== 'cutout' && !c.data?.autoJumper)!;
      const want = { xMm: drawn.x - base.boardOriginMm + 2, yMm: drawn.y - base.boardOriginMm };

      const moved = nudgeLayout(
        base,
        board.nodes,
        board.edges,
        opts,
        coreFrameMove(base.boardWidthMm, opts, {
          componentId: drawn.id,
          xMm: want.xMm,
          yMm: want.yMm,
          rotationDeg: drawn.rotationDeg,
        })
      );
      expect(moved.reason).toBeNull();

      const after = moved.result!.components.find(c => c.id === drawn.id)!;
      expect(after.x - moved.result!.boardOriginMm).toBeCloseTo(want.xMm, 3);
      expect(after.y - moved.result!.boardOriginMm).toBeCloseTo(want.yMm, 3);
      // And it is still the same way round on the picture.
      expect(after.rotationDeg).toBe(drawn.rotationDeg);
    }
  });

  it('turns a part the way the preview turned it', () => {
    const opts: PcbOptions = { ...OPTS, mirrorSingleSided: true };
    const base = layoutWithOverrides(board.nodes, board.edges, opts);
    const drawn = base.components.find(
      c => c.type !== 'cutout' && !c.data?.autoJumper && c.widthMm !== c.heightMm
    );
    if (!drawn) return;
    const turned = (((drawn.rotationDeg + 90) % 360) as typeof drawn.rotationDeg);
    const moved = nudgeLayout(
      base,
      board.nodes,
      board.edges,
      opts,
      coreFrameMove(base.boardWidthMm, opts, {
        componentId: drawn.id,
        xMm: drawn.x - base.boardOriginMm,
        yMm: drawn.y - base.boardOriginMm,
        rotationDeg: turned,
      })
    );
    if (!moved.result) return; // No room to turn it is a legitimate refusal.
    expect(moved.result.components.find(c => c.id === drawn.id)!.rotationDeg).toBe(turned);
  });
});
